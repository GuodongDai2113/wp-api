import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedResultStore } from "../build/mcp/result-store.js";
import { createWpApiMcpServer } from "../build/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/** 为每个测试创建独立目录，清理只作用于此测试拥有的临时目录。 */
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** 验证指针转义、缺失与空值、字段投影以及分页预算不跳过未返回项。 */
test("stored result reads support pointers and exact bounded continuation", async (t) => {
  const store = new ManagedResultStore({ resultDirectory: await temporary(t) });
  const rows = Array.from({ length: 30 }, (_, id) => ({ id, title: "x".repeat(200), secret: "not-selected" }));
  const file = await store.put(JSON.stringify({ rows, "a/b": { "~key": null }, text: "x".repeat(4000) }));
  const index = await store.read({ resultId: file.resultId });
  assert.deepEqual(index.keys, ["rows", "a/b", "text"]);
  const nullValue = await store.read({ resultId: file.resultId, jsonPointer: "/a~1b/~0key" });
  assert.equal(nullValue.data, null);
  const first = await store.read({ resultId: file.resultId, jsonPointer: "/rows", limit: 30 });
  assert.ok(first.returned > 0 && first.returned < 30);
  assert.equal(first.nextOffset, first.returned);
  const ids = [];
  let offset = 0;
  do {
    const page = await store.read({ resultId: file.resultId, jsonPointer: "/rows", limit: 30, offset });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1800);
    ids.push(...page.items.map((row) => row.id));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(ids, rows.map((row) => row.id));
  const precise = await store.read({ resultId: file.resultId, jsonPointer: "/rows", fields: ["id"], limit: 30 });
  assert.equal(precise.returned, 30);
  assert.deepEqual(precise.items[0], { id: 0 });
  const oversized = await store.read({ resultId: file.resultId, jsonPointer: "/text" });
  assert.equal(oversized.omitted, true);
  assert.equal(Object.hasOwn(oversized, "data"), false);
  for (const args of [{ jsonPointer: "/missing" }, { jsonPointer: "/rows/01" }, { jsonPointer: "/~2" }, { jsonPointer: "/rows", offset: 31 }, { fields: ["__proto__.x"] }]) {
    await assert.rejects(store.read({ resultId: file.resultId, ...args }), /result_|json_pointer/);
  }
  assert.equal((await store.read({ resultId: file.resultId, jsonPointer: "/rows", offset: 30 })).nextOffset, null);
});

/** 当前注册表限制读取边界，文件被篡改、缺失或替换为符号链接均不得泄露外部数据。 */
test("result IDs isolate sessions and reject changed files and paths", async (t) => {
  const directory = await temporary(t);
  const store = new ManagedResultStore({ resultDirectory: directory });
  const other = new ManagedResultStore({ resultDirectory: directory });
  const entry = await store.put('{"id":1}');
  await assert.rejects(other.read({ resultId: entry.resultId }), /result_unavailable/);
  await assert.rejects(store.read({ resultId: entry.file_path }), /invalid_result_id/);
  await assert.rejects(store.read({ resultId: "../../outside.json" }), /invalid_result_id/);
  await writeFile(entry.file_path, '{"id":2}');
  await assert.rejects(store.read({ resultId: entry.resultId }), /result_file_unavailable/);
  await rm(entry.file_path);
  await assert.rejects(store.read({ resultId: entry.resultId }), /result_file_unavailable/);
  const outside = join(directory, "user-export.json");
  await writeFile(outside, '{"private":"must-not-read"}');
  try { await symlink(outside, entry.file_path, "file"); } catch (error) {
    if (error.code !== "EPERM") throw error;
    t.diagnostic("File symlink creation unavailable; session, path, tamper and missing-file assertions completed.");
    return;
  }
  await assert.rejects(store.read({ resultId: entry.resultId }), /result_file_unavailable/);
});

/** 惰性过期和容量淘汰只处理会话登记文件；锁保护正在读取的条目。 */
test("result lifecycle preserves user files and serializes reads with eviction", async (t) => {
  assert.throws(() => new ManagedResultStore({ resultMaxBytes: 0 }), /positive/);
  assert.throws(() => new ManagedResultStore({ resultTtlMs: 366 * 86400000 }), /one year/);
  const directory = await temporary(t);
  const userFile = join(directory, "elementor-work.json");
  await writeFile(userFile, "keep");
  const store = new ManagedResultStore({ resultDirectory: directory, resultMaxBytes: 100 });
  const first = await store.put(JSON.stringify({ text: "x".repeat(60) }));
  const [read, second] = await Promise.all([store.read({ resultId: first.resultId, jsonPointer: "/text" }), store.put(JSON.stringify({ text: "y".repeat(60) }))]);
  assert.equal(read.data.length, 60);
  await assert.rejects(store.read({ resultId: first.resultId }), /result_unavailable/);
  assert.equal((await store.read({ resultId: second.resultId, jsonPointer: "/text" })).data, "y".repeat(60));
  assert.equal(await readFile(userFile, "utf8"), "keep");
  await assert.rejects(store.put(JSON.stringify({ text: "z".repeat(100) })), /result_too_large/);
  const expiring = new ManagedResultStore({ resultDirectory: directory, resultTtlMs: 1 });
  const old = await expiring.put("{}");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(expiring.read({ resultId: old.resultId }), /result_expired/);
  await assert.rejects(readFile(old.file_path), /ENOENT/);
});

/** 真实 MCP 流程从落盘引用取得 ID，无凭据读切片，且完整响应不会再次落盘。 */
test("MCP stored reference can be read in bounded slices without WordPress", async (t) => {
  const directory = await temporary(t);
  let remoteCalls = 0;
  const options = { resultDirectory: directory,
    /** 只有源读取访问远端，结果切片不得解析 client。 */
    resolveClientImpl: async () => { remoteCalls++; return { get: async () => ({ id: 1, items: Array.from({ length: 200 }, (_, id) => ({ id, text: "x".repeat(100) })) }) }; } };
  const server = createWpApiMcpServer(options);
  const other = createWpApiMcpServer(options);
  const [left, right] = InMemoryTransport.createLinkedPair();
  const [leftOther, rightOther] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "result-test", version: "1" });
  const clientOther = new Client({ name: "other-test", version: "1" });
  await server.connect(right); await client.connect(left);
  await other.connect(rightOther); await clientOther.connect(leftOther);
  t.after(async () => { await client.close(); await server.close(); await clientOther.close(); await other.close(); });
  const original = await client.callTool({ name: "wp_resource_get", arguments: { client: "test", target: { type: "post", resource: "posts" }, id: 1 } });
  const reference = original.structuredContent.result;
  assert.equal(reference.stored, true);
  const args = { resultId: reference.resultId, jsonPointer: "/items", fields: ["id"], limit: 100 };
  const page = await client.callTool({ name: "wp_result_read", arguments: args });
  assert.equal(page.isError, undefined);
  assert.equal(page.structuredContent.result.items[0].id, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 8192);
  assert.equal(remoteCalls, 1);
  const rejected = await clientOther.callTool({ name: "wp_result_read", arguments: args });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /result_unavailable/);
});
