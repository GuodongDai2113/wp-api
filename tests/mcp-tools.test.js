import test from "node:test";
import assert from "node:assert/strict";

import { buildCliArgsForTool, executeWpApiTool } from "../dist/mcp/wp-api-tools.js";

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
