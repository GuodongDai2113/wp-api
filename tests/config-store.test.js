import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

import { ConfigStore } from "../build/config/store.js";

/** 创建测试专用临时凭据目录并在测试结束时清理。 */
async function createStore(t) {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-vault-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  return { configDir, store: new ConfigStore({ configDir }) };
}

/** 在独立 Node 进程中保存一个连接，用于验证文件锁。 */
async function saveFromChildProcess(configDir, name) {
  const moduleUrl = new URL("../build/config/store.js", import.meta.url).href;
  const source = `import { ConfigStore } from ${JSON.stringify(moduleUrl)}; const store = new ConfigStore({configDir: process.env.TEST_VAULT_DIR}); await store.saveClient({name: process.env.TEST_CLIENT_NAME, siteUrl: 'https://' + process.env.TEST_CLIENT_NAME + '.example.com', username: 'user-' + process.env.TEST_CLIENT_NAME, appPassword: 'pass-' + process.env.TEST_CLIENT_NAME});`;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      env: { ...process.env, TEST_VAULT_DIR: configDir, TEST_CLIENT_NAME: name },
      stdio: ["ignore", "ignore", "pipe"]
    });
    let errors = "";
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(errors || `Child exited with ${code}`)));
  });
}

test("ConfigStore 默认使用用户级目录并允许环境变量覆盖", () => {
  const previous = process.env.WP_API_CONFIG_DIR;
  process.env.WP_API_CONFIG_DIR = path.join(os.tmpdir(), "wp-api-custom-vault");
  try {
    assert.equal(new ConfigStore().configDir, path.resolve(process.env.WP_API_CONFIG_DIR));
  } finally {
    if (previous === undefined) delete process.env.WP_API_CONFIG_DIR;
    else process.env.WP_API_CONFIG_DIR = previous;
  }
});

test("ConfigStore 加密保存连接且公开列表不含用户名和密码", async (t) => {
  const { configDir, store } = await createStore(t);
  await store.saveClient({ name: "prod", siteUrl: "https://example.com", username: "secret-user", appPassword: "secret-pass" });

  assert.deepEqual(await store.listClients(), [{ name: "prod", siteUrl: "https://example.com" }]);
  assert.deepEqual(await store.listClientsForConfiguration(), [{
    name: "prod", siteUrl: "https://example.com", username: "secret-user", passwordSet: true
  }]);
  const vaultText = await readFile(path.join(configDir, "vault.json"), "utf8");
  assert.equal(vaultText.includes("secret-user"), false);
  assert.equal(vaultText.includes("secret-pass"), false);
  assert.equal(vaultText.includes("Basic"), false);
  assert.equal((await readFile(path.join(configDir, "vault.key"), "utf8")).trim().length > 0, true);
});

test("ConfigStore 支持重命名和删除连接", async (t) => {
  const { store } = await createStore(t);
  await store.saveClient({ name: "old", siteUrl: "https://example.com", username: "admin", appPassword: "pass" });
  await store.saveClient({ name: "new", siteUrl: "https://example.com/new", username: "editor", appPassword: "next" }, "old");
  assert.deepEqual(await store.listClients(), [{ name: "new", siteUrl: "https://example.com/new" }]);
  assert.equal((await store.getClient("new")).appPassword, "next");
  await store.removeClient("new");
  assert.deepEqual(await store.listClients(), []);
});

test("ConfigStore 检测凭据库密文篡改", async (t) => {
  const { configDir, store } = await createStore(t);
  await store.saveClient({ name: "prod", siteUrl: "https://example.com", username: "admin", appPassword: "pass" });
  const vaultPath = path.join(configDir, "vault.json");
  const envelope = JSON.parse(await readFile(vaultPath, "utf8"));
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
  await writeFile(vaultPath, JSON.stringify(envelope), "utf8");
  await assert.rejects(() => store.listClients(), /could not be decrypted or is invalid/);
});

test("ConfigStore 使用跨进程锁保留并发更新", async (t) => {
  const { configDir, store } = await createStore(t);
  await Promise.all([saveFromChildProcess(configDir, "prod"), saveFromChildProcess(configDir, "staging")]);
  assert.deepEqual((await store.listClients()).map((client) => client.name), ["prod", "staging"]);
});

test("ConfigStore 原子写入并尽可能限制目录和文件权限", async (t) => {
  const { configDir, store } = await createStore(t);
  if (process.platform !== "win32") await chmod(configDir, 0o777);
  await store.saveClient({ name: "prod", siteUrl: "https://example.com", username: "admin", appPassword: "pass" });
  assert.deepEqual((await readdir(configDir)).sort(), ["vault.json", "vault.key"]);
  if (process.platform !== "win32") {
    assert.equal((await stat(configDir)).mode & 0o777, 0o700);
    assert.equal((await stat(store.vaultPath)).mode & 0o777, 0o600);
    assert.equal((await stat(store.keyPath)).mode & 0o777, 0o600);
  }
});
