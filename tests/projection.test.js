import test from "node:test";
import assert from "node:assert/strict";
import { listResource, getResource } from "../build/mcp/tools/resources.js";
import { manageLink } from "../build/mcp/tools/link.js";
import { getResourceSeo } from "../build/mcp/tools/seo.js";
import { WordPressClient } from "../build/wordpress/client.js";

/** 固定目标，不依赖真实 WordPress 资源。 */
const target = { type: "post", resource: "posts" };

/** taxonomy 列表保留 WordPress 返回的完整实体和原始分页信息。 */
test("taxonomy list preserves the original entity and pagination", async () => {
  const taxonomy = { type: "taxonomy", resource: "categories" };
  const result = await listResource({
    /** 返回含无关大字段的 taxonomy 末页。 */
    list: async () => ({ items: [{ id: 1, name: "分类", slug: "category", parent: 0, description: "x".repeat(20000) }], pagination: { total: 1, totalPages: 1 } })
  }, { target: taxonomy });
  assert.deepEqual(result.items, [{ id: 1, name: "分类", slug: "category", parent: 0, description: "x".repeat(20000) }]);
  const empty = await listResource({
    /** 空集合保留原始 total/totalPages。 */
    list: async () => ({ items: [], pagination: { total: 0, totalPages: 0 } })
  }, { target });
  assert.deepEqual(empty.pagination, { total: 0, totalPages: 0 });
});
/** 高噪声实体同时包含编辑值、渲染值、空值和大型无关字段。 */
const entity = { id: 1, title: { raw: "标题", rendered: "标题" }, slug: "post", status: "draft",
  content: { raw: "<p>原文</p>", rendered: "<p>不同渲染结果</p>" }, meta: { keep: null, zero: 0, empty: "", noise: "x".repeat(20000) }, _links: { noisy: true } };

/** 资源 list/get 不附加字段投影，直接保留 WordPress 原始响应。 */
test("resource reads preserve the original WordPress response", async () => {
  const calls = [];
  const client = new WordPressClient({ baseUrl: "https://example.test", username: "test", appPassword: "test",
    /** 始终返回完整实体，以验证不能仅依赖上游投影。 */
    fetchImpl: async (url) => {
      calls.push(new URL(url));
      return new Response(JSON.stringify(new URL(url).pathname.endsWith("/1") ? entity : [entity]), {
        headers: { "content-type": "application/json", "x-wp-total": "25", "x-wp-totalpages": "3" } });
    } });
  const list = await listResource(client, { target });
  assert.deepEqual(list.items[0], entity);
  assert.equal(calls[0].searchParams.has("_fields"), false);
  assert.equal(calls[0].searchParams.has("per_page"), false);
  const exact = await getResource(client, { target, id: 1, context: "edit" });
  assert.deepEqual(exact, entity);
  assert.equal(calls[1].searchParams.get("context"), "edit");
  assert.equal(calls[1].searchParams.has("_fields"), false);
  assert.deepEqual(await getResource(client, { target, id: 1 }), entity);
  assert.deepEqual((await listResource(client, { target, page: 3 })).items[0], entity);
  assert.equal(calls[3].searchParams.has("_fields"), false);
  assert.equal(calls.length, 4);
});

/** 真实 HTTP client 路径必须保留 edit/raw 并把写入响应限定到 ID。 */
test("link and SEO internal requests push projections without extra requests", async () => {
  const requests = [];
  const client = new WordPressClient({ baseUrl: "https://example.test", username: "test", appPassword: "test",
    /** 捕获查询和正文，并模拟包含可编辑原值的服务端返回。 */
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), body: options.body && JSON.parse(options.body), method: options.method });
      return new Response(JSON.stringify({ ...entity, content: { raw: '<p><a href="/docs">docs</a></p>' }, meta: { rank_math_title: "SEO" } }), { headers: { "content-type": "application/json" } });
    } });
  const seo = await getResourceSeo(client, { resource: "posts", id: 1 });
  assert.equal(seo.rank_math_title, "SEO");
  assert.equal(requests[0].url.searchParams.get("_fields"), "id,meta");
  const result = await manageLink(client, { resource: "posts", action: "update", id: 1, href: "/docs", newHref: "/manual" });
  assert.equal(result.status, "updated");
  assert.equal(result.updated, true);
  assert.equal(result.resource, "posts");
  assert.equal(requests[1].url.searchParams.get("_fields"), "id,content");
  assert.equal(requests[1].url.searchParams.get("context"), "edit");
  assert.equal(requests[2].url.searchParams.get("_fields"), "id");
  assert.deepEqual(requests[2].body, { content: '<p><a href="/manual">docs</a></p>' });
  assert.equal(requests.length, 3);
});

