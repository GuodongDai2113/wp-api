import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { startConfigServer } from "../build/config/config-server.js";
import { ConfigStore } from "../build/lib/config-store.js";

/** 启动隔离的配置服务并在测试结束时关闭与清理。 */
async function createService(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-api-config-ui-"));
  const configDir = path.join(root, "vault");
  const service = await startConfigServer({ configDir, openBrowser: false, ...options });
  t.after(async () => {
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  const token = decodeURIComponent(new URL(service.url).hash.slice("#token=".length));
  return { root, configDir, service, token };
}

/** 调用带一次性令牌和正确 Origin 的配置 API。 */
async function callApi(service, token, pathname, options = {}) {
  return fetch(`${service.origin}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: service.origin,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
}

test("配置服务只监听回环地址并保护页面和 API", async (t) => {
  const { service, token } = await createService(t);
  assert.match(service.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const page = await fetch(`${service.origin}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(page.headers.get("cache-control"), "no-store, max-age=0");
  const pageHtml = await page.text();
  assert.equal(pageHtml.includes(token), false);
  assert.match(pageHtml, /class="layout"/);
  assert.match(pageHtml, /class="panel form-panel"/);
  assert.equal(pageHtml.includes("旧明文配置迁移"), false);
  const scriptBody = pageHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
  assert.doesNotThrow(() => new Function(scriptBody));

  assert.equal((await fetch(`${service.origin}/api/clients`)).status, 401);
  assert.equal((await fetch(`${service.origin}/api/clients`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Origin: "http://attacker.example", "Content-Type": "application/json" },
    body: "{}"
  })).status, 403);
  assert.equal((await callApi(service, token, "/api/migrations")).status, 404);
});

test("配置 API 完成新增、编辑、测试和删除且从不返回密码", async (t) => {
  let authorization = "";
  const fetchImpl = async (_url, init) => {
    authorization = new Headers(init.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ id: 1, name: "Editor" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const { configDir, service, token } = await createService(t, { fetchImpl });
  const createResponse = await callApi(service, token, "/api/clients", {
    method: "POST",
    body: JSON.stringify({ name: "prod", siteUrl: "https://example.com/wordpress/", username: "editor", appPassword: "first-pass" })
  });
  assert.equal(createResponse.status, 200);
  assert.equal((await createResponse.text()).includes("first-pass"), false);

  assert.equal((await callApi(service, token, "/api/clients/prod/test", { method: "POST" })).status, 200);
  assert.match(authorization, /^Basic /);
  assert.equal((await callApi(service, token, "/api/clients/prod/activate", { method: "POST" })).status, 404);
  assert.equal((await callApi(service, token, "/api/clients", {
    method: "PUT",
    body: JSON.stringify({ originalName: "prod", name: "production", siteUrl: "https://example.com/wordpress", username: "new-editor", appPassword: "" })
  })).status, 200);

  const listResponse = await callApi(service, token, "/api/clients");
  const list = await listResponse.json();
  assert.equal("activeClient" in list, false);
  assert.equal(list.clients[0].passwordSet, true);
  assert.equal("appPassword" in list.clients[0], false);
  assert.equal((await new ConfigStore({ configDir }).getClient("production")).appPassword, "first-pass");

  assert.equal((await callApi(service, token, "/api/clients/production", { method: "DELETE" })).status, 200);
  assert.deepEqual(await new ConfigStore({ configDir }).listClients(), []);
});

test("连接测试失败返回脱敏错误且服务继续处理请求", async (t) => {
  const fetchImpl = async () => new Response(JSON.stringify({ code: "invalid_username", message: "remote details" }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
  const { service, token } = await createService(t, { fetchImpl });
  const failed = await callApi(service, token, "/api/test", {
    method: "POST",
    body: JSON.stringify({ name: "temp", siteUrl: "https://example.com", username: "secret-user", appPassword: "secret-pass" })
  });
  const body = await failed.text();
  assert.equal(failed.status, 400);
  assert.equal(body.includes("secret-user"), false);
  assert.equal(body.includes("secret-pass"), false);
  assert.equal(body.includes("remote details"), false);
  assert.equal((await callApi(service, token, "/api/clients")).status, 200);
});

test("配置服务支持显式关闭和空闲自动关闭", async (t) => {
  const explicit = await createService(t);
  assert.equal((await callApi(explicit.service, explicit.token, "/api/shutdown", { method: "POST" })).status, 200);
  await explicit.service.finished;

  const idle = await createService(t, { idleTimeoutMs: 30 });
  await idle.service.finished;
});
