import test from "node:test";
import assert from "node:assert/strict";
import { WordPressClient } from "../build/wordpress/client.js";
import { executeWpApiTool } from "../build/mcp/tool-router.js";
import { registerWpApiTools } from "../build/mcp/server.js";

/** 模拟真实客户端请求，以验证认证、路径、schema 保真及原生 Meta 更新。 */
test("catalog discovery and resource editing preserve auth and dynamic values", async () => {
  const calls = [];
  const directory = {
    endpoint: "https://untrusted.example/wp-json/wp/v2/product",
    dynamic_fields: {
      _jc_dynamic_specs: {
        label: "规格", input_type: "repeater",
        schema: { type: "array", items: { type: "object", additionalProperties: false,
          properties: { title: { type: "string", description: "填写规格名称" }, weight: { type: ["number", "string"], pattern: "^$" } } } }
      }
    },
    meta_schema: { category_buying_guide: { type: "string", description: "HTML buying guide" } },
    update_semantics: "null deletes; arrays replace"
  };
  const patch = { _jc_dynamic_zero: 0, _jc_dynamic_clear: null, _jc_dynamic_list: [],
    _jc_dynamic_gallery: "12,34", _jc_dynamic_specs: [{ title: "重量", weight: 2.5 }],
    category_buying_guide: "<p>选购指南</p>" };
  const remote = new WordPressClient({ baseUrl: "https://example.com/site", username: "agent", appPassword: "test-only",
    /** 捕获 HTTP 请求并模拟字段目录和原生资源响应，不访问真实站点。 */
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      const data = String(url).includes("/fields/") ? directory : { id: 123, meta: patch };
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const context = {
    /** 验证工具继续使用用户显式选择的认证连接。 */
    resolveClientImpl: async (input) => { assert.equal(input.client, "factory"); return remote; }
  };
  for (const [target, resourceTarget] of [
    ["product", { type: "post", resource: "products" }],
    ["product_cat", { type: "taxonomy", resource: "product-categories" }]
  ]) {
    const result = await executeWpApiTool("wp_catalog_fields_get", { client: "factory", target }, context);
    assert.deepEqual(result, directory);
    assert.equal(calls.at(-1).url, "https://example.com/site/wp-json/jelly-catalog/v1/fields/" + target);
    assert.equal(calls.at(-1).options.method, "GET");
    assert.equal(new Headers(calls.at(-1).options.headers).get("authorization"), "Basic " + Buffer.from("agent:test-only").toString("base64"));
    const read = await executeWpApiTool("wp_resource_get", { client: "factory", target: resourceTarget, id: 123, context: "edit" }, context);
    assert.deepEqual(read.meta, patch);
    assert.equal(new URL(calls.at(-1).url).searchParams.get("context"), "edit");
    await executeWpApiTool("wp_resource_update", { client: "factory", target: resourceTarget, id: 123, data: { meta: patch } }, context);
    assert.equal(calls.at(-1).url, "https://example.com/site/wp-json/wp/v2/" + target + "/123");
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { meta: patch });
  }
  assert.equal(calls.length, 6);
  await assert.rejects(executeWpApiTool("wp_catalog_fields_get", { client: "factory", target: "../users" }, context), /target must/);
  await assert.rejects(executeWpApiTool("wp_resource_get", { client: "factory", target: { type: "post", resource: "products" }, id: 123, context: "invalid" }, context), /context must/);
  assert.equal(calls.length, 6);
});

/** 确保旧插件及认证失败不会被误报为成功或空字段目录。 */
test("catalog discovery propagates permission and missing endpoint errors", async () => {
  for (const status of [401, 403, 404]) {
    const client = new WordPressClient({ baseUrl: "https://example.com", username: "agent", appPassword: "test-only",
      /** 模拟 WordPress 标准错误响应。 */
      fetchImpl: async () => new Response(JSON.stringify({ code: "rest_error", message: "Directory unavailable" }), { status, headers: { "content-type": "application/json" } })
    });
    await assert.rejects(executeWpApiTool("wp_catalog_fields_get", { client: "factory", target: "product" }, {
      /** 注入隔离的模拟客户端。 */
      resolveClientImpl: async () => client
    }), /Directory unavailable/);
  }
});

/** 验证 MCP 工具发现信息包含认证目标、只读属性和编辑上下文。 */
test("catalog tools advertise discovery and editable resource context", () => {
  const tools = new Map();
  registerWpApiTools({
    /** 收集工具定义，不启动服务器或访问外部服务。 */
    registerTool(name, definition) { tools.set(name, definition); }
  });
  const tool = tools.get("wp_catalog_fields_get");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.inputSchema.target.safeParse("product_cat").success, true);
  assert.equal(tool.inputSchema.target.safeParse("products").success, false);
  assert.equal(tools.get("wp_resource_get").inputSchema.context.safeParse("edit").success, true);
});
