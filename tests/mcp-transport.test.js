import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createWpApiMcpServer } from "../build/mcp/server.js";

test("MCP transport 完成工具发现、结构化成功响应和标准错误响应", async (t) => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-transport-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWpApiMcpServer({ configDir });
  const client = new Client({ name: "wp-api-test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = await client.listTools();
  assert.equal(tools.tools.length, 27);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_client_list"), true);

  const success = await client.callTool({
    name: "wp_client_list",
    arguments: {}
  });
  assert.equal(success.isError, undefined);
  assert.deepEqual(success.structuredContent, {
    result: { activeClient: null, clients: [] }
  });

  const failure = await client.callTool({
    name: "wp_resource_get",
    arguments: { resource: "posts", id: 1 }
  });
  assert.equal(failure.isError, true);
  assert.match(failure.content[0].text, /No client selected/);
});
