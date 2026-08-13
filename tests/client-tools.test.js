import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  addStoredClient,
  listStoredClients,
  resolveWordPressClient,
  useStoredClient
} from "../build/mcp/client-tools.js";

test("MCP client 工具保存、列出并选择不含密码的 client", async (t) => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-client-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));

  const saved = await addStoredClient({
    name: "prod",
    siteUrl: "https://example.com/wordpress/",
    username: "editor",
    appPassword: "app-password"
  }, { configDir });
  assert.deepEqual(saved, {
    name: "prod",
    siteUrl: "https://example.com/wordpress",
    username: "editor"
  });
  assert.equal("appPassword" in saved, false);

  assert.deepEqual(await listStoredClients({ configDir }), {
    activeClient: null,
    clients: [saved]
  });
  assert.deepEqual(await useStoredClient("prod", { configDir }), saved);
  assert.equal((await listStoredClients({ configDir })).activeClient, "prod");
});

test("MCP client 工具拒绝不安全站点地址和空凭据", async (t) => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-client-safe-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));

  await assert.rejects(
    () => addStoredClient({
      name: "prod",
      siteUrl: "http://example.com",
      username: "editor",
      appPassword: "secret"
    }, { configDir }),
    /must use HTTPS/
  );
  await assert.rejects(
    () => addStoredClient({
      name: "prod",
      siteUrl: "https://example.com",
      username: "",
      appPassword: "secret"
    }, { configDir }),
    /Username must be a non-empty string/
  );
});

test("MCP 连接解析仅允许同源站点子路径覆盖", async (t) => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-client-origin-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  await addStoredClient({
    name: "prod",
    siteUrl: "https://example.com/wordpress",
    username: "editor",
    appPassword: "secret"
  }, { configDir });
  await useStoredClient("prod", { configDir });

  const client = await resolveWordPressClient({
    siteUrl: "https://example.com/staging/"
  }, { configDir });
  assert.equal(client.baseUrl, "https://example.com/staging");

  await assert.rejects(
    () => resolveWordPressClient({ siteUrl: "https://other.example/staging" }, { configDir }),
    /same origin/
  );
});
