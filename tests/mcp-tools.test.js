import test from "node:test";
import assert from "node:assert/strict";

import { buildCliArgsForTool, executeWpApiTool } from "../build/mcp/wp-api-tools.js";
import { registerWpApiTools } from "../build/mcp/server.js";

test("wp_resource_list maps MCP input to JSON CLI arguments", async () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_resource_list", {
      client: "prod",
      resource: "posts",
      search: "hello",
      page: 2,
      perPage: 10,
      status: "publish"
    }),
    [
      "--client",
      "prod",
      "posts",
      "list",
      "--json",
      "--search",
      "hello",
      "--page",
      "2",
      "--per-page",
      "10",
      "--status",
      "publish"
    ]
  );
});

test("wp_resource_create maps content fields to existing CLI shape", async () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_resource_create", {
      resource: "posts",
      title: "Hello",
      status: "draft",
      content: "Body",
      categories: [1, 2]
    }),
    [
      "posts",
      "create",
      "--json",
      "--title",
      "Hello",
      "--status",
      "draft",
      "--content",
      "Body",
      "--categories",
      "1,2"
    ]
  );
});

test("wp_resource_create maps gutenberg flag to CLI option", async () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_resource_create", {
      resource: "posts",
      title: "Hello",
      contentFile: "./article.html",
      gutenberg: true
    }),
    [
      "posts",
      "create",
      "--json",
      "--title",
      "Hello",
      "--content-file",
      "./article.html",
      "--gutenberg"
    ]
  );
});

test("wp_media_upload maps MCP input to JSON CLI arguments", async () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_media_upload", {
      client: "prod",
      filePath: "./hero.png",
      title: "Hero",
      altText: "Hero alt",
      caption: "Hero caption",
      description: "Hero description"
    }),
    [
      "--client",
      "prod",
      "media",
      "upload",
      "--json",
      "--file",
      "./hero.png",
      "--title",
      "Hero",
      "--alt",
      "Hero alt",
      "--caption",
      "Hero caption",
      "--description",
      "Hero description"
    ]
  );
});

test("wp_elementor_export maps MCP input to Elementor CLI arguments", async () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_elementor_export", {
      client: "prod",
      postId: 12
    }),
    [
      "--client",
      "prod",
      "elementor",
      "export",
      "12",
      "--json"
    ]
  );
});

test("wp_elementor_import maps raw tree data to Elementor CLI arguments", async () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_elementor_import", {
      postId: 12,
      data: [{ id: "aaaaaaa", elType: "widget", settings: {}, elements: [] }]
    }),
    [
      "elementor",
      "import",
      "12",
      "--json",
      "--data-json",
      "[{\"id\":\"aaaaaaa\",\"elType\":\"widget\",\"settings\":{},\"elements\":[]}]"
    ]
  );
});

test("wp_elementor_get_element maps element lookup to Elementor CLI arguments", async () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_elementor_get_element", {
      postId: 42,
      elementId: "aaaaaaa"
    }),
    [
      "elementor",
      "get-element",
      "42",
      "--json",
      "--element-id",
      "aaaaaaa"
    ]
  );
});

test("Elementor token MCP tools are removed while other Elementor tools remain", () => {
  const registrations = new Map();
  const server = {
    registerTool(name, definition) {
      registrations.set(name, definition);
    }
  };

  registerWpApiTools(server);

  assert.equal(registrations.has("wp_elementor_get_tokens"), false);
  assert.equal(registrations.has("wp_elementor_set_tokens"), false);
  assert.throws(() => buildCliArgsForTool("wp_elementor_get_tokens", {}), /Unknown MCP tool/);
  assert.throws(() => buildCliArgsForTool("wp_elementor_set_tokens", {}), /Unknown MCP tool/);

  for (const toolName of [
    "wp_elementor_init",
    "wp_elementor_export",
    "wp_elementor_import",
    "wp_elementor_structure",
    "wp_elementor_get_element",
    "wp_elementor_find"
  ]) {
    assert.ok(registrations.has(toolName), `${toolName} should remain registered`);
  }
});

test("wp_elementor construction tools are not exposed by wp-api MCP", async () => {
  for (const toolName of [
    "wp_elementor_add_container",
    "wp_elementor_add_widget",
    "wp_elementor_update_element",
    "wp_elementor_batch_update",
    "wp_elementor_reorder",
    "wp_elementor_move",
    "wp_elementor_remove",
    "wp_elementor_duplicate"
  ]) {
    assert.throws(
      () => buildCliArgsForTool(toolName, { postId: 42 }),
      /Unknown MCP tool/
    );
  }
});

test("wp_elementor tools reject resource input", async () => {
  assert.throws(
    () => buildCliArgsForTool("wp_elementor_export", {
      resource: "pages",
      postId: 42
    }),
    /Elementor MCP tools do not accept resource/
  );
});

test("wp_resource_update maps featuredMedia to featured media CLI option", async () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_resource_update", {
      resource: "posts",
      id: 42,
      featuredMedia: 55
    }),
    [
      "posts",
      "update",
      "42",
      "--json",
      "--featured-media",
      "55"
    ]
  );
});

test("executeWpApiTool returns structured data from runCli", async () => {
  const result = await executeWpApiTool("wp_client_list", {}, {
    runCliImpl: async () => ({
      exitCode: 0,
      stdout: "{}\n",
      stderr: "",
      data: { activeClient: null, clients: [] }
    })
  });

  assert.deepEqual(result, { activeClient: null, clients: [] });
});

test("wp_package tools map plugin and theme operations to existing CLI commands", () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_package_list", {
      client: "prod",
      packageType: "theme",
      status: "inactive"
    }),
    ["--client", "prod", "themes", "list", "--json", "--status", "inactive"]
  );
  assert.deepEqual(
    buildCliArgsForTool("wp_package_get", {
      packageType: "theme",
      package: "twentytwentyfive"
    }),
    ["themes", "get", "twentytwentyfive", "--json"]
  );
  assert.deepEqual(
    buildCliArgsForTool("wp_package_install", {
      packageType: "theme",
      file: "theme.zip"
    }),
    ["themes", "install", "--json", "--file", "theme.zip"]
  );
  assert.deepEqual(
    buildCliArgsForTool("wp_package_update", {
      packageType: "plugin",
      file: "plugin.zip"
    }),
    ["plugins", "install", "--json", "--file", "plugin.zip"]
  );
  assert.deepEqual(
    buildCliArgsForTool("wp_package_activate", {
      packageType: "theme",
      package: "theme"
    }),
    ["themes", "activate", "theme", "--json"]
  );
  assert.deepEqual(
    buildCliArgsForTool("wp_package_activate", {
      packageType: "plugin",
      package: "akismet/akismet"
    }),
    ["plugins", "update", "akismet/akismet", "--json", "--status", "active"]
  );
  assert.deepEqual(
    buildCliArgsForTool("wp_package_deactivate", {
      packageType: "plugin",
      package: "akismet/akismet"
    }),
    ["plugins", "update", "akismet/akismet", "--json", "--status", "inactive"]
  );
});

test("wp_package tools are registered and package type is required", () => {
  const registrations = new Map();
  const server = {
    registerTool(name, definition) {
      registrations.set(name, definition);
    }
  };

  registerWpApiTools(server);

  for (const toolName of [
    "wp_package_list",
    "wp_package_get",
    "wp_package_install",
    "wp_package_update",
    "wp_package_activate",
    "wp_package_deactivate"
  ]) {
    assert.ok(registrations.has(toolName), `${toolName} should be registered`);
  }

  assert.equal(registrations.get("wp_package_list").inputSchema.packageType.safeParse(undefined).success, false);
  assert.equal(registrations.get("wp_package_list").inputSchema.packageType.safeParse("plugin").success, true);
  assert.equal(registrations.get("wp_package_list").inputSchema.packageType.safeParse("theme").success, true);
  assert.equal(registrations.get("wp_package_install").inputSchema.file.safeParse(undefined).success, false);
  assert.equal(registrations.get("wp_package_deactivate").inputSchema.packageType.safeParse("theme").success, false);
});

test("legacy plugin and theme MCP tools are removed", () => {
  const registrations = new Map();
  const server = {
    registerTool(name, definition) {
      registrations.set(name, definition);
    }
  };

  registerWpApiTools(server);

  for (const toolName of [
    "wp_theme_push",
    "wp_theme_list",
    "wp_theme_get",
    "wp_theme_install",
    "wp_theme_update",
    "wp_theme_activate",
    "wp_theme_deactivate",
    "wp_plugin_list",
    "wp_plugin_get",
    "wp_plugin_update",
    "wp_plugin_install"
  ]) {
    assert.equal(registrations.has(toolName), false, `${toolName} should be removed`);
    assert.throws(() => buildCliArgsForTool(toolName, {}), /Unknown MCP tool/);
  }
});

test("wp_package_deactivate rejects themes", () => {
  assert.throws(
    () => buildCliArgsForTool("wp_package_deactivate", {
      packageType: "theme",
      package: "theme"
    }),
    /Themes cannot be deactivated/
  );
});

test("package install checks active Jelly Core before executing the mutation", async () => {
  const calls = [];
  const result = await executeWpApiTool("wp_package_install", {
    client: "prod",
    packageType: "theme",
    file: "theme.zip"
  }, {
    runCliImpl: async (args) => {
      calls.push(args);
      if (calls.length === 1) {
        return {
          exitCode: 0,
          stdout: "{}\n",
          stderr: "",
          data: {
            items: [
              {
                plugin: "jelly-core/jelly-core",
                status: "active"
              }
            ],
            pagination: { total: 1, totalPages: 1 }
          }
        };
      }

      return {
        exitCode: 0,
        stdout: "{}\n",
        stderr: "",
        data: { success: true }
      };
    }
  });

  assert.deepEqual(calls, [
    ["--client", "prod", "plugins", "list", "--json", "--status", "active"],
    ["--client", "prod", "themes", "install", "--json", "--file", "theme.zip"]
  ]);
  assert.deepEqual(result, { success: true });
});

test("package mutation stops before work when Jelly Core is missing or inactive", async () => {
  const calls = [];

  await assert.rejects(
    () => executeWpApiTool("wp_package_update", {
      packageType: "plugin",
      file: "plugin.zip"
    }, {
      runCliImpl: async (args) => {
        calls.push(args);
        return {
          exitCode: 0,
          stdout: "{}\n",
          stderr: "",
          data: {
            items: [
              {
                plugin: "jelly-core/jelly-core.php",
                status: "inactive"
              }
            ],
            pagination: { total: 1, totalPages: 1 }
          }
        };
      }
    }),
    /Jelly Core is not installed and active/
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["plugins", "list", "--json", "--status", "active"]);
});

test("theme activation requires Jelly Core but plugin activation uses native WordPress directly", async () => {
  const themeCalls = [];
  await assert.rejects(
    () => executeWpApiTool("wp_package_activate", {
      packageType: "theme",
      package: "theme"
    }, {
      runCliImpl: async (args) => {
        themeCalls.push(args);
        return {
          exitCode: 0,
          stdout: "{}\n",
          stderr: "",
          data: { items: [], pagination: { total: 0, totalPages: 0 } }
        };
      }
    }),
    /Jelly Core is not installed and active/
  );
  assert.equal(themeCalls.length, 1);

  const pluginCalls = [];
  const pluginResult = await executeWpApiTool("wp_package_activate", {
    packageType: "plugin",
    package: "akismet/akismet"
  }, {
    runCliImpl: async (args) => {
      pluginCalls.push(args);
      return {
        exitCode: 0,
        stdout: "{}\n",
        stderr: "",
        data: { plugin: "akismet/akismet", status: "active" }
      };
    }
  });

  assert.equal(pluginCalls.length, 1);
  assert.deepEqual(pluginCalls[0], [
    "plugins",
    "update",
    "akismet/akismet",
    "--json",
    "--status",
    "active"
  ]);
  assert.equal(pluginResult.status, "active");
});

test("package list and get do not require Jelly Core", async () => {
  const calls = [];
  await executeWpApiTool("wp_package_list", {
    packageType: "theme"
  }, {
    runCliImpl: async (args) => {
      calls.push(args);
      return {
        exitCode: 0,
        stdout: "{}\n",
        stderr: "",
        data: { items: [], pagination: { total: 0, totalPages: 0 } }
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["themes", "list", "--json"]);
});

