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

test("wp_elementor_get_tokens maps to a default kit CLI read", () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_elementor_get_tokens", { client: "prod" }),
    ["--client", "prod", "elementor", "get-tokens", "--json"]
  );
});

test("wp_elementor_set_tokens maps token updates to JSON CLI input", () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_elementor_set_tokens", {
      tokens: { system_colors: [{ _id: "primary", color: "#112233" }] }
    }),
    [
      "elementor",
      "set-tokens",
      "--json",
      "--tokens-json",
      "{\"system_colors\":[{\"_id\":\"primary\",\"color\":\"#112233\"}]}"
    ]
  );
});

test("Elementor token MCP tools are registered with required token settings", () => {
  const registrations = new Map();
  const server = {
    registerTool(name, definition) {
      registrations.set(name, definition);
    }
  };

  registerWpApiTools(server);

  assert.ok(registrations.has("wp_elementor_get_tokens"));
  assert.ok(registrations.has("wp_elementor_set_tokens"));
  const setDefinition = registrations.get("wp_elementor_set_tokens");
  assert.equal(setDefinition.inputSchema.postId, undefined);
  assert.equal(setDefinition.inputSchema.resource, undefined);
  assert.equal(setDefinition.inputSchema.tokens.safeParse(undefined).success, false);
  assert.equal(setDefinition.inputSchema.tokens.safeParse({}).success, true);
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

