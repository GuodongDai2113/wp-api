import test from "node:test";
import assert from "node:assert/strict";
import { getApiRoute } from "../build/mcp/tools/api-route.js";

/** 构建含长描述、重复参数名和深层约束的响应，验证默认披露与完整读取边界。 */
function createFixture() {
  const definition = {
    type: "object",
    description: "详细说明".repeat(2000),
    properties: { nested: { properties: { value: { oneOf: [{ const: "a" }, { const: "b" }] } } } }
  };
  const route = {
    namespace: "wp/v2",
    endpoints: [
      { methods: ["GET"], args: { context: { type: "string" } } },
      { methods: ["POST"], args: { context: { type: "string", required: true }, meta: definition } }
    ],
    schema: { properties: { id: { type: "integer" }, meta: definition } }
  };
  const root = {
    namespaces: ["wp/v2"],
    routes: Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`/wp/v2/item${index}`, route]))
  };
  const calls = [];
  const client = {
    /** 记录请求并返回对应的固定元数据，不进行网络访问。 */
    async requestApiPath(path, options) {
      calls.push({ path, ...options });
      return { data: path ? route : root };
    }
  };
  return { client, root, route, calls, definition };
}

test("默认逐层披露：站点概览、分页路由、接口概览均不泄漏定义", async () => {
  const { client, root, calls } = createFixture();
  const base = { domain: "example.com" };
  const overview = await getApiRoute(client, base);
  assert.equal(overview.detail, "overview");
  assert.deepEqual(overview.schema, { namespaces: ["wp/v2"], routeCount: 45 });
  assert.match(overview.next, /search/);
  const paths = [];
  for (const offset of [0, 20, 40]) {
    const page = await getApiRoute(client, { ...base, section: "routes", offset });
    paths.push(...page.schema.routes.map((item) => item.path));
    assert.equal(page.schema.hasMore, offset < 40);
    assert.equal(page.schema.limit, 20);
    assert.equal(JSON.stringify(page).includes("详细说明"), false);
  }
  assert.equal(new Set(paths).size, Object.keys(root.routes).length);
  const route = await getApiRoute(client, { ...base, apiPath: "wp/v2/item0" });
  assert.deepEqual(route.schema, {
    namespace: "wp/v2", methods: ["GET", "POST"],
    endpoints: [{ methods: ["GET"], argumentCount: 1 }, { methods: ["POST"], argumentCount: 2 }],
    fieldCount: 2
  });
  assert.equal(JSON.stringify(route).includes("nested"), false);
  assert.equal(calls.at(-1).method, "OPTIONS");
});

test("参数和字段先返回名称目录，按方法和名称读取完整深层定义", async () => {
  const { client, definition, route } = createFixture();
  const base = { domain: "example.com", apiPath: "wp/v2/item0" };
  const directory = await getApiRoute(client, { ...base, section: "arguments", httpMethod: "post", limit: 1 });
  assert.deepEqual(directory.schema.items, [{ name: "context", methods: ["POST"] }]);
  assert.equal(directory.schema.total, 2);
  assert.equal(directory.schema.hasMore, true);
  const selected = await getApiRoute(client, {
    ...base, section: "arguments", httpMethod: "POST", names: ["meta"], detail: "full"
  });
  assert.deepEqual(selected.schema.items, [{ name: "meta", methods: ["POST"], definition }]);
  const field = await getApiRoute(client, { ...base, section: "fields", names: ["meta"], detail: "full" });
  assert.deepEqual(field.schema.items, [{ name: "meta", definition }]);
  const filtered = await getApiRoute(client, { ...base, section: "fields", search: "META" });
  assert.deepEqual(filtered.schema.items, [{ name: "meta" }]);
  const compact = await getApiRoute(client, { ...base, section: "arguments", names: ["context"], detail: "summary" });
  assert.equal(compact.schema.total, 2);
  assert.deepEqual(compact.schema.items[1].definition, { type: "string", required: true });
  const full = await getApiRoute(client, { ...base, detail: "full" });
  assert.deepEqual(full.schema, route);
  const overview = await getApiRoute(client, base);
  assert.ok(JSON.stringify(overview).length < JSON.stringify(full).length / 10);
});

test("无效披露组合在请求前拒绝，缺失方法和名称明确报错", async () => {
  const { client, calls } = createFixture();
  const base = { domain: "example.com" };
  for (const input of [
    { detail: "invalid" }, { section: "invalid" }, { section: "arguments" },
    { apiPath: "wp/v2/posts", section: "routes" }, { limit: 101 }, { offset: -1 },
    { search: " " }, { names: ["id"] }, { httpMethod: "GET" },
    { apiPath: "wp/v2/posts", search: "id" },
    { apiPath: "wp/v2/posts", section: "fields", names: [] }
  ]) {
    await assert.rejects(() => getApiRoute(client, { ...base, ...input }), TypeError);
  }
  assert.equal(calls.length, 0);
  await assert.rejects(() => getApiRoute(client, {
    ...base, apiPath: "wp/v2/posts", section: "arguments", httpMethod: "DELETE"
  }), /No endpoint/);
  await assert.rejects(() => getApiRoute(client, {
    ...base, apiPath: "wp/v2/posts", section: "fields", names: ["missing"]
  }), /Unknown fields names/);
});
