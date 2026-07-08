import test from "node:test";
import assert from "node:assert/strict";

import { buildCliArgsForTool, executeWpApiTool } from "../build/mcp/wp-api-tools.js";

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

