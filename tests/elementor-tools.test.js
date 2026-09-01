import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ELEMENTOR_FILE_FORMAT,
  ELEMENTOR_FILE_VERSION,
  editElementorPage,
  executeElementorTool,
  inspectElementorPage,
  pullElementorPage,
  pushElementorPage
} from "../build/mcp/tools/elementor.js";
import { createElementorRevision } from "../build/wordpress/elementor/document.js";

/** 构造包含 Elementor 元数据的 WordPress REST 页面实体。 */
function elementorEntity(data) {
  return { id: 12, meta: { _elementor_data: JSON.stringify(data), _elementor_edit_mode: "builder" } };
}

/** 构造同时包含正文、样式和扩展字段的测试树。 */
function contentTree() {
  return [{
    id: "root001",
    elType: "container",
    settings: { flex_direction: "column", background_color: "#fff" },
    customExtension: { enabled: true },
    elements: [{
      id: "head001",
      elType: "widget",
      widgetType: "heading",
      settings: { title: "Old heading", title_color: "#000" },
      elements: []
    }]
  }];
}

/** 创建可读写的内存 Elementor client。 */
function createClient(initialTree = contentTree()) {
  let tree = structuredClone(initialTree);
  const calls = [];
  return {
    baseUrl: "https://example.com",
    calls,
    /** 返回当前测试树，或保存并回显请求中的完整树。 */
    async request(route, options) {
      calls.push({ type: options.method === "POST" ? "write" : "read", route, options });
      if (options.method === "POST") tree = JSON.parse(options.body.meta._elementor_data);
      return { data: elementorEntity(tree), pagination: { total: 0, totalPages: 0 } };
    },
    /** 记录缓存刷新。 */
    async requestApiPath(apiPath, options) {
      calls.push({ type: "cache", apiPath, options });
      return { data: { success: true }, pagination: { total: 0, totalPages: 0 } };
    },
    /** 返回当前测试树的副本。 */
    currentTree() {
      return structuredClone(tree);
    },
    /** 模拟远端编辑器直接修改页面。 */
    replaceTree(value) {
      tree = structuredClone(value);
    }
  };
}

/** 创建测试目录并在测试结束时清理。 */
async function createTestDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wp-api-elementor-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** 验证 pull 生成带来源与 revision 的版本化本地文件。 */
test("pullElementorPage writes a versioned editable file", async (t) => {
  const directory = await createTestDirectory(t);
  const outputFile = path.join(directory, "page.json");
  const client = createClient();
  const result = await pullElementorPage(client, { postId: 12, outputFile });
  const file = JSON.parse(await readFile(outputFile, "utf8"));

  assert.equal(result.pulled, true);
  assert.equal(result.file_path, outputFile);
  assert.match(result.file_sha256, /^[a-f0-9]{64}$/);
  assert.equal(file.format, ELEMENTOR_FILE_FORMAT);
  assert.equal(file.version, ELEMENTOR_FILE_VERSION);
  assert.deepEqual(file.source, {
    site_url: "https://example.com",
    post_id: 12,
    revision: createElementorRevision(contentTree())
  });
  assert.deepEqual(file.data, contentTree());
  assert.equal(client.calls[0].options.query._fields, "id,meta._elementor_data");
  assert.equal(client.calls[0].options.maxResponseBytes > 200 * 1024 * 1024, true);

  await assert.rejects(() => pullElementorPage(client, { postId: 12, outputFile }), /already exists/);
  assert.equal((await pullElementorPage(client, { postId: 12, outputFile, overwrite: true })).file_path, outputFile);
});

/** 验证未指定 outputFile 时在结果目录生成唯一文件。 */
test("pullElementorPage generates an output file in the result directory", async (t) => {
  const directory = await createTestDirectory(t);
  const result = await pullElementorPage(createClient(), { postId: 12 }, { resultDirectory: directory });
  assert.equal(path.dirname(result.file_path), directory);
  assert.match(path.basename(result.file_path), /^wp_elementor_pull-12-.*\.json$/);
  assert.equal(JSON.parse(await readFile(result.file_path, "utf8")).source.post_id, 12);
});

/** 验证 inspect 返回文件摘要、元素定位和 JSON Pointer 结果。 */
test("inspectElementorPage queries a local file without remote access", async (t) => {
  const directory = await createTestDirectory(t);
  const outputFile = path.join(directory, "page.json");
  const client = createClient();
  const pulled = await pullElementorPage(client, { postId: 12, outputFile });
  client.calls.length = 0;

  const summary = await inspectElementorPage({ dataFile: outputFile });
  assert.equal(summary.inspected, true);
  assert.equal(summary.file_sha256, pulled.file_sha256);
  assert.equal(summary.elements_count, 2);
  assert.equal(summary.baseline_revision, pulled.revision);
  assert.equal(summary.matches, undefined);

  const matched = await inspectElementorPage({
    dataFile: outputFile,
    widgetType: "heading",
    searchText: "old heading"
  });
  assert.equal(matched.total_matches, 1);
  assert.equal(matched.matches[0].element_id, "head001");
  assert.equal(matched.matches[0].parent_id, "root001");
  assert.equal(matched.matches[0].pointer, "/data/0/elements/0");
  assert.equal(Object.hasOwn(matched.matches[0].element, "elements"), false);

  const pointed = await inspectElementorPage({
    dataFile: outputFile,
    jsonPointer: "/data/0/elements/0/settings/title"
  });
  assert.deepEqual(pointed.pointer_result, {
    pointer: "/data/0/elements/0/settings/title",
    value: "Old heading"
  });
  await assert.rejects(
    () => inspectElementorPage({ dataFile: outputFile, jsonPointer: "/data/0", elementId: "root001" }),
    /cannot be combined/
  );
  assert.equal(client.calls.length, 0);
});

/** 验证 edit 顺序执行全部五类结构操作并原子更新文件。 */
test("editElementorPage applies domain operations and returns a new file hash", async (t) => {
  const directory = await createTestDirectory(t);
  const outputFile = path.join(directory, "page.json");
  const pulled = await pullElementorPage(createClient(), { postId: 12, outputFile });
  const replacement = {
    id: "head001",
    elType: "widget",
    widgetType: "heading",
    settings: { title: "Replacement", title_color: "#f00" },
    elements: []
  };
  const result = await editElementorPage({
    dataFile: outputFile,
    expectedFileSha256: pulled.file_sha256,
    operations: [
      {
        op: "update_settings",
        elementId: "root001",
        settings: { gap: 24 },
        removeSettings: ["background_color"]
      },
      { op: "replace_element", elementId: "head001", element: replacement },
      {
        op: "insert_child",
        parentElementId: "root001",
        index: 1,
        element: {
          id: "text001",
          elType: "widget",
          widgetType: "text-editor",
          settings: { editor: "New body" },
          elements: []
        }
      },
      { op: "move_element", elementId: "text001", index: 0 },
      { op: "remove_element", elementId: "head001" }
    ]
  });
  const file = JSON.parse(await readFile(outputFile, "utf8"));

  assert.equal(result.edited, true);
  assert.equal(result.file_sha256_before, pulled.file_sha256);
  assert.notEqual(result.file_sha256_after, pulled.file_sha256);
  assert.deepEqual(result.operations.map((operation) => operation.op), [
    "update_settings",
    "replace_element",
    "insert_child",
    "move_element",
    "remove_element"
  ]);
  assert.equal(file.source.revision, pulled.revision);
  assert.equal(file.data[0].id, "text001");
  assert.equal(file.data[1].id, "root001");
  assert.deepEqual(file.data[1].elements, []);
  assert.equal(file.data[1].settings.gap, 24);
  assert.equal(Object.hasOwn(file.data[1].settings, "background_color"), false);
  assert.equal(result.data_revision_after, createElementorRevision(file.data));
});

/** 验证 edit 支持 operationsFile，并在哈希过期或操作无效时保持原文件不变。 */
test("editElementorPage reads operationsFile and rejects stale or invalid edits", async (t) => {
  const directory = await createTestDirectory(t);
  const outputFile = path.join(directory, "page.json");
  const operationsFile = path.join(directory, "operations.json");
  const pulled = await pullElementorPage(createClient(), { postId: 12, outputFile });
  await writeFile(operationsFile, JSON.stringify([{
    op: "update_settings",
    elementId: "head001",
    settings: { title: "From file" }
  }]), "utf8");
  const edited = await editElementorPage({
    dataFile: outputFile,
    expectedFileSha256: pulled.file_sha256,
    operationsFile
  });
  assert.equal(JSON.parse(await readFile(outputFile, "utf8")).data[0].elements[0].settings.title, "From file");

  await assert.rejects(
    () => editElementorPage({
      dataFile: outputFile,
      expectedFileSha256: pulled.file_sha256,
      operations: [{ op: "remove_element", elementId: "head001" }]
    }),
    /changed after it was inspected/
  );
  const beforeInvalid = await readFile(outputFile, "utf8");
  await assert.rejects(
    () => editElementorPage({
      dataFile: outputFile,
      expectedFileSha256: edited.file_sha256_after,
      operations: [{
        op: "insert_child",
        element: { id: "head001", elType: "widget", settings: {}, elements: [] }
      }]
    }),
    /duplicate element ID/
  );
  assert.equal(await readFile(outputFile, "utf8"), beforeInvalid);
});

/** 验证 push 上传完整树、刷新缓存并更新同一本地文件的基线。 */
test("pushElementorPage uploads full data and atomically updates the baseline", async (t) => {
  const directory = await createTestDirectory(t);
  const outputFile = path.join(directory, "page.json");
  const client = createClient();
  await pullElementorPage(client, { postId: 12, outputFile });
  const file = JSON.parse(await readFile(outputFile, "utf8"));
  file.data[0].settings.background_color = "#123456";
  file.data[0].elements[0].settings.title = "New heading";
  file.data[0].customExtension.enabled = false;
  await writeFile(outputFile, JSON.stringify(file, null, 2), "utf8");

  const result = await pushElementorPage(client, { dataFile: outputFile });
  const updatedFile = JSON.parse(await readFile(outputFile, "utf8"));
  assert.equal(result.pushed, true);
  assert.equal(result.remote_updated, true);
  assert.equal(result.cache_refreshed, true);
  assert.equal(result.match, true);
  assert.equal(client.currentTree()[0].elements[0].settings.title, "New heading");
  assert.equal(client.currentTree()[0].settings.background_color, "#123456");
  assert.equal(client.currentTree()[0].customExtension.enabled, false);
  assert.equal(updatedFile.source.revision, createElementorRevision(updatedFile.data));
  assert.equal(client.calls.filter((call) => call.type === "write").length, 1);
  assert.equal(client.calls.filter((call) => call.type === "cache").length, 1);
});

/** 验证没有本地修改时 push 不写远端也不刷新缓存。 */
test("pushElementorPage treats an unchanged file as a safe no-op", async (t) => {
  const directory = await createTestDirectory(t);
  const outputFile = path.join(directory, "page.json");
  const client = createClient();
  await pullElementorPage(client, { postId: 12, outputFile });
  client.calls.length = 0;
  const result = await pushElementorPage(client, { dataFile: outputFile });
  assert.equal(result.remote_updated, false);
  assert.equal(result.cache_refreshed, false);
  assert.deepEqual(client.calls.map((call) => call.type), ["read"]);
});

/** 验证旧基线不能覆盖其他编辑器已经修改的页面。 */
test("pushElementorPage rejects a concurrent remote change", async (t) => {
  const directory = await createTestDirectory(t);
  const outputFile = path.join(directory, "page.json");
  const client = createClient();
  await pullElementorPage(client, { postId: 12, outputFile });
  const file = JSON.parse(await readFile(outputFile, "utf8"));
  file.data[0].elements[0].settings.title = "Local";
  await writeFile(outputFile, JSON.stringify(file), "utf8");
  const remote = contentTree();
  remote[0].elements[0].settings.title = "Remote";
  client.replaceTree(remote);
  client.calls.length = 0;

  await assert.rejects(() => pushElementorPage(client, { dataFile: outputFile }), /changed after it was pulled/);
  assert.equal(client.calls.some((call) => call.type === "write"), false);
});

/** 验证已保存但缓存失败的文件可以通过相同 push 安全恢复。 */
test("pushElementorPage retries cache refresh after a partial success", async (t) => {
  const directory = await createTestDirectory(t);
  const outputFile = path.join(directory, "page.json");
  const client = createClient();
  await pullElementorPage(client, { postId: 12, outputFile });
  const file = JSON.parse(await readFile(outputFile, "utf8"));
  file.data[0].elements[0].settings.title = "Saved before cache";
  await writeFile(outputFile, JSON.stringify(file), "utf8");
  let failCache = true;
  client.requestApiPath = async () => {
    if (failCache) throw new Error("cache unavailable");
    return { data: {}, pagination: { total: 0, totalPages: 0 } };
  };

  await assert.rejects(() => pushElementorPage(client, { dataFile: outputFile }), /data was saved.*cache refresh failed/);
  failCache = false;
  const retry = await pushElementorPage(client, { dataFile: outputFile });
  assert.equal(retry.remote_updated, false);
  assert.equal(retry.cache_refreshed, true);
  assert.equal(JSON.parse(await readFile(outputFile, "utf8")).source.revision, retry.revision_after);
});

/** 验证来源站点和文件结构在任何远端请求前完成校验。 */
test("pushElementorPage rejects wrong-site and malformed files before network access", async (t) => {
  const directory = await createTestDirectory(t);
  const client = createClient();
  const wrongSiteFile = path.join(directory, "wrong-site.json");
  await writeFile(wrongSiteFile, JSON.stringify({
    format: ELEMENTOR_FILE_FORMAT,
    version: ELEMENTOR_FILE_VERSION,
    source: { site_url: "https://other.example", post_id: 12, revision: createElementorRevision([]) },
    data: []
  }), "utf8");
  await assert.rejects(() => pushElementorPage(client, { dataFile: wrongSiteFile }), /belongs to/);
  assert.equal(client.calls.length, 0);

  const malformedFile = path.join(directory, "malformed.json");
  await writeFile(malformedFile, JSON.stringify({ format: "wrong", version: 1 }), "utf8");
  await assert.rejects(() => pushElementorPage(client, { dataFile: malformedFile }), /must use format/);
  assert.equal(client.calls.length, 0);
});

/** 验证元素树深度和元素数量保护在写入远端前生效。 */
test("pushElementorPage enforces tree depth and element count limits", async (t) => {
  const directory = await createTestDirectory(t);
  const client = createClient();
  let nested = { id: "node100", elType: "container", settings: {}, elements: [] };
  for (let index = 99; index >= 0; index -= 1) {
    nested = { id: `node${index}`, elType: "container", settings: {}, elements: [nested] };
  }
  const source = {
    site_url: client.baseUrl,
    post_id: 12,
    revision: createElementorRevision(contentTree())
  };
  const deepFile = path.join(directory, "deep.json");
  await writeFile(deepFile, JSON.stringify({
    format: ELEMENTOR_FILE_FORMAT,
    version: ELEMENTOR_FILE_VERSION,
    source,
    data: [nested]
  }), "utf8");
  await assert.rejects(() => pushElementorPage(client, { dataFile: deepFile }), /maximum tree depth of 100/);

  const manyFile = path.join(directory, "many.json");
  const manyElements = Array.from({ length: 100_001 }, (_value, index) => ({
    id: `node${index}`,
    elType: "container",
    settings: {},
    elements: []
  }));
  await writeFile(manyFile, JSON.stringify({
    format: ELEMENTOR_FILE_FORMAT,
    version: ELEMENTOR_FILE_VERSION,
    source,
    data: manyElements
  }), "utf8");
  await assert.rejects(() => pushElementorPage(client, { dataFile: manyFile }), /maximum element count of 100000/);
  assert.equal(client.calls.length, 0);
});

/** 验证超过旧 10 MiB 的 data 可拉取，配置上限仍会受控拒绝。 */
test("Elementor workflow supports data above 10 MiB and enforces configured limits", async (t) => {
  const directory = await createTestDirectory(t);
  const largeTree = [{
    id: "large001",
    elType: "widget",
    widgetType: "text-editor",
    settings: { editor: "x".repeat(11 * 1024 * 1024) },
    elements: []
  }];
  const result = await pullElementorPage(createClient(largeTree), { postId: 12 }, { resultDirectory: directory });
  assert.equal(result.data_bytes > 10 * 1024 * 1024, true);

  await assert.rejects(
    () => pullElementorPage(createClient(contentTree()), { postId: 12 }, { resultDirectory: directory, maxDataBytes: 100 }),
    /maximum size of 100 bytes/
  );
});

/** 验证分发器接受四个文件工作流工具并拒绝旧工具。 */
test("executeElementorTool dispatches the four file workflow tools", async (t) => {
  const directory = await createTestDirectory(t);
  const client = createClient([]);
  const pulled = await executeElementorTool("wp_elementor_pull", client, { postId: 12 }, { resultDirectory: directory });
  const inspected = await executeElementorTool("wp_elementor_inspect", undefined, { dataFile: pulled.file_path });
  const edited = await executeElementorTool("wp_elementor_edit", undefined, {
    dataFile: pulled.file_path,
    expectedFileSha256: inspected.file_sha256,
    operations: [{
      op: "insert_child",
      element: { id: "root001", elType: "container", settings: {}, elements: [] }
    }]
  });
  const pushed = await executeElementorTool("wp_elementor_push", client, { dataFile: pulled.file_path });
  assert.equal(pulled.pulled, true);
  assert.equal(inspected.inspected, true);
  assert.equal(edited.edited, true);
  assert.equal(pushed.pushed, true);
  await assert.rejects(
    () => executeElementorTool("wp_elementor_get", client, { postId: 12 }),
    /Unknown Elementor MCP tool/
  );
});
