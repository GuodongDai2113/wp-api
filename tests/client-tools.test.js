import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConfigStore } from "../build/config/store.js";
import { getStoredClient, listStoredClients, resolveWordPressClient } from "../build/mcp/client-registry.js";

/** 创建包含一个已加密连接的隔离测试目录。 */
async function seedClient(t) {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-client-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const store = new ConfigStore({ configDir });
  await store.saveClient({ name: "prod", siteUrl: "https://example.com/wordpress", username: "editor", appPassword: "secret" });
  return configDir;
}

test("MCP client 工具仅列出和查找不含账号密码的连接", async (t) => {
  const configDir = await seedClient(t);
  const summary = { name: "prod", siteUrl: "https://example.com/wordpress" };
  assert.deepEqual(await listStoredClients({ configDir }), [summary]);
  assert.deepEqual(await getStoredClient("prod", { configDir }), summary);
  await assert.rejects(() => getStoredClient("missing", { configDir }), /Client "missing" not found/);
});

test("MCP 连接解析仅允许同源站点子路径覆盖", async (t) => {
  const configDir = await seedClient(t);
  const client = await resolveWordPressClient({ client: "prod", siteUrl: "https://example.com/staging/" }, { configDir });
  assert.equal(client.baseUrl, "https://example.com/staging");
  assert.equal(client.username, "editor");
  await assert.rejects(() => resolveWordPressClient({ client: "prod", siteUrl: "https://other.example/staging" }, { configDir }), /same origin/);
});

test("MCP 连接解析要求显式 client 且不存在时直接报错", async (t) => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-empty-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  await assert.rejects(() => resolveWordPressClient({}, { configDir }), /Client must be a non-empty string/);
  await assert.rejects(() => resolveWordPressClient({ client: "missing" }, { configDir }), /Client "missing" not found/);
  assert.deepEqual(await listStoredClients({ configDir }), []);
});
