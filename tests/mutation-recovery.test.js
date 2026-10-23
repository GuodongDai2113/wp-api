import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batchCreateResources, batchUpdateResources, createResource, updateResource, deleteResource } from "../build/mcp/tools/resources.js";
import { batchUpdateResourceSeo } from "../build/mcp/tools/seo.js";
import { WordPressClient } from "../build/wordpress/client.js";
import { toToolResult } from "../build/mcp/tool-result.js";
import { registerWpApiTools } from "../build/mcp/server.js";
import { createWpApiMcpServer } from "../build/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/** 所有测试均使用固定资源目标与合成凭据。 */
const target = { type: "post", resource: "posts" };

/** 真实 SDK 保留部分失败 isError 和结构化计数，普通成功回执仍符合输出 schema。 */
test("MCP transport preserves mutation receipts and partial-failure isError", async (t) => {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const server = createWpApiMcpServer({
    /** 用最小响应覆盖成功写入和业务失败。 */
    resolveClientImpl: async () => ({ create: async () => ({ id: 7, status: "draft" }),
      requestApiPath: async () => ({ data: { responses: [{ status: 403, body: { code: "denied", message: "Denied" } }] } }) })
  });
  const client = new Client({ name: "receipt-test", version: "1" });
  await server.connect(right); await client.connect(left);
  t.after(async () => { await client.close(); await server.close(); });
  const success = await client.callTool({ name: "wp_resource_create", arguments: { client: "test", target, data: { title: "Test" } } });
  assert.equal(success.isError, undefined);
  assert.deepEqual(success.structuredContent.result, { operation: "create", execution: "confirmed", id: 7, status: "draft" });
  const failure = await client.callTool({ name: "wp_resource_batch_update", arguments: { client: "test", target, items: [{ id: 1, data: { status: "draft" } }] } });
  assert.equal(failure.isError, true);
  assert.equal(failure.structuredContent.result.failed, 1);
  assert.equal(failure.structuredContent.result.items[0].id, 1);
  assert.equal((await toToolResult("wp_resource_create", null, {})).isError, true);
});

/** 模拟第二块在不同阶段失败，验证前一块成功不会丢失，后续块不会发送。 */
test("batch interruption preserves confirmed IDs and separates unknown from not executed", async () => {
  for (const failure of ["network", "oversize", "invalid-json", "unmatched"]) {
    let calls = 0;
    const client = new WordPressClient({ baseUrl: "https://example.test", username: "test", appPassword: "test", maxResponseBytes: 4096,
      /** 请求可能已执行，任何异常都不应被自动重试。 */
      fetchImpl: async (_url, init) => {
        calls++;
        const requests = JSON.parse(init.body).requests;
        assert.ok(requests.every((request) => request.path.endsWith("?_fields=id,status")));
        if (calls === 2) {
          if (failure === "network") throw new Error("Synthetic timeout after remote commit");
          return new Response(failure === "oversize" ? "x".repeat(5000) : failure === "invalid-json" ? "{" : '{"responses":[]}', { headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ responses: requests.map((_, index) => ({ status: 201, body: { id: 1000 + index } })) }), { headers: { "content-type": "application/json" } });
      } });
    const result = await batchCreateResources(client, { target, items: Array.from({ length: 60 }, (_, index) => ({ id: index + 1, data: { title: `Item ${index}` } })) });
    assert.equal(calls, 2);
    assert.deepEqual([result.total, result.succeeded, result.failed, result.unknown, result.notExecuted], [60, 25, 0, 25, 10]);
    assert.deepEqual(result.items[0], { index: 0, sourceId: 1, id: 1000, success: true });
    assert.deepEqual(result.items[25], { index: 25, sourceId: 26, success: null, state: "unknown" });
    assert.deepEqual(result.items[50], { index: 50, sourceId: 51, success: null, state: "not_executed" });
    const mcp = await toToolResult("wp_resource_batch_create", result, {});
    assert.equal(mcp.isError, true);
    assert.equal(mcp.structuredContent.result.unknown, 25);
  }
});

/** malformed 单项保留同块其他确定结果；错误消息有界但错误状态仍保留。 */
test("batch malformed items and bounded errors retain failure semantics", async () => {
  const result = await batchUpdateResources({
    /** 第一个成功，第二个已知错误，第三个无法确认。 */
    requestApiPath: async () => ({ data: { responses: [{ status: 200, body: { id: 1 } }, { status: 403, body: { code: "denied", message: "x".repeat(10000) } }, null] } })
  }, { target, items: [1, 2, 3].map((id) => ({ id, data: { status: "draft" } })) });
  assert.deepEqual([result.succeeded, result.failed, result.unknown], [1, 1, 1]);
  assert.equal(result.items[1].error.truncated, true);
  assert.equal(result.items[1].error.message.length, 512);
  assert.equal(result.items[2].id, 3);
  assert.equal((await toToolResult("wp_resource_batch_update", result, {})).isError, true);
});

/** SEO 成功必须保留实际 meta，未返回 meta 时不能把缺失数据伪造为清空值。 */
test("SEO batches project actual values and preserve progress after interruption", async () => {
  let calls = 0;
  const result = await batchUpdateResourceSeo({
    /** 第一块返回实际写入值，第二块模拟读取响应失败。 */
    requestApiPath: async (_path, options) => {
      calls++;
      if (calls === 2) throw new Error("Response unavailable");
      return { data: { responses: options.body.requests.map((request) => {
        const url = new URL(request.path, "https://example.test");
        assert.equal(url.searchParams.get("_fields"), "id,meta");
        return { status: 200, body: { id: Number(url.pathname.split("/").at(-1)), meta: { rank_math_title: "actual saved value" } } };
      }) } };
    }
  }, { resource: "posts", items: Array.from({ length: 60 }, (_, i) => ({ id: i + 1, title: "submitted value" })) });
  assert.equal(calls, 2);
  assert.equal(result.items[0].seo.rank_math_title, "actual saved value");
  assert.deepEqual([result.succeeded, result.failed, result.unknown, result.notExecuted], [25, 0, 25, 10]);
  const absent = await batchUpdateResourceSeo({ requestApiPath: async () => ({ data: { responses: [{ status: 200, body: { id: 1 } }] } }) },
    { resource: "posts", items: [{ id: 1, title: "" }] });
  assert.equal(absent.unknown, 1);
  assert.equal(absent.items[0].seo, undefined);
});

/** 写入摘要只报告实际返回的证据，并验证完整模式与 HTTP 查询透传。 */
test("resource mutations return bounded evidence-based receipts with full compatibility", async () => {
  const calls = [];
  const client = new WordPressClient({ baseUrl: "https://example.test", username: "test", appPassword: "test",
    /** 故意返回无关大字段，测试上游忽略投影时的本地摘要兜底。 */
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return new Response(JSON.stringify(init.method === "DELETE" ? { deleted: true, previous: { id: 7, content: "x".repeat(20000) } }
        : { id: 7, status: "draft", content: "x".repeat(20000) }), { headers: { "content-type": "application/json" } });
    } });
  const created = await createResource(client, { target, data: { title: "create", status: "publish" } });
  assert.deepEqual(created, { operation: "create", execution: "confirmed", id: 7, status: "draft" });
  assert.equal(calls[0].url.searchParams.get("_fields"), "id,status");
  const updated = await updateResource(client, { target, id: 7, data: { meta: { key: null } } });
  assert.equal(updated.id, 7);
  assert.deepEqual(JSON.parse(calls[1].init.body), { meta: { key: null } });
  const deleted = await deleteResource(client, { target, id: 7, force: true });
  assert.deepEqual(deleted, { operation: "delete", execution: "confirmed", id: 7, deleted: true });
  assert.equal(calls[2].url.searchParams.get("_fields"), "id,status,deleted,previous.id");
  assert.equal(calls[2].url.searchParams.get("force"), "true");
  const full = await updateResource(client, { target, id: 7, data: { status: "draft" }, detail: "full" });
  assert.equal(full.content.length, 20000);
  assert.equal(calls[3].url.searchParams.has("_fields"), false);
  const unknown = await updateResource({ update: async () => ({ id: 99 }) }, { target, id: 7, data: { status: "draft" } });
  assert.deepEqual(unknown, { operation: "update", execution: "unknown", requestedId: 7 });
  assert.equal((await toToolResult("wp_resource_update", unknown, {}, false, 7)).isError, true);
});

/** 在远端创建完成后让结果目录失效，验证交付失败仍携带新 ID 且不会重复创建。 */
test("post-write storage failure retains receipt and reports delivery error", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wp-api-delivery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resultDirectory = join(root, "results");
  await mkdir(resultDirectory);
  let writes = 0;
  const callbacks = new Map();
  registerWpApiTools({ registerTool: (name, _definition, callback) => callbacks.set(name, callback) }, {
    resultDirectory,
    /** 只在领域写入阶段破坏测试目录，路径校验阶段已成功。 */
    resolveClientImpl: async () => ({ create: async () => {
      writes++;
      await rm(resultDirectory, { recursive: true });
      await writeFile(resultDirectory, "blocked");
      return { id: 123, status: "draft", content: "x".repeat(20000) };
    } })
  });
  const result = await callbacks.get("wp_resource_create")({ client: "test", target, detail: "full", data: { title: "created" } });
  assert.equal(writes, 1);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.result.deliveryError.code, "result_delivery_failed");
  assert.equal(result.structuredContent.result.summary.id, 123);
  assert.equal(result.structuredContent.result.summary.execution, "confirmed");
  assert.match(result.content[0].text, /Do not repeat writes/);
  const cyclic = { id: 124 }; cyclic.circular = cyclic;
  const serialization = await toToolResult("wp_resource_create", cyclic, {});
  assert.equal(serialization.structuredContent.result.summary.id, 124);
});

/** 大结果保留分页和批量计数；文件范围明确，超过预览范围的映射不伪装为完整。 */
test("stored results keep pagination and partial-failure summaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wp-api-summary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = { items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, content: "x".repeat(200) })),
    pagination: { total: 200, totalPages: 2 }, page: 1, perPage: 100, nextPage: 2 };
  const result = await toToolResult("wp_resource_list", data, { resultDirectory: root });
  const reference = result.structuredContent.result;
  assert.equal(reference.scope, "requested_result");
  assert.equal(reference.summary.nextPage, 2);
  assert.equal(reference.summary.itemsTruncated, true);
  assert.equal(reference.summary.items.length, 20);
  assert.equal(JSON.parse(await readFile(reference.file_path, "utf8")).items.length, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 8192);
});
