import test from "node:test";
import assert from "node:assert/strict";

import {
  executeElementorTool,
  importElementorPage,
  readElementorPage,
  updateElementorPageContent
} from "../build/mcp/handlers/elementor-tools.js";
import { createElementorRevision } from "../build/lib/elementor.js";

/** 构造包含 Elementor 元数据的 WordPress REST 页面实体。 */
function elementorEntity(data) {
  return {
    id: 12,
    type: "page",
    meta: {
      _elementor_data: JSON.stringify(data),
      _elementor_edit_mode: "builder"
    }
  };
}

/** 构造同时包含正文与样式的测试元素树。 */
function contentTree() {
  return [{
    id: "root001",
    elType: "container",
    settings: { flex_direction: "column", background_color: "#fff" },
    elements: [
      {
        id: "head001",
        elType: "widget",
        widgetType: "heading",
        settings: { title: "Old heading", title_color: "#000" },
        elements: []
      },
      {
        id: "text001",
        elType: "widget",
        widgetType: "text-editor",
        settings: { editor: "Body copy" },
        elements: []
      }
    ]
  }];
}

/** 验证默认读取只返回可修改正文，并明确告诉 Agent 如何构造局部修改。 */
test("readElementorPage returns content-only edit targets and guidance", async () => {
  const calls = [];
  const client = {
    /** 记录页面读取，并返回固定 Elementor 页面。 */
    async request(route, options) {
      calls.push({ route, options });
      return { data: elementorEntity(contentTree()), pagination: { total: 0, totalPages: 0 } };
    }
  };

  const result = await readElementorPage(client, { postId: 12, searchText: "heading" });

  assert.deepEqual(calls, [{ route: "pages/12", options: { query: { context: "edit" } } }]);
  assert.deepEqual(result.elements, [{ elementId: "head001", settings: { title: "Old heading" } }]);
  assert.equal(result.view, "content");
  assert.equal(result.count, 1);
  assert.equal(result.revision, createElementorRevision(contentTree()));
  assert.match(result.how_to_update, /wp_elementor_update.*revision.*expectedRevision.*elementId.*title/);
  assert.doesNotMatch(JSON.stringify(result), /widgetType|title_color|flex_direction/);
});

/** 验证完整数据只在显式 data 视图下返回，以便覆盖前备份。 */
test("readElementorPage returns full data only when requested", async () => {
  const tree = contentTree();
  const client = {
    /** 返回固定 Elementor 页面。 */
    async request() {
      return { data: elementorEntity(tree), pagination: { total: 0, totalPages: 0 } };
    }
  };

  const result = await readElementorPage(client, { postId: 12, view: "data" });

  assert.equal(result.view, "data");
  assert.deepEqual(result.data, tree);
  assert.equal(result.elements_count, 3);
  assert.equal(result.revision, createElementorRevision(tree));
  assert.equal("how_to_update" in result, false);
});

/** 验证多项正文修改只读取和保存页面一次，并完整保留布局与样式。 */
test("updateElementorPageContent applies partial changes in one page save", async () => {
  const calls = [];
  const client = {
    /** 返回修改前的 Elementor 页面。 */
    async request(route, options) {
      calls.push({ method: "read", route, options });
      return { data: elementorEntity(contentTree()), pagination: { total: 0, totalPages: 0 } };
    },
    /** 记录局部修改最终执行的唯一页面写入。 */
    async update(route, id, body) {
      calls.push({ method: "write", route, id, body });
      return elementorEntity(JSON.parse(body.meta._elementor_data));
    },
    /** 记录页面保存后的 Elementor 全站缓存刷新。 */
    async requestApiPath(apiPath, options) {
      calls.push({ method: "cache", apiPath, options });
      return { data: { success: true }, pagination: { total: 0, totalPages: 0 } };
    }
  };

  const result = await updateElementorPageContent(client, {
    postId: 12,
    expectedRevision: createElementorRevision(contentTree()),
    changes: [
      { elementId: "head001", settings: { title: "New heading" } },
      { elementId: "text001", settings: { editor: "New body" } }
    ]
  });

  assert.equal(result.updated, true);
  assert.deepEqual(result.changes, [
    { elementId: "head001", fields: ["title"] },
    { elementId: "text001", fields: ["editor"] }
  ]);
  assert.equal(result.cache_refreshed, true);
  assert.equal(calls.length, 3);
  const savedTree = JSON.parse(calls[1].body.meta._elementor_data);
  assert.equal(savedTree[0].settings.background_color, "#fff");
  assert.equal(savedTree[0].elements[0].settings.title, "New heading");
  assert.equal(savedTree[0].elements[0].settings.title_color, "#000");
  assert.equal(savedTree[0].elements[1].settings.editor, "New body");
  assert.equal(calls[1].route, "pages");
  assert.equal(calls[1].id, 12);
  assert.deepEqual(calls[2], { method: "cache", apiPath: "elementor/v1/cache", options: { method: "DELETE" } });
});

/** 验证覆盖导入直接替换完整页面树并报告递归元素数量。 */
test("importElementorPage replaces the complete page tree", async () => {
  const calls = [];
  const tree = contentTree();
  const client = {
    /** 记录覆盖导入的页面写入。 */
    async update(route, id, body) {
      calls.push({ route, id, body });
      return elementorEntity(tree);
    },
    /** 记录覆盖导入后的 Elementor 全站缓存刷新。 */
    async requestApiPath(apiPath, options) {
      calls.push({ apiPath, options });
      return { data: { success: true }, pagination: { total: 0, totalPages: 0 } };
    }
  };

  const result = await importElementorPage(client, { postId: 12, data: tree });

  assert.equal(result.imported, true);
  assert.equal(result.elements_count, 3);
  assert.equal(result.cache_refreshed, true);
  assert.equal(calls[0].route, "pages");
  assert.deepEqual(JSON.parse(calls[0].body.meta._elementor_data), tree);
  assert.deepEqual(calls[1], { apiPath: "elementor/v1/cache", options: { method: "DELETE" } });
});

/** 验证页面已保存但缓存刷新失败时返回明确的部分成功错误。 */
test("Elementor writes report cache failures after persistence", async () => {
  let writes = 0;
  const client = {
    /** 返回修改前的 Elementor 页面。 */
    async request() {
      return { data: elementorEntity(contentTree()), pagination: { total: 0, totalPages: 0 } };
    },
    /** 保存页面数据并记录已经发生的持久化。 */
    async update(route, id, body) {
      writes += 1;
      return elementorEntity(JSON.parse(body.meta._elementor_data));
    },
    /** 模拟 Elementor 缓存端点失败。 */
    async requestApiPath() {
      throw new Error("cache endpoint unavailable");
    }
  };

  await assert.rejects(
    () => updateElementorPageContent(client, {
      postId: 12,
      expectedRevision: createElementorRevision(contentTree()),
      changes: [{ elementId: "head001", settings: { title: "Saved heading" } }]
    }),
    /page data was saved.*cache refresh failed.*endpoint unavailable/
  );
  assert.equal(writes, 1);
});

/** 验证局部修改拒绝布局、样式、不存在元素和资源覆盖，失败时不写页面。 */
test("Elementor update rejects non-content operations before writing", async () => {
  let writes = 0;
  const client = {
    /** 返回固定 Elementor 页面。 */
    async request() {
      return { data: elementorEntity(contentTree()), pagination: { total: 0, totalPages: 0 } };
    },
    /** 记录所有不应发生的写入。 */
    async update() {
      writes += 1;
      return {};
    }
  };

  await assert.rejects(
    () => updateElementorPageContent(client, { postId: 12, expectedRevision: createElementorRevision(contentTree()), changes: [{ elementId: "head001", settings: { title_color: "#fff" } }] }),
    /not editable/
  );
  await assert.rejects(
    () => updateElementorPageContent(client, { postId: 12, expectedRevision: createElementorRevision(contentTree()), changes: [{ elementId: "missing", settings: { title: "New" } }] }),
    /not found/
  );
  await assert.rejects(
    () => readElementorPage(client, { postId: 12, resource: "posts" }),
    /pages is always used/
  );
  await assert.rejects(
    () => readElementorPage(client, { postId: 12, view: "data", searchText: "heading" }),
    /only supported by the content view/
  );
  assert.equal(writes, 0);
});

/** 验证页面在读取后发生变化时，局部修改会拒绝旧版本并且不执行写入。 */
test("Elementor update rejects a stale revision before writing", async () => {
  let writes = 0;
  const client = {
    /** 返回已变化的当前 Elementor 页面。 */
    async request() {
      const tree = contentTree();
      tree[0].elements[0].settings.title = "Changed elsewhere";
      return { data: elementorEntity(tree), pagination: { total: 0, totalPages: 0 } };
    },
    /** 记录并发冲突时不应发生的页面写入。 */
    async update() {
      writes += 1;
      return {};
    }
  };

  await assert.rejects(
    () => updateElementorPageContent(client, {
      postId: 12,
      expectedRevision: createElementorRevision(contentTree()),
      changes: [{ elementId: "head001", settings: { title: "New heading" } }]
    }),
    /changed after it was read/
  );
  assert.equal(writes, 0);
});

/** 验证分发器只接受读取、局部修改和覆盖导入三个页面内容工具。 */
test("executeElementorTool dispatches only the three supported tools", async () => {
  const client = {
    /** 返回空 Elementor 页面。 */
    async request() {
      return { data: elementorEntity([]), pagination: { total: 0, totalPages: 0 } };
    },
    /** 接受测试中的空树覆盖写入。 */
    async update() {
      return elementorEntity([]);
    },
    /** 接受测试中的全站缓存清理请求。 */
    async requestApiPath() {
      return { data: { success: true }, pagination: { total: 0, totalPages: 0 } };
    }
  };

  const readResult = await executeElementorTool("wp_elementor_get", client, { postId: 12 });
  await assert.rejects(
    () => executeElementorTool("wp_elementor_update", client, { postId: 12, expectedRevision: createElementorRevision([]), changes: [{ elementId: "missing", settings: { title: "New" } }] }),
    /not found/
  );
  const importResult = await executeElementorTool("wp_elementor_import", client, { postId: 12, data: [] });

  assert.equal(readResult.view, "content");
  assert.equal(importResult.imported, true);
  await assert.rejects(
    () => executeElementorTool("wp_elementor_export", client, { postId: 12 }),
    /Unknown Elementor MCP tool/
  );
});

/** 验证读取和覆盖导入都会拒绝畸形或超过安全深度的元素树。 */
test("Elementor handlers validate remote and imported element trees", async () => {
  const malformedClient = {
    /** 返回缺少 settings 的畸形远端元素。 */
    async request() {
      return {
        data: elementorEntity([{ id: "broken", elType: "widget", elements: [] }]),
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };
  await assert.rejects(() => readElementorPage(malformedClient, { postId: 12 }), /must have a settings object or an empty array/);

  const hiddenMetaClient = {
    /** 模拟未通过 WordPress REST 注册 Elementor 私有元数据的页面。 */
    async request() {
      return { data: { id: 12, type: "page", meta: {} }, pagination: { total: 0, totalPages: 0 } };
    }
  };
  await assert.rejects(
    () => readElementorPage(hiddenMetaClient, { postId: 12 }),
    /not exposed.*show_in_rest/
  );

  const emptySettingsClient = {
    /** 返回符合 Elementor 官方格式、使用空 settings 数组的容器。 */
    async request() {
      return {
        data: elementorEntity([{ id: "empty001", elType: "container", settings: [], elements: [] }]),
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };
  const emptySettingsResult = await readElementorPage(emptySettingsClient, { postId: 12 });
  assert.deepEqual(emptySettingsResult.elements, []);

  let nested = { id: "node100", elType: "container", settings: {}, elements: [] };
  for (let index = 99; index >= 0; index -= 1) {
    nested = { id: `node${index}`, elType: "container", settings: {}, elements: [nested] };
  }
  const noWriteClient = {
    /** 拒绝所有不应到达的页面写入。 */
    async update() {
      throw new Error("Unexpected write");
    }
  };
  await assert.rejects(
    () => importElementorPage(noWriteClient, { postId: 12, data: [nested] }),
    /maximum tree depth of 100/
  );
});
