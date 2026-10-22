import test from "node:test";
import assert from "node:assert/strict";
import { uploadMedia, updateMediaAlt, listMedia, getMedia, updateMedia, deleteMedia } from "../build/mcp/tools/media.js";
import { executeWpApiTool } from "../build/mcp/tool-router.js";
import { registerWpApiTools } from "../build/mcp/server.js";
import { createMediaCategory, updateMediaCategory, deleteMediaCategory } from "../build/mcp/tools/media.js";
import { batchImportMedia } from "../build/mcp/tools/media.js";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** 验证部分失败仍保留成功回执，逐项顺序上传且不会自动重试。 */
test("media batch import preserves receipts and continues without retrying", async () => {
  const calls = [];
  const client = {
    /** 第二个文件模拟远端超时，其余文件成功。 */
    async uploadMediaFromFile(filePath, options) {
      calls.push({ filePath, options });
      if (filePath === "b.png") throw new Error("Request timed out");
      return { id: calls.length, source_url: `https://example.test/${filePath}`, description: "large content" };
    }
  };
  const result = await batchImportMedia(client, { items: [
    { filePath: "a.png", categories: [2], altText: "图片", post: 42 },
    { filePath: "b.png" }, { filePath: "c.png" }
  ] });
  assert.deepEqual([result.total, result.succeeded, result.failed], [3, 2, 1]);
  assert.deepEqual(result.items.map((item) => [item.index, item.success, item.id]), [[0, true, 1], [1, false, undefined], [2, true, 3]]);
  assert.deepEqual(calls[0].options, { categories: [2], altText: "图片", post: 42 });
  assert.equal(calls.length, 3);
  assert.match(result.next, /before retrying/);
  assert.equal(JSON.stringify(result).includes("large content"), false);
  await assert.rejects(() => batchImportMedia(client, { items: [{ filePath: "a.png" }, { filePath: "b.png", categories: [-1] }] }));
  await assert.rejects(() => batchImportMedia(client, { items: [] }));
  await assert.rejects(() => batchImportMedia(client, { items: Array.from({ length: 101 }, () => ({ filePath: "a.png" })) }));
  assert.equal(calls.length, 3);
});

/** 验证单文件及批量父文章参数校验，并保留显式传入的零值。 */
test("media upload and batch validate parent IDs before uploads", async () => {
  const calls = [];
  const client = {
    /** 记录上传选项以验证零值不会被过滤。 */
    async uploadMediaFromFile(file, options) { calls.push(options); return { id: 1 }; }
  };
  await uploadMedia(client, { filePath: "photo.png", post: 0 });
  assert.deepEqual(calls, [{ post: 0 }]);
  for (const post of [-1, 1.5, "42", null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(() => uploadMedia(client, { filePath: "photo.png", post }));
    await assert.rejects(() => batchImportMedia(client, { items: [{ filePath: "first.png" }, { filePath: "second.png", post }] }));
  }
  assert.equal(calls.length, 1);
});

/** 验证所有批量文件路径在解析客户端之前校验，禁止后续条目绕过允许目录。 */
test("media batch import validates every path before any upload", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wp-api-media-batch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "photo.png");
  await writeFile(file, "fixture");
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "wp-api-media-outside-"));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const outsideFile = path.join(outsideDirectory, "outside.png");
  await writeFile(outsideFile, "fixture");
  let resolves = 0;
  const paths = [];
  const context = {
    allowedLocalRoots: [directory],
    /** 记录客户端解析次数，确保路径失败发生在任何远端调用之前。 */
    async resolveClientImpl() {
      resolves++;
      return {
        /** 返回成功附件并记录真实文件路径。 */
        async uploadMediaFromFile(filePath) { paths.push(filePath); return { id: 1 }; }
      };
    }
  };
  await assert.rejects(() => executeWpApiTool("wp_media_batch_import", {
    client: "test", items: [{ filePath: file }, { filePath: outsideFile }]
  }, context));
  assert.equal(resolves, 0);
  const result = await executeWpApiTool("wp_media_batch_import", { client: "test", items: [{ filePath: file }] }, context);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.next, undefined);
  assert.deepEqual(paths, [await realpath(file)]);
});

/** 验证分类工具分发、分页默认值和分类的独立 REST 路径。 */
test("media categories provide CRUD and preserve empty category discovery", async () => {
  const calls = [];
  const client = {
    /** 记录分类列表请求。 */
    async list(route, query) { calls.push({ route, query }); return { items: [], pagination: { total: 0, totalPages: 0 } }; },
    /** 记录单个分类读取。 */
    async get(route, id) { calls.push({ route, id }); return { id }; },
    /** 记录分类创建字段。 */
    async create(route, body) { calls.push({ route, body }); return { id: 5, ...body }; },
    /** 记录分类更新字段。 */
    async update(route, id, body) { calls.push({ route, id, body }); return { id, ...body }; },
    /** 记录分类删除，确认不会访问媒体文件删除接口。 */
    async delete(route, id, options) { calls.push({ route, id, options }); return { deleted: true }; }
  };
  const context = {
    /** 注入认证客户端替身。 */
    async resolveClientImpl() { return client; }
  };
  await executeWpApiTool("wp_media_category_list", { client: "test", parent: 0 }, context);
  await executeWpApiTool("wp_media_category_get", { client: "test", categoryId: 5 }, context);
  await executeWpApiTool("wp_media_category_create", { client: "test", data: { name: "产品", parent: 0 } }, context);
  await executeWpApiTool("wp_media_category_update", { client: "test", categoryId: 5, data: { description: "", parent: 0 } }, context);
  await executeWpApiTool("wp_media_category_delete", { client: "test", categoryId: 5, force: true }, context);
  assert.deepEqual(calls, [
    { route: "media_category", query: { page: 1, per_page: 20, search: undefined, parent: 0, hide_empty: false } },
    { route: "media_category", id: 5 },
    { route: "media_category", body: { name: "产品", parent: 0 } },
    { route: "media_category", id: 5, body: { description: "", parent: 0 } },
    { route: "media_category", id: 5, options: { force: true } }
  ]);
  await assert.rejects(() => createMediaCategory(client, { data: {} }), /name/);
  await assert.rejects(() => createMediaCategory(client, { data: { name: " " } }), /name/);
  await assert.rejects(() => updateMediaCategory(client, { categoryId: 5, data: { parent: 5 } }), /own parent/);
  await assert.rejects(() => deleteMediaCategory(client, { categoryId: 5 }), /force/);
  assert.equal(calls.length, 5);
});

/** 验证媒体上传、列表与更新统一映射 Jelly Editor 分类字段，并允许清空关联。 */
test("media categories map upload, filtering and replacement without losing empty arrays", async () => {
  const calls = [];
  const client = {
    /** 记录上传时传给 client 的分类选项。 */
    async uploadMediaFromFile(filePath, options) { calls.push(options); return { id: 1 }; },
    /** 记录媒体筛选分类参数。 */
    async list(route, query) { calls.push(query); return { items: [] }; },
    /** 记录媒体分类的替换和清空。 */
    async update(route, id, body) { calls.push(body); return { id, ...body }; }
  };
  await uploadMedia(client, { filePath: "photo.png", categories: [2, 3] });
  await listMedia(client, { categories: [2, 3] });
  await updateMedia(client, { mediaId: 1, data: { categories: [] } });
  assert.deepEqual(calls[0], { categories: [2, 3] });
  assert.equal(calls[1].media_category, "2,3");
  assert.deepEqual(calls[2], { media_category: [] });
  await assert.rejects(() => uploadMedia(client, { filePath: "photo.png", categories: [2, 2] }), /duplicate/);
  await assert.rejects(() => updateMedia(client, { mediaId: 1, data: { categories: [-1] } }), /positive/);
});

/** 验证媒体查询正确映射筛选、分页及编辑上下文，并保留远端分页信息。 */
test("media list/get map REST queries and preserve pagination", async () => {
  const calls = [];
  const page = { items: [{ id: 7 }], pagination: { total: 31, totalPages: 4 } };
  const client = {
    /** 记录列表查询并返回固定分页。 */
    async list(route, query) { calls.push({ route, query }); return page; },
    /** 记录单条查询并返回固定附件。 */
    async get(route, id, query) { calls.push({ route, id, query }); return { id }; }
  };
  assert.equal(await listMedia(client, {
    page: 2, perPage: 10, search: "产品", include: [7, 8], exclude: [9], parent: 0,
    mediaType: "image", mimeType: "image/webp"
  }), page);
  assert.deepEqual(calls[0], { route: "media", query: {
    page: 2, per_page: 10, search: "产品", include: "7,8", exclude: "9", parent: 0,
    media_type: "image", mime_type: "image/webp"
  } });
  await listMedia(client, {});
  assert.equal(calls[1].query.per_page, 20);
  await getMedia(client, { mediaId: 7, context: "edit" });
  assert.deepEqual(calls[2], { route: "media", id: 7, query: { context: "edit" } });
  await getMedia(client, { mediaId: 8 });
  assert.equal(calls[3].query.context, "view");
});

/** 验证元数据更新保留清空语义，永久删除需要显式确认，错误输入不触发写入。 */
test("media metadata update and deletion validate before mutation", async () => {
  const calls = [];
  const client = {
    /** 记录元数据写入并回显实体。 */
    async update(route, id, body) { calls.push({ route, id, body }); return { id, ...body }; },
    /** 记录附件删除并返回 WordPress 删除回执。 */
    async delete(route, id, options) { calls.push({ route, id, options }); return { deleted: true, previous: { id } }; }
  };
  const data = { title: "", caption: "", description: "", altText: "", post: 0, slug: "photo" };
  await updateMedia(client, { mediaId: 7, data });
  assert.deepEqual(calls[0], { route: "media", id: 7, body: {
    title: "", caption: "", description: "", alt_text: "", post: 0, slug: "photo"
  } });
  assert.deepEqual(await deleteMedia(client, { mediaId: 7, force: true }), { deleted: true, previous: { id: 7 } });
  assert.deepEqual(calls[1], { route: "media", id: 7, options: { force: true } });
  for (const data of [{}, null, [], { title: null }, { post: -1 }, { source_url: "x" }, { title: undefined }]) {
    await assert.rejects(() => updateMedia(client, { mediaId: 7, data }));
  }
  for (const force of [undefined, false, "true"]) {
    await assert.rejects(() => deleteMedia(client, { mediaId: 7, force }), /force: true/);
  }
  await assert.rejects(() => deleteMedia(client, { mediaId: 0, force: true }), /positive integer/);
  assert.equal(calls.length, 2);
});

/** 验证无效查询在访问远端前失败，远端权限错误保持原样。 */
test("media read validation and upstream errors", async () => {
  const error = new Error("403 Forbidden");
  const client = {
    /** 抛出固定远端错误，用于区分本地校验与上游失败。 */
    async get() { throw error; }
  };
  for (const input of [{ perPage: 101 }, { page: 0 }, { include: [1, 1] }, { exclude: [-1] }, { parent: -1 }, { mediaType: "bad" }]) {
    await assert.rejects(() => listMedia(client, input));
  }
  await assert.rejects(() => getMedia(client, { mediaId: 1, context: "bad" }), /context/);
  await assert.rejects(() => getMedia(client, { mediaId: 1 }), (actual) => actual === error);
});

/** 验证新增工具通过认证 client 分发，并在 MCP schema 中暴露必要字段与删除约束。 */
test("media tools register and dispatch through authenticated client", async () => {
  const registrations = new Map();
  registerWpApiTools({
    /** 收集工具定义以验证外部可见契约。 */
    registerTool(name, definition) { registrations.set(name, definition); }
  });
  for (const name of ["list", "get", "update", "delete", "upload", "alt_update"]) {
    assert.ok(registrations.has(`wp_media_${name}`));
  }
  assert.equal(registrations.get("wp_media_delete").inputSchema.force.safeParse(false).success, false);
  assert.equal(registrations.get("wp_media_delete").inputSchema.force.safeParse(undefined).success, false);
  const dataSchema = registrations.get("wp_media_update").inputSchema.data;
  assert.equal(dataSchema.safeParse({}).success, false);
  assert.equal(dataSchema.safeParse({ title: "", post: 0 }).success, true);
  assert.equal(dataSchema.safeParse({ source_url: "x" }).success, false);
  const calls = [];
  const client = {
    /** 记录路由器调用的媒体列表。 */
    async list(route) { calls.push(["list", route]); return { items: [], pagination: { total: 0, totalPages: 0 } }; },
    /** 记录路由器调用的单条读取。 */
    async get(route, id) { calls.push(["get", route, id]); return { id }; },
    /** 记录路由器调用的元数据更新。 */
    async update(route, id) { calls.push(["update", route, id]); return { id }; },
    /** 记录路由器调用的永久删除。 */
    async delete(route, id) { calls.push(["delete", route, id]); return { deleted: true }; }
  };
  const context = {
    /** 提供认证 client 的测试替身。 */
    async resolveClientImpl() { return client; }
  };
  await executeWpApiTool("wp_media_list", { client: "test" }, context);
  await executeWpApiTool("wp_media_get", { client: "test", mediaId: 7 }, context);
  await executeWpApiTool("wp_media_update", { client: "test", mediaId: 7, data: { title: "photo" } }, context);
  await executeWpApiTool("wp_media_delete", { client: "test", mediaId: 7, force: true }, context);
  assert.deepEqual(calls, [["list", "media"], ["get", "media", 7], ["update", "media", 7], ["delete", "media", 7]]);
});

/** 验证媒体上传无需 CLI 参数层即可把 camelCase 元数据传给 WordPress client。 */
test("content handler maps media upload input directly", async () => {
  const calls = [];
  const client = {
    /** 记录媒体上传调用并返回模拟附件实体。 */
    async uploadMediaFromFile(filePath, options) {
      calls.push({ filePath, options });
      return { id: 15, source_url: "https://example.test/image.png" };
    }
  };

  const result = await uploadMedia(client, {
    filePath: "C:/safe/image.png",
    title: "Image",
    altText: "Alternative",
    caption: "",
    description: "Description"
  });

  assert.equal(result.id, 15);
  assert.deepEqual(calls, [{
    filePath: "C:/safe/image.png",
    options: { title: "Image", altText: "Alternative", description: "Description" }
  }]);
});

/** 验证媒体替代文本更新按附件 ID 写入 REST alt_text，并保留用于清除的空字符串。 */
test("content handler updates or clears existing media alt text", async () => {
  const calls = [];
  const client = {
    /** 记录媒体更新调用并返回模拟附件实体。 */
    async update(route, id, body) {
      calls.push({ route, id, body });
      return { id, alt_text: body.alt_text };
    }
  };

  const updated = await updateMediaAlt(client, { mediaId: 15, altText: "产品正面图" });
  const cleared = await updateMediaAlt(client, { mediaId: 16, altText: "" });

  assert.equal(updated.alt_text, "产品正面图");
  assert.equal(cleared.alt_text, "");
  assert.deepEqual(calls, [
    { route: "media", id: 15, body: { alt_text: "产品正面图" } },
    { route: "media", id: 16, body: { alt_text: "" } }
  ]);
  await assert.rejects(() => updateMediaAlt(client, { mediaId: 0, altText: "无效" }), /positive integer/);
  await assert.rejects(() => updateMediaAlt(client, { mediaId: 17, altText: undefined }), /must be a string/);
});


