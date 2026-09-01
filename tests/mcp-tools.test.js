import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  executeWpApiTool,
  WP_API_TOOL_NAMES
} from "../build/mcp/wp-api-tools.js";
import { registerWpApiTools } from "../build/mcp/server.js";
import { ConfigStore } from "../build/lib/config-store.js";

/** 使用最小 MCP server 替身收集全部工具注册定义。 */
function collectRegistrations() {
  const registrations = new Map();
  const server = {
    /** 记录服务注册的工具名称和定义。 */
    registerTool(name, definition) {
      registrations.set(name, definition);
    }
  };
  registerWpApiTools(server);
  return registrations;
}

/** 创建只实现当前测试显式提供方法的远端 WordPress client 替身。 */
function createRemoteClientStub(overrides = {}) {
  return {
    /** 拒绝未在测试中声明的自定义 REST API 请求。 */
    async requestApiPath() {
      throw new Error("Unexpected requestApiPath call.");
    },
    /** 拒绝未在测试中声明的列表请求。 */
    async list() {
      throw new Error("Unexpected list call.");
    },
    /** 拒绝未在测试中声明的单资源读取请求。 */
    async get() {
      throw new Error("Unexpected get call.");
    },
    /** 拒绝未在测试中声明的资源创建请求。 */
    async create() {
      throw new Error("Unexpected create call.");
    },
    /** 拒绝未在测试中声明的资源更新请求。 */
    async update() {
      throw new Error("Unexpected update call.");
    },
    /** 拒绝未在测试中声明的资源删除请求。 */
    async delete() {
      throw new Error("Unexpected delete call.");
    },
    /** 拒绝未在测试中声明的通用 REST 请求。 */
    async request() {
      throw new Error("Unexpected request call.");
    },
    /** 拒绝未在测试中声明的媒体上传请求。 */
    async uploadMediaFromFile() {
      throw new Error("Unexpected uploadMediaFromFile call.");
    },
    /** 拒绝未在测试中声明的插件上传请求。 */
    async uploadPluginFromFile() {
      throw new Error("Unexpected uploadPluginFromFile call.");
    },
    /** 拒绝未在测试中声明的主题上传请求。 */
    async uploadThemeFromFile() {
      throw new Error("Unexpected uploadThemeFromFile call.");
    },
    /** 拒绝未在测试中声明的主题状态请求。 */
    async updateThemeStatus() {
      throw new Error("Unexpected updateThemeStatus call.");
    },
    ...overrides
  };
}

test("MCP server 只注册当前纯 MCP 工具集合", () => {
  const registrations = collectRegistrations();
  assert.deepEqual([...registrations.keys()].sort(), [...WP_API_TOOL_NAMES].sort());
  assert.equal(registrations.get("wp_client_get").inputSchema.name.safeParse(undefined).success, false);
  assert.equal(registrations.get("wp_resource_get").inputSchema.client.safeParse(undefined).success, false);

  for (const registration of registrations.values()) {
    assert.deepEqual(Object.keys(registration.annotations).sort(), [
      "destructiveHint",
      "idempotentHint",
      "openWorldHint",
      "readOnlyHint"
    ]);
    assert.equal(Object.values(registration.annotations).every((value) => typeof value === "boolean"), true);
  }

  assert.deepEqual(registrations.get("wp_structure_get").annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  });
  assert.deepEqual(registrations.get("wp_resource_delete").annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
  });

  for (const removedName of [
    "wp_client_add",
    "wp_api_schema",
    "wp_plugin_list",
    "wp_theme_push",
    "wp_elementor_get_tokens",
    "wp_elementor_add_widget",
    "wp_elementor_cache_clear",
    "wp_elementor_read",
    "wp_elementor_init",
    "wp_elementor_export",
    "wp_elementor_structure",
    "wp_elementor_get_element",
    "wp_elementor_find"
  ]) {
    assert.equal(registrations.has(removedName), false);
  }
});

test("REST schema 工具读取路由索引和指定接口的 OPTIONS 定义", async () => {
  const calls = [];
  const rootSchema = {
    namespaces: ["wp/v2", "jelly-form/v1"],
    routes: {
      "/wp/v2/posts": {
        namespace: "wp/v2",
        endpoints: [{ methods: ["GET", "POST"] }]
      },
      "/wp/v2/pages": {
        namespace: "wp/v2",
        endpoints: [{ methods: ["GET"] }]
      },
      "/jelly-form/v1/settings": {
        namespace: "jelly-form/v1",
        endpoints: [{ methods: ["GET"] }, { methods: ["POST", "GET"] }]
      }
    }
  };
  const routeSchema = {
    namespace: "wp/v2",
    methods: ["GET", "POST"],
    endpoints: [
      {
        methods: ["GET"],
        args: {
          context: { type: "string", enum: ["view", "edit"], default: "view", description: "Long remote description omitted from the compact result." }
        }
      },
      {
        methods: ["POST"],
        args: {
          title: { type: "string", required: true, description: "Long remote description omitted from the compact result." },
          meta: { type: "object", properties: { product_sku: { type: "string" } } }
        }
      }
    ],
    schema: {
      properties: {
        id: { type: "integer", readonly: true, description: "Long remote description omitted from the compact result." },
        title: { type: "string" },
        meta: { type: "object", properties: { product_sku: { type: "string" } } }
      }
    },
    _links: { self: [{ href: "https://example.com/wp-json/wp/v2/product" }] }
  };
  const context = {
    /** 返回固定 REST 元数据并记录工具拼接的公开 HTTPS 请求。 */
    async fetchImpl(url, init) {
      calls.push({ url, method: init.method, authorization: init.headers.Authorization });
      return new Response(JSON.stringify(init.method === "GET" ? rootSchema : routeSchema), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  };

  const index = await executeWpApiTool("wp_rest_api", { domain: "EXAMPLE.com", search: "wp/v2", limit: 1 }, context);
  const fullIndex = await executeWpApiTool("wp_rest_api", { domain: "example.com", apiPath: "wp-json", detail: "full" }, context);
  const route = await executeWpApiTool("wp_rest_api", { domain: "example.com", apiPath: "/wp-json/wp/v2/product/" }, context);
  const fullRoute = await executeWpApiTool("wp_rest_api", { domain: "example.com", apiPath: "wp/v2/product", detail: "full" }, context);

  assert.deepEqual(calls, [
    { url: "https://example.com/wp-json/", method: "GET", authorization: undefined },
    { url: "https://example.com/wp-json/", method: "GET", authorization: undefined },
    { url: "https://example.com/wp-json/wp/v2/product", method: "OPTIONS", authorization: undefined },
    { url: "https://example.com/wp-json/wp/v2/product", method: "OPTIONS", authorization: undefined }
  ]);
  assert.deepEqual(index, {
    domain: "example.com",
    apiPath: "wp-json",
    url: "https://example.com/wp-json/",
    method: "GET",
    detail: "summary",
    schema: {
      namespaces: ["wp/v2", "jelly-form/v1"],
      routes: [{ path: "/wp/v2/pages", namespace: "wp/v2", methods: ["GET"] }],
      total: 2,
      offset: 0,
      limit: 1,
      hasMore: true
    }
  });
  assert.deepEqual(fullIndex, {
    domain: "example.com",
    apiPath: "wp-json",
    url: "https://example.com/wp-json/",
    method: "GET",
    detail: "full",
    schema: rootSchema
  });
  assert.deepEqual(route, {
    domain: "example.com",
    apiPath: "wp-json/wp/v2/product",
    url: "https://example.com/wp-json/wp/v2/product",
    method: "OPTIONS",
    detail: "summary",
    schema: {
      namespace: "wp/v2",
      methods: ["GET", "POST"],
      endpoints: [
        {
          methods: ["GET"],
          arguments: {
            context: { type: "string", enum: ["view", "edit"], default: "view" }
          }
        },
        {
          methods: ["POST"],
          arguments: {
            title: { type: "string", required: true },
            meta: { type: "object", properties: { product_sku: { type: "string" } } }
          }
        }
      ],
      fields: {
        id: { type: "integer", readonly: true },
        title: { type: "string" },
        meta: { type: "object", properties: { product_sku: { type: "string" } } }
      }
    }
  });
  assert.deepEqual(fullRoute.schema, routeSchema);
  assert.equal(fullRoute.detail, "full");
  assert.equal(JSON.stringify(route).length < JSON.stringify(fullRoute).length, true);

  await assert.rejects(
    () => executeWpApiTool("wp_rest_api", { domain: "example.com", apiPath: "wp/v2/../users" }, context),
    /safe unencoded REST path/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_rest_api", { domain: "example.com", apiPath: "%2e%2e/admin" }, context),
    /safe unencoded REST path/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_rest_api", { domain: "example.com", limit: 101 }, context),
    /between 1 and 100/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_rest_api", { domain: "https://example.com" }, context),
    /bare hostname/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_rest_api", { domain: "example.com", client: "prod" }, context),
    /does not accept client or siteUrl/
  );
});

test("wp_rest_api 仅凭 domain 拼接公开 HTTPS REST 请求", async () => {
  const calls = [];
  const context = {
    /** 返回公开 WordPress REST 根索引，并记录请求不读取 client 或携带凭据。 */
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        namespaces: ["wp/v2"],
        routes: {
          "/wp/v2/posts": {
            namespace: "wp/v2",
            endpoints: [{ methods: ["GET"] }]
          }
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  };

  const result = await executeWpApiTool("wp_rest_api", {
    domain: "example.com",
    search: "posts"
  }, context);
  assert.equal(result.schema.routes[0].path, "/wp/v2/posts");
  assert.equal(result.apiPath, "wp-json");
  assert.equal(result.url, "https://example.com/wp-json/");
  assert.equal(calls[0].url, "https://example.com/wp-json/");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  await assert.rejects(
    () => executeWpApiTool("wp_rest_api", {}, context),
    /domain is required/
  );
});

test("本地结构目录按需返回最小片段且无需 WordPress client", async () => {
  let resolverCalls = 0;
  const context = {
    /** 记录本地结构工具不应触发的远程 client 解析。 */
    async resolveClientImpl() {
      resolverCalls += 1;
      return createRemoteClientStub();
    }
  };

  const catalog = await executeWpApiTool("wp_structure_get", {}, context);
  const names = catalog.structures.map((entry) => entry.name);
  assert.equal(names.includes("post"), true);
  assert.equal(names.includes("page"), true);
  assert.equal(names.includes("product-category"), true);
  assert.equal(names.includes("product-tag"), false);
  assert.equal(names.includes("elementor-page"), true);

  const pageOverview = await executeWpApiTool("wp_structure_get", { structure: "page" }, context);
  const pageWrite = await executeWpApiTool("wp_structure_get", { structure: "page", section: "write" }, context);
  const pageFull = await executeWpApiTool("wp_structure_get", { structure: "page", section: "full" }, context);
  assert.equal(pageOverview.remoteSchemaPath, "wp-json/wp/v2/pages");
  assert.equal("writeShape" in pageOverview, false);
  assert.equal(pageWrite.section, "write");
  assert.equal(pageWrite.value.target, "{type:\"post\",resource:\"pages\"}");
  assert.equal(typeof pageWrite.value.data.title, "string");
  assert.equal(JSON.stringify(pageOverview).length < JSON.stringify(pageFull).length, true);

  const elementor = await executeWpApiTool("wp_structure_get", { structure: "elementor-page", section: "write" }, context);
  assert.match(elementor.value.update, /elementId/);
  assert.equal(resolverCalls, 0);

  await assert.rejects(
    () => executeWpApiTool("wp_structure_get", { structure: "unknown" }, context),
    /Unknown structure/
  );
  await assert.rejects(() => executeWpApiTool("wp_structure_get", { section: "write" }, context), /requires a structure/);
  await assert.rejects(() => executeWpApiTool("wp_structure_get", { structure: "page", section: "unknown" }, context), /Unknown structure section/);
});

test("MCP 站点 URL schema 接受无凭据的 HTTP 或 HTTPS 根地址", () => {
  const registrations = collectRegistrations();
  const overrideSiteUrl = registrations.get("wp_resource_list").inputSchema.siteUrl;

  for (const schema of [overrideSiteUrl]) {
    assert.equal(schema.safeParse("https://example.com/wordpress").success, true);
    assert.equal(schema.safeParse("http://localhost:8080").success, true);
    assert.equal(schema.safeParse("http://127.0.0.1:8080").success, true);
    assert.equal(schema.safeParse("http://example.com").success, true);
    assert.equal(schema.safeParse("ftp://example.com").success, false);
    assert.equal(schema.safeParse("https://admin:secret@example.com").success, false);
    assert.equal(schema.safeParse("https://example.com/?target=other").success, false);
    assert.equal(schema.safeParse("https://example.com/#fragment").success, false);
  }
});

test("MCP 资源 schema 校验分页并支持显式清空字段", () => {
  const registrations = collectRegistrations();
  const listSchema = registrations.get("wp_resource_list").inputSchema;
  assert.equal(listSchema.page.safeParse(1).success, true);
  assert.equal(listSchema.page.safeParse(0).success, false);
  assert.equal(listSchema.perPage.safeParse(-1).success, false);
  assert.equal(listSchema.perPage.safeParse(100).success, true);
  assert.equal(listSchema.perPage.safeParse(0).success, false);
  assert.equal(listSchema.perPage.safeParse(101).success, false);
  assert.equal(listSchema.include.safeParse([1, 2]).success, true);
  assert.equal(listSchema.outputFile.safeParse("resources.csv").success, true);

  const countSchema = registrations.get("wp_resource_count").inputSchema;
  assert.equal(countSchema.perPage.safeParse(undefined).success, true);
  assert.equal(countSchema.perPage.safeParse(100).success, true);
  assert.equal(countSchema.perPage.safeParse(-1).success, false);
  assert.equal(countSchema.target.safeParse({ type: "post", resource: "posts" }).success, true);
  assert.equal(countSchema.target.safeParse({ type: "post", resource: "categories" }).success, false);
  assert.equal(countSchema.target.safeParse({ type: "taxonomy", resource: "categories" }).success, true);
  assert.equal(countSchema.target.safeParse({ type: "taxonomy", resource: "product-tags" }).success, false);

  const updateSchema = registrations.get("wp_resource_update").inputSchema;
  assert.equal(updateSchema.data.safeParse({ featuredMedia: 0, categories: [] }).success, true);
  assert.equal(updateSchema.data.safeParse({ categories: [0] }).success, false);
  assert.equal(updateSchema.data.safeParse({ productCategories: [] }).success, false);
  assert.equal(updateSchema.data.safeParse({ productTags: [3, 4] }).success, false);
  assert.equal(updateSchema.data.safeParse({ meta: { _product_sku: "JC-100" }, metaFile: "product-meta.json" }).success, true);
  assert.equal(updateSchema.data.safeParse({ name: "Term", parent: 0 }).success, true);
  const batchCreateSchema = registrations.get("wp_resource_batch_create").inputSchema;
  assert.equal(batchCreateSchema.items.safeParse([{ id: 9, data: { title: "Copy" } }]).success, true);
  assert.equal(batchCreateSchema.items.safeParse([{ data: { title: "Copy", contentFile: "post.html" } }]).success, false);
  assert.equal(batchCreateSchema.csvFile.safeParse("resources.csv").success, true);
  const batchUpdateSchema = registrations.get("wp_resource_batch_update").inputSchema;
  assert.equal(batchUpdateSchema.items.safeParse([{ id: 9, data: { title: "Updated" } }]).success, true);
  assert.equal(batchUpdateSchema.items.safeParse([{ data: { title: "Missing ID" } }]).success, false);
  const elementorUpdateSchema = registrations.get("wp_elementor_update").inputSchema;
  assert.equal(elementorUpdateSchema.changes.safeParse(undefined).success, true);
  assert.equal(elementorUpdateSchema.changesFile.safeParse("changes.json").success, true);

  const seoListSchema = registrations.get("wp_seo_list").inputSchema;
  assert.equal(seoListSchema.perPage.safeParse(100).success, true);
  assert.equal(seoListSchema.perPage.safeParse(-1).success, false);
  assert.equal(seoListSchema.include.safeParse([1, 2]).success, true);
  assert.equal(seoListSchema.outputFile.safeParse("seo.csv").success, true);
  const seoBatchSchema = registrations.get("wp_seo_batch_update").inputSchema;
  assert.equal(seoBatchSchema.items.safeParse([{ id: 1, title: "SEO" }]).success, true);
  assert.equal(seoBatchSchema.csvFile.safeParse("seo.csv").success, true);
});

test("MCP package schema 要求统一软件包类型并禁止停用主题", () => {
  const registrations = collectRegistrations();
  assert.equal(registrations.get("wp_package_list").inputSchema.packageType.safeParse(undefined).success, false);
  assert.equal(registrations.get("wp_package_list").inputSchema.packageType.safeParse("plugin").success, true);
  assert.equal(registrations.get("wp_package_list").inputSchema.packageType.safeParse("theme").success, true);
  assert.equal(registrations.get("wp_package_install").inputSchema.file.safeParse(undefined).success, false);
  assert.equal(registrations.get("wp_package_deactivate").inputSchema.packageType.safeParse("theme").success, false);
});

test("executeWpApiTool 直接调用领域 handler 而不构造 CLI 参数", async () => {
  const calls = [];
  const client = createRemoteClientStub({
    /** 记录资源列表路由和查询对象。 */
    async list(route, query) {
      calls.push({ route, query });
      return { items: [{ id: 7 }], pagination: { total: 1, totalPages: 1 } };
    }
  });
  let selectedConnection;

  const result = await executeWpApiTool("wp_resource_list", {
    client: "prod",
    siteUrl: "https://example.com/staging",
    target: { type: "post", resource: "posts" },
    search: "hello",
    page: 2,
    perPage: 10,
    status: "publish"
  }, {
    /** 返回测试 client，并记录中央执行器解析出的连接字段。 */
    async resolveClientImpl(connection) {
      selectedConnection = connection;
      return client;
    }
  });

  assert.deepEqual(selectedConnection, {
    client: "prod",
    siteUrl: "https://example.com/staging"
  });
  assert.deepEqual(calls, [{
    route: "posts",
    query: { search: "hello", page: 2, per_page: 10, status: "publish" }
  }]);
  assert.equal(result.items[0].id, 7);
});

test("executeWpApiTool 分发资源计数和 batch 创建更新", async () => {
  const calls = [];
  const client = createRemoteClientStub({
    /** 返回计数分页头并记录最小列表查询。 */
    async list(route, query) {
      calls.push({ kind: "list", route, query });
      return { items: [{ id: 1 }], pagination: { total: 12, totalPages: 1 } };
    },
    /** 按子请求路径生成资源 batch 响应。 */
    async requestApiPath(route, options) {
      calls.push({ kind: "batch", route, options });
      return {
        data: { responses: options.body.requests.map((request, index) => ({
          status: 200,
          body: { id: request.path.endsWith("/4") ? 4 : 100 + index }
        })) },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  });
  const context = {
    /** 返回资源工具使用的远端 client 替身。 */
    async resolveClientImpl() {
      return client;
    }
  };

  const counted = await executeWpApiTool("wp_resource_count", { target: { type: "post", resource: "posts" } }, context);
  const created = await executeWpApiTool("wp_resource_batch_create", {
    target: { type: "post", resource: "posts" },
    items: [{ id: 9, data: { title: "Copy" } }]
  }, context);
  const updated = await executeWpApiTool("wp_resource_batch_update", {
    target: { type: "post", resource: "posts" },
    items: [{ id: 4, data: { title: "Updated" } }]
  }, context);

  assert.deepEqual(counted, { target: { type: "post", resource: "posts" }, total: 12, totalPages: 1, perPage: 100 });
  assert.equal(created.items[0].sourceId, 9);
  assert.equal(updated.items[0].id, 4);
  assert.deepEqual(calls[0], {
    kind: "list",
    route: "posts",
    query: { page: 1, per_page: 100, _fields: "id" }
  });
  assert.equal(calls[1].options.body.requests[0].path, "/wp/v2/posts");
  assert.equal(calls[2].options.body.requests[0].path, "/wp/v2/posts/4");
});

test("executeWpApiTool 分发 SEO 列表与 batch 更新", async () => {
  const calls = [];
  const client = createRemoteClientStub({
    /** 返回 SEO 列表并记录集合查询。 */
    async list(route, query) {
      calls.push({ kind: "list", route, query });
      return { items: [{ id: 4, meta: { rank_math_title: "SEO" } }], pagination: { total: 1, totalPages: 1 } };
    },
    /** 返回 SEO batch 子响应并记录批量请求。 */
    async requestApiPath(route, options) {
      calls.push({ kind: "batch", route, options });
      return {
        data: { responses: [{ status: 200, body: { id: 4, meta: options.body.requests[0].body.meta } }] },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  });
  const context = {
    /** 返回 SEO 工具使用的远端 client 替身。 */
    async resolveClientImpl() {
      return client;
    }
  };

  const listed = await executeWpApiTool("wp_seo_list", { resource: "posts", page: 1, perPage: 10 }, context);
  const updated = await executeWpApiTool("wp_seo_batch_update", {
    resource: "posts",
    items: [{ id: 4, description: "Description" }]
  }, context);

  assert.equal(listed.items[0].rank_math_title, "SEO");
  assert.equal(updated.succeeded, 1);
  assert.equal(calls[0].route, "posts");
  assert.equal(calls[1].route, "batch/v1");
});

test("Jelly Form MCP 工具映射设置与只读询价 REST 请求", async () => {
  const calls = [];
  const client = createRemoteClientStub({
    /** 记录 Jelly Form 自定义 REST 路由、方法、查询及请求体。 */
    async requestApiPath(route, options = {}) {
      calls.push({ route, options });
      return { data: { ok: true }, pagination: { total: 0, totalPages: 0 } };
    }
  });
  const context = {
    /** 返回不会发出真实网络请求的 Jelly Form client 替身。 */
    async resolveClientImpl() {
      return client;
    }
  };

  await executeWpApiTool("wp_jelly_form_settings_get", {}, context);
  await executeWpApiTool("wp_jelly_form_settings_update", {
    recipientEmail: "sales@example.com",
    smtpEnabled: true,
    smtp: { host: "smtp.example.com", password: "secret", clearPassword: false }
  }, context);
  await executeWpApiTool("wp_jelly_form_inquiry_list", {
    page: 2,
    perPage: 25,
    startDate: "2026-08-01",
    orderBy: "created_at",
    order: "DESC"
  }, context);
  await executeWpApiTool("wp_jelly_form_inquiry_get", { id: 9 }, context);

  assert.deepEqual(calls, [
    { route: "jelly-form/v1/settings", options: {} },
    {
      route: "jelly-form/v1/settings",
      options: {
        method: "POST",
        body: {
          recipient_email: "sales@example.com",
          smtp_enabled: true,
          smtp: { host: "smtp.example.com", password: "secret", clear_password: false }
        }
      }
    },
    {
      route: "jelly-form/v1/inquiries",
      options: {
        query: {
          search: undefined,
          page: 2,
          per_page: 25,
          start_date: "2026-08-01",
          end_date: undefined,
          orderby: "created_at",
          order: "DESC"
        }
      }
    },
    { route: "jelly-form/v1/inquiries/9", options: {} }
  ]);
});

test("executeWpApiTool 仅执行 client 查找和脱敏列表", async (t) => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-dispatch-client-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));

  const store = new ConfigStore({ configDir });
  const added = await store.saveClient({
    name: "local",
    siteUrl: "http://localhost:8080/wordpress",
    username: "editor",
    appPassword: "secret"
  });
  assert.deepEqual(added, {
    name: "local",
    siteUrl: "http://localhost:8080/wordpress"
  });

  assert.deepEqual(await executeWpApiTool("wp_client_get", { name: "local" }, { configDir }), added);
  assert.deepEqual(await executeWpApiTool("wp_client_list", {}, { configDir }), [added]);
  await assert.rejects(
    () => executeWpApiTool("wp_client_get", { name: "missing" }, { configDir }),
    /Client "missing" not found/
  );
});

test("executeWpApiTool 对未知名称立即返回 MCP 工具错误", async () => {
  await assert.rejects(
    () => executeWpApiTool("wp_plugin_list", {}),
    /Unknown MCP tool/
  );
});

test("MCP 本地路径边界允许工作区内的正文文件并传递真实路径", async (t) => {
  const workspaceDirectory = await mkdtemp(path.join(process.cwd(), ".wp-api-mcp-local-"));
  t.after(() => rm(workspaceDirectory, { recursive: true, force: true }));
  const contentFile = path.join(workspaceDirectory, "article.html");
  const metaFile = path.join(workspaceDirectory, "meta.json");
  await writeFile(contentFile, "<p>Workspace content</p>");
  await writeFile(metaFile, JSON.stringify({ source: "local" }));
  const calls = [];
  const client = createRemoteClientStub({
    /** 记录使用安全文件内容创建资源的调用。 */
    async create(route, body) {
      calls.push({ route, body });
      return { id: 1 };
    }
  });

  await executeWpApiTool("wp_resource_create", {
    target: { type: "post", resource: "posts" },
    data: { contentFile, metaFile }
  }, {
    /** 返回不会发出网络请求的资源 client 替身。 */
    async resolveClientImpl() {
      return client;
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "posts");
  assert.equal(calls[0].body.content, "<p>Workspace content</p>");
  assert.deepEqual(calls[0].body.meta, { source: "local" });
});

test("MCP 本地路径边界在解析 client 前拒绝工作区外输入", async (t) => {
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-outside-"));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const mediaFile = path.join(outsideDirectory, "hero.png");
  const packageFile = path.join(outsideDirectory, "plugin.zip");
  const metaFile = path.join(outsideDirectory, "meta.json");
  const changesFile = path.join(outsideDirectory, "changes.json");
  const csvFile = path.join(outsideDirectory, "seo.csv");
  await writeFile(mediaFile, "image fixture");
  await writeFile(packageFile, "zip fixture");
  await writeFile(metaFile, "{}");
  await writeFile(changesFile, "[]");
  await writeFile(csvFile, "id,rank_math_title,rank_math_description,rank_math_focus_keyword\n1,a,b,c\n");
  let resolveCalls = 0;
  const context = {
    /** 记录任何意外发生的 client 解析。 */
    async resolveClientImpl() {
      resolveCalls += 1;
      return createRemoteClientStub();
    }
  };

  await assert.rejects(
    () => executeWpApiTool("wp_media_upload", { filePath: mediaFile }, context),
    /filePath.*outside the allowed local roots/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_package_update", { packageType: "plugin", file: packageFile }, context),
    /file.*outside the allowed local roots/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_resource_update", {
      target: { type: "post", resource: "posts" },
      id: 1,
      data: { metaFile }
    }, context),
    /metaFile.*outside the allowed local roots/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_elementor_update", {
      postId: 1,
      expectedRevision: "revision",
      changesFile
    }, context),
    /changesFile.*outside the allowed local roots/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_seo_batch_update", { resource: "posts", csvFile }, context),
    /csvFile.*outside the allowed local roots/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_resource_batch_update", {
      target: { type: "post", resource: "posts" },
      csvFile
    }, context),
    /csvFile.*outside the allowed local roots/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_resource_list", {
      target: { type: "post", resource: "posts" },
      outputFile: path.join(outsideDirectory, "resources.csv")
    }, context),
    /outputFile.*outside the allowed local roots/
  );
  await assert.rejects(
    () => executeWpApiTool("wp_seo_list", {
      resource: "posts",
      outputFile: path.join(outsideDirectory, "export.csv")
    }, context),
    /outputFile.*outside the allowed local roots/
  );
  assert.equal(resolveCalls, 0);
});

test("MCP allowedLocalRoots 显式允许工作区外媒体文件", async (t) => {
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-allowed-"));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const mediaFile = path.join(outsideDirectory, "hero.png");
  await writeFile(mediaFile, "image fixture");
  const calls = [];
  const client = createRemoteClientStub({
    /** 记录媒体上传的安全真实路径。 */
    async uploadMediaFromFile(filePath, options) {
      calls.push({ filePath, options });
      return { id: 2 };
    }
  });

  await executeWpApiTool("wp_media_upload", { filePath: mediaFile }, {
    allowedLocalRoots: [outsideDirectory],
    /** 返回媒体上传 client 替身。 */
    async resolveClientImpl() {
      return client;
    }
  });

  assert.deepEqual(calls, [{ filePath: await realpath(mediaFile), options: {} }]);
});

test("MCP 本地路径边界拒绝逃逸工作区的输入符号链接", async (t) => {
  const workspaceDirectory = await mkdtemp(path.join(process.cwd(), ".wp-api-mcp-link-"));
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-link-target-"));
  t.after(() => rm(workspaceDirectory, { recursive: true, force: true }));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const outsideFile = path.join(outsideDirectory, "secret.txt");
  const linkFile = path.join(workspaceDirectory, "content.html");
  await writeFile(outsideFile, "outside content");
  try {
    await symlink(outsideFile, linkFile, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip(`当前平台不能创建测试符号链接：${error.code}`);
      return;
    }
    throw error;
  }

  let resolverCalled = false;
  await assert.rejects(
    () => executeWpApiTool("wp_resource_update", {
      target: { type: "post", resource: "posts" },
      id: 1,
      data: { contentFile: linkFile }
    }, {
      /** 记录边界拒绝前不应发生的 client 解析。 */
      async resolveClientImpl() {
        resolverCalled = true;
        return createRemoteClientStub();
      }
    }),
    /contentFile.*outside the allowed local roots/
  );
  assert.equal(resolverCalled, false);
});

test("MCP 软件包输出校验拒绝通过父目录符号链接逃逸", async (t) => {
  const workspaceDirectory = await mkdtemp(path.join(process.cwd(), ".wp-api-mcp-output-link-"));
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-output-target-"));
  t.after(() => rm(workspaceDirectory, { recursive: true, force: true }));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const packageDirectory = path.join(workspaceDirectory, "sample-plugin");
  const linkedOutputDirectory = path.join(workspaceDirectory, "dist-link");
  await mkdir(packageDirectory);
  await writeFile(path.join(packageDirectory, "plugin.php"), "<?php // Plugin Name: Sample");
  try {
    await symlink(outsideDirectory, linkedOutputDirectory, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip(`当前平台不能创建测试符号链接：${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => executeWpApiTool("wp_package_pack_plugin", {
      folderPath: packageDirectory,
      outputPath: path.join(linkedOutputDirectory, "sample-plugin.zip")
    }),
    /outputPath.*outside the allowed local roots/
  );
});

test("MCP 软件包工具在工作区内创建默认 ZIP 输出", async (t) => {
  const workspaceDirectory = await mkdtemp(path.join(process.cwd(), ".wp-api-mcp-default-output-"));
  t.after(() => rm(workspaceDirectory, { recursive: true, force: true }));
  const packageDirectory = path.join(workspaceDirectory, "sample-plugin");
  await mkdir(packageDirectory);
  await writeFile(path.join(packageDirectory, "plugin.php"), "<?php // Plugin Name: Sample");

  const result = await executeWpApiTool("wp_package_pack_plugin", {
    folderPath: packageDirectory
  });
  const archive = await readFile(result.outputFile);

  assert.equal(result.outputFile, path.join(workspaceDirectory, "sample-plugin.zip"));
  assert.ok(result.size > 0);
  assert.equal(archive.subarray(0, 4).toString("hex"), "504b0304");
});
