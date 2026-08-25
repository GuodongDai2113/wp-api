import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createResource,
  deleteResource,
  listResource,
  managePostLink,
  replacePostContent,
  updateResource,
  updateResourceSeo,
  uploadMedia
} from "../build/mcp/handlers/content-tools.js";

/** 验证资源列表会把 MCP camelCase 查询字段直接映射到 WordPress REST 字段。 */
test("content handler maps resource list input without CLI arguments", async () => {
  const calls = [];
  const client = {
    /** 记录资源列表调用并返回稳定的测试结果。 */
    async list(route, query) {
      calls.push({ route, query });
      return { items: [{ id: 7 }], pagination: { total: 1, totalPages: 1 } };
    }
  };

  const result = await listResource(client, {
    resource: "products",
    search: "shoe",
    page: 2,
    perPage: 25,
    status: "publish"
  });

  assert.deepEqual(calls, [{
    route: "product",
    query: { search: "shoe", page: 2, per_page: 25, status: "publish" }
  }]);
  assert.equal(result.items[0].id, 7);
});

/** 验证正文文件可由纯 MCP handler 读取并在提交前转换为 Gutenberg 内容。 */
test("content handler resolves contentFile and converts Gutenberg content", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "wp-api-content-handler-"));
  const contentFile = join(tempDir, "post.html");
  await writeFile(contentFile, "<p>File body</p>", "utf8");
  const calls = [];
  const client = {
    /** 记录资源创建调用并原样返回请求体。 */
    async create(route, body) {
      calls.push({ route, body });
      return { id: 8, ...body };
    }
  };

  try {
    await createResource(client, {
      resource: "posts",
      title: "From file",
      contentFile,
      gutenberg: true
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  assert.equal(calls[0].route, "posts");
  assert.equal(calls[0].body.title, "From file");
  assert.match(calls[0].body.content, /<!-- wp:paragraph -->/);
  assert.match(calls[0].body.content, /<p>File body<\/p>/);
});

/** 验证资源写入路径会提交清理后的 Gutenberg 内容，而不会把活动 HTML 传给 WordPress。 */
test("content handler sanitizes active HTML before Gutenberg writes", async () => {
  const calls = [];
  const client = {
    /** 记录资源创建请求，以便确认最终传给 WordPress 的正文已经完成安全清理。 */
    async create(route, body) {
      calls.push({ route, body });
      return { id: 18, ...body };
    }
  };

  await createResource(client, {
    resource: "posts",
    content: '<p onclick="alert(1)"><a href="javascript:alert(2)">Unsafe</a><a href="/safe">Safe</a></p>',
    gutenberg: true
  });

  assert.equal(calls[0].route, "posts");
  assert.doesNotMatch(calls[0].body.content, /onclick|javascript:/i);
  assert.match(calls[0].body.content, /<a>Unsafe<\/a><a href="\/safe">Safe<\/a>/);
});

/** 验证资源更新保留空字符串、0 和空数组所表达的显式清空操作。 */
test("content handler preserves explicit clearing values", async () => {
  const calls = [];
  const client = {
    /** 记录资源更新调用并返回最小资源实体。 */
    async update(route, id, body) {
      calls.push({ route, id, body });
      return { id };
    }
  };

  await updateResource(client, {
    resource: "posts",
    id: 42,
    title: "",
    content: "",
    featuredMedia: 0,
    categories: []
  });

  assert.deepEqual(calls, [{
    route: "posts",
    id: 42,
    body: { title: "", content: "", featured_media: 0, categories: [] }
  }]);
});

test("content handler maps Jelly Catalog taxonomy and REST meta fields", async () => {
  const calls = [];
  const client = {
    /** 记录 Jelly Catalog 产品创建请求。 */
    async create(route, body) {
      calls.push({ route, body });
      return { id: 11 };
    }
  };

  await createResource(client, {
    resource: "products",
    title: "Catalog product",
    productCategories: [2, 5],
    productTags: [],
    meta: {
      _product_sku: "JC-100",
      _product_attributes: [{ name: "Material", value: "Steel" }]
    }
  });

  assert.deepEqual(calls, [{
    route: "product",
    body: {
      title: "Catalog product",
      product_cat: [2, 5],
      product_tag: [],
      meta: {
        _product_sku: "JC-100",
        _product_attributes: [{ name: "Material", value: "Steel" }]
      }
    }
  }]);
});

test("content handler maps Jelly Catalog product tag resources", async () => {
  const calls = [];
  const client = {
    /** 记录产品标签创建请求。 */
    async create(route, body) {
      calls.push({ route, body });
      return { id: 12 };
    }
  };

  await createResource(client, {
    resource: "product-tags",
    name: "Industrial"
  });

  assert.deepEqual(calls, [{ route: "product_tag", body: { name: "Industrial" } }]);

  await assert.rejects(
    () => createResource(client, { resource: "product-tags", name: "Child", parent: 4 }),
    /not supported for product-tags: parent/
  );
});

/** 验证 taxonomy 删除必须显式确认永久删除，确认后固定向 client 传递 force。 */
test("content handler requires force for taxonomy deletion", async () => {
  const calls = [];
  const client = {
    /** 记录资源删除调用并返回最小资源实体。 */
    async delete(route, id, options) {
      calls.push({ route, id, options });
      return { id };
    }
  };

  await assert.rejects(
    deleteResource(client, { resource: "categories", id: 9 }),
    /set force to true/
  );
  const result = await deleteResource(client, { resource: "categories", id: 9, force: true });

  assert.equal(result.id, 9);
  assert.deepEqual(calls, [{ route: "categories", id: 9, options: { force: true } }]);
});

/** 验证 SEO 更新会把空字符串作为清空值提交并返回稳定字段名。 */
test("content handler preserves explicit SEO clearing", async () => {
  const calls = [];
  const client = {
    /** 记录 SEO 更新调用，并模拟 WordPress 返回更新后的 meta。 */
    async update(route, id, body) {
      calls.push({ route, id, body });
      return { id, meta: body.meta };
    }
  };

  const result = await updateResourceSeo(client, {
    resource: "pages",
    id: 3,
    title: "",
    focusKeyword: "keyword"
  });

  assert.deepEqual(calls[0], {
    route: "pages",
    id: 3,
    body: { meta: { rank_math_title: "", rank_math_focus_keyword: "keyword" } }
  });
  assert.deepEqual(result, {
    id: 3,
    resource: "pages",
    rank_math_title: "",
    rank_math_description: "",
    rank_math_focus_keyword: "keyword"
  });
});

/** 验证文章链接和正文替换只在发生变化时调用 WordPress 更新接口。 */
test("content handler writes changed post content directly", async () => {
  const updates = [];
  const client = {
    /** 根据文章 ID 返回对应的可编辑原始正文。 */
    async get(_route, id) {
      return id === 1
        ? { id, content: { raw: "Read docs now" } }
        : { id, content: { raw: "wrong wrong" } };
    },
    /** 记录 handler 写回的文章正文。 */
    async update(route, id, body) {
      updates.push({ route, id, body });
      return { id };
    }
  };

  const linkResult = await managePostLink(client, {
    action: "add",
    postId: 1,
    text: "docs",
    href: "/docs"
  });
  const replaceResult = await replacePostContent(client, {
    postId: 2,
    text: "wrong",
    replacement: "right"
  });

  assert.equal(linkResult.status, "updated");
  assert.equal(replaceResult.replacements, 2);
  assert.deepEqual(updates, [
    { route: "posts", id: 1, body: { content: "Read <a href=\"/docs\">docs</a> now" } },
    { route: "posts", id: 2, body: { content: "right right" } }
  ]);
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

/** 资源创建必须提供适用于所选资源类型的字段，不能静默丢弃错误域字段。 */
test("content handler rejects empty creates and fields from another resource kind", async () => {
  let creates = 0;
  const client = {
    /** 记录所有不应发生的远端创建调用。 */
    async create() {
      creates += 1;
      return {};
    }
  };

  await assert.rejects(
    () => createResource(client, { resource: "posts" }),
    /At least one applicable resource field/
  );
  await assert.rejects(
    () => createResource(client, { resource: "posts", name: "Wrong field" }),
    /not supported for posts: name/
  );
  await assert.rejects(
    () => createResource(client, { resource: "categories", title: "Wrong field" }),
    /not supported for categories: title/
  );
  assert.equal(creates, 0);
});

/** 资源更新在没有适用字段或混入错误域字段时应在本地失败。 */
test("content handler rejects empty or mismatched resource updates", async () => {
  let updates = 0;
  const client = {
    /** 记录所有不应发生的远端更新调用。 */
    async update() {
      updates += 1;
      return {};
    }
  };

  await assert.rejects(
    () => updateResource(client, { resource: "pages", id: 7 }),
    /No update fields were provided/
  );
  await assert.rejects(
    () => updateResource(client, { resource: "product-categories", id: 8, content: "wrong" }),
    /not supported for product-categories: content/
  );
  assert.equal(updates, 0);
});
