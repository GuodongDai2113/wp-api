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

  for (const removedName of [
    "wp_client_add",
    "wp_plugin_list",
    "wp_theme_push",
    "wp_elementor_get_tokens",
    "wp_elementor_add_widget"
  ]) {
    assert.equal(registrations.has(removedName), false);
  }
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
  assert.equal(listSchema.perPage.safeParse(-1).success, true);
  assert.equal(listSchema.perPage.safeParse(100).success, true);
  assert.equal(listSchema.perPage.safeParse(0).success, false);
  assert.equal(listSchema.perPage.safeParse(101).success, false);

  const updateSchema = registrations.get("wp_resource_update").inputSchema;
  assert.equal(updateSchema.featuredMedia.safeParse(0).success, true);
  assert.equal(updateSchema.categories.safeParse([]).success, true);
  assert.equal(updateSchema.categories.safeParse([1, 2]).success, true);
  assert.equal(updateSchema.categories.safeParse([0]).success, false);
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
    resource: "posts",
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

test("executeWpApiTool 仅执行 client 选择和脱敏列表", async (t) => {
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

  await executeWpApiTool("wp_client_use", { name: "local" }, { configDir });
  assert.deepEqual(await executeWpApiTool("wp_client_list", {}, { configDir }), {
    activeClient: "local",
    clients: [added]
  });
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
  await writeFile(contentFile, "<p>Workspace content</p>");
  const calls = [];
  const client = createRemoteClientStub({
    /** 记录使用安全文件内容创建资源的调用。 */
    async create(route, body) {
      calls.push({ route, body });
      return { id: 1 };
    }
  });

  await executeWpApiTool("wp_resource_create", {
    resource: "posts",
    contentFile
  }, {
    /** 返回不会发出网络请求的资源 client 替身。 */
    async resolveClientImpl() {
      return client;
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "posts");
  assert.equal(calls[0].body.content, "<p>Workspace content</p>");
});

test("MCP 本地路径边界在解析 client 前拒绝工作区外输入", async (t) => {
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-outside-"));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const mediaFile = path.join(outsideDirectory, "hero.png");
  const packageFile = path.join(outsideDirectory, "plugin.zip");
  await writeFile(mediaFile, "image fixture");
  await writeFile(packageFile, "zip fixture");
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
      resource: "posts",
      id: 1,
      contentFile: linkFile
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
