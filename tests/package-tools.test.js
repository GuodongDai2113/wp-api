import assert from "node:assert/strict";
import test from "node:test";

import {
  activatePackage,
  deactivatePackage,
  getPackage,
  hasActiveJellyCore,
  installPackage,
  listPackages,
  updatePackage
} from "../build/mcp/handlers/package-tools.js";

/** 创建只实现当前测试所需方法的 WordPressClient 替身。 */
function createClientStub(overrides = {}) {
  return {
    async list() {
      throw new Error("Unexpected list call.");
    },
    async request() {
      throw new Error("Unexpected request call.");
    },
    async uploadPluginFromFile() {
      throw new Error("Unexpected uploadPluginFromFile call.");
    },
    async uploadThemeFromFile() {
      throw new Error("Unexpected uploadThemeFromFile call.");
    },
    async updateThemeStatus() {
      throw new Error("Unexpected updateThemeStatus call.");
    },
    ...overrides
  };
}

/** 插件和主题列表应选择各自路由，且主题查询不应发送插件搜索字段。 */
test("package handlers list plugins and themes through native routes", async () => {
  const calls = [];
  const client = createClientStub({
    async list(route, query) {
      calls.push({ route, query });
      return { items: [{ route }], pagination: { total: 1, totalPages: 1 } };
    }
  });

  const plugins = await listPackages(client, {
    packageType: "plugin",
    status: "active",
    search: "cache"
  });
  const themes = await listPackages(client, {
    packageType: "theme",
    status: "inactive",
    search: "ignored"
  });

  assert.equal(plugins.pagination.total, 1);
  assert.equal(themes.pagination.total, 1);
  assert.deepEqual(calls, [
    { route: "plugins", query: { status: "active", search: "cache" } },
    { route: "themes", query: { status: "inactive" } }
  ]);
});

/** 单个软件包读取应保留插件文件标识中的斜杠，并为主题使用 themes 路由。 */
test("package handlers get plugins and themes through native routes", async () => {
  const calls = [];
  const client = createClientStub({
    async request(route) {
      calls.push(route);
      return { data: { route }, pagination: { total: 0, totalPages: 0 } };
    }
  });

  const plugin = await getPackage(client, { packageType: "plugin", package: "akismet/akismet" });
  const theme = await getPackage(client, { packageType: "theme", package: "twentytwentyfive" });

  assert.equal(plugin.route, "plugins/akismet/akismet");
  assert.equal(theme.route, "themes/twentytwentyfive");
  assert.deepEqual(calls, ["plugins/akismet/akismet", "themes/twentytwentyfive"]);
});

/** Jelly Core 识别应兼容当前使用的三个插件标识，并拒绝非激活实体。 */
test("hasActiveJellyCore recognizes supported active identifiers", () => {
  assert.equal(hasActiveJellyCore([{ plugin: "jelly-core", status: "active" }]), true);
  assert.equal(hasActiveJellyCore([{ plugin: "jelly-core/jelly-core", status: "active" }]), true);
  assert.equal(hasActiveJellyCore([{ slug: "jelly-core/jelly-core.php", status: "active" }]), true);
  assert.equal(hasActiveJellyCore([{ plugin: "jelly-core/jelly-core.php", status: "inactive" }]), false);
  assert.equal(hasActiveJellyCore([null, "jelly-core"]), false);
});

/** 插件安装应先检查所有激活插件，然后把本地 ZIP 交给插件上传方法。 */
test("installPackage checks Jelly Core before installing a plugin", async () => {
  const calls = [];
  const expected = { success: true, action: "installed", plugin_name: "Example" };
  const client = createClientStub({
    async list(route, query) {
      calls.push(["list", route, query]);
      return {
        items: [{ plugin: "jelly-core/jelly-core.php", status: "active" }],
        pagination: { total: 1, totalPages: 1 }
      };
    },
    async uploadPluginFromFile(file) {
      calls.push(["plugin", file]);
      return expected;
    }
  });

  const result = await installPackage(client, { packageType: "plugin", file: "C:/packages/example.zip" });

  assert.equal(result, expected);
  assert.deepEqual(calls, [
    ["list", "plugins", { status: "active", per_page: -1 }],
    ["plugin", "C:/packages/example.zip"]
  ]);
});

/** 主题更新应复用 Jelly Core 前置检查，并调用主题二进制上传方法。 */
test("updatePackage checks Jelly Core before updating a theme", async () => {
  const calls = [];
  const expected = { success: true, action: "updated", theme_slug: "example-theme" };
  const client = createClientStub({
    async list(route, query) {
      calls.push(["list", route, query]);
      return {
        items: [{ slug: "jelly-core", status: "active" }],
        pagination: { total: 1, totalPages: 1 }
      };
    },
    async uploadThemeFromFile(file) {
      calls.push(["theme", file]);
      return expected;
    }
  });

  const result = await updatePackage(client, { packageType: "theme", file: "C:/packages/example-theme.zip" });

  assert.equal(result, expected);
  assert.deepEqual(calls, [
    ["list", "plugins", { status: "active", per_page: -1 }],
    ["theme", "C:/packages/example-theme.zip"]
  ]);
});

/** Jelly Core 缺失或未激活时，安装流程必须在任何上传动作之前停止。 */
test("package mutation stops when Jelly Core is missing", async () => {
  let uploaded = false;
  const client = createClientStub({
    async list() {
      return {
        items: [{ plugin: "jelly-core/jelly-core.php", status: "inactive" }],
        pagination: { total: 1, totalPages: 1 }
      };
    },
    async uploadPluginFromFile() {
      uploaded = true;
      return {};
    }
  });

  await assert.rejects(
    () => installPackage(client, { packageType: "plugin", file: "C:/packages/example.zip" }),
    /Jelly Core is not installed and active/
  );
  assert.equal(uploaded, false);
});

/** 插件激活和停用应直接使用 WordPress 原生 plugins 状态接口，无需 Jelly Core。 */
test("plugin activation and deactivation use native WordPress routes", async () => {
  const calls = [];
  const client = createClientStub({
    async request(route, options) {
      calls.push({ route, options });
      return {
        data: { plugin: route.slice("plugins/".length), status: options.body.status },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  });

  const activated = await activatePackage(client, {
    packageType: "plugin",
    package: "akismet/akismet"
  });
  const deactivated = await deactivatePackage(client, {
    packageType: "plugin",
    package: "akismet/akismet"
  });

  assert.equal(activated.status, "active");
  assert.equal(deactivated.status, "inactive");
  assert.deepEqual(calls, [
    {
      route: "plugins/akismet/akismet",
      options: { method: "PUT", body: { status: "active" } }
    },
    {
      route: "plugins/akismet/akismet",
      options: { method: "PUT", body: { status: "inactive" } }
    }
  ]);
});

/** 主题激活应先检查 Jelly Core，再调用自定义主题状态接口。 */
test("theme activation checks Jelly Core before switching themes", async () => {
  const calls = [];
  const expected = { success: true, theme_slug: "example-theme", status: "active" };
  const client = createClientStub({
    async list(route, query) {
      calls.push(["list", route, query]);
      return {
        items: [{ plugin: "jelly-core/jelly-core.php", status: "active" }],
        pagination: { total: 1, totalPages: 1 }
      };
    },
    async updateThemeStatus(theme, status) {
      calls.push(["theme-status", theme, status]);
      return expected;
    }
  });

  const result = await activatePackage(client, {
    packageType: "theme",
    package: "example-theme"
  });

  assert.equal(result, expected);
  assert.deepEqual(calls, [
    ["list", "plugins", { status: "active", per_page: -1 }],
    ["theme-status", "example-theme", "active"]
  ]);
});

/** 软件包停用工具应明确拒绝主题，且不能发出任何网络请求。 */
test("deactivatePackage rejects themes", async () => {
  const client = createClientStub();
  await assert.rejects(
    () => deactivatePackage(client, { packageType: "theme", package: "example-theme" }),
    /Themes cannot be deactivated/
  );
});

/** 软件包标识不能使用点段或额外斜杠改变 WordPress REST 路由。 */
test("package handlers reject route-changing package identifiers", async () => {
  const client = createClientStub();
  await assert.rejects(
    () => getPackage(client, { packageType: "plugin", package: "../../users" }),
    /safe plugin slug/
  );
  await assert.rejects(
    () => activatePackage(client, { packageType: "theme", package: "theme/child" }),
    /safe stylesheet slug/
  );
  await assert.rejects(
    () => deactivatePackage(client, { packageType: "plugin", package: "plugin/%2e%2e" }),
    /safe plugin slug/
  );
});
