import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWpApiMcpServer } from "../build/mcp/server.js";
import { WordPressClient } from "../build/wordpress/client.js";
import { makeFixtureFetch } from "./cost-fixtures.mjs";

/** 运行 Catalog 约束→Meta 更新→复读验证任务，对比整文件补读和精确读取成本。 */
async function run() {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-read-cost-"));
  let requests = 0;
  const initialMeta = { spec_0: [{ title: "重量", unit: "kg" }], padding: "字段说明".repeat(10000) };
  const fixture = makeFixtureFetch({ meta: initialMeta });
  const remote = new WordPressClient({ baseUrl: "https://example.test", username: "test", appPassword: "test",
    /** 统计真实 WordPressClient 发起的合成 HTTP 请求，结果读取不得增加此计数。 */
    fetchImpl: async (...args) => { requests++; return fixture(...args); } });
  const server = createWpApiMcpServer({ resultDirectory: directory, resolveClientImpl: async () => remote });
  const client = new Client({ name: "bounded-cost", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  let wireBytes = 0;
  const send = right.send.bind(right);
  /** 统计 SDK 实际发送的 JSON-RPC 响应，包含错误状态和包装。 */
  right.send = async (message, options) => { wireBytes += Buffer.byteLength(JSON.stringify(message)); return send(message, options); };
  /** 重置单次计数并验证工具成功。 */
  async function call(name, args) {
    wireBytes = 0;
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true);
    return { payload: result.structuredContent.result, wireBytes };
  }
  try {
    await server.connect(right); await client.connect(left);
    const target = { type: "post", resource: "products" };
    const discovery = await call("wp_resource_get", { client: "test", target, id: 1, context: "edit" });
    const selection = await call("wp_result_read", { resultId: discovery.payload.resultId,
      jsonPointer: "/meta/spec_0" });
    assert.deepEqual(selection.payload.data, initialMeta.spec_0);
    const meta = { spec_0: [{ title: "重量", unit: "kg" }] };
    const update = await call("wp_resource_update", { client: "test", target, id: 1, data: { meta } });
    const verified = await call("wp_resource_get", { client: "test", target, id: 1, context: "edit", fields: ["id", "meta"] });
    assert.deepEqual(verified.payload.meta, meta);
    assert.equal(requests, 3);
    const common = discovery.wireBytes + update.wireBytes + verified.wireBytes;
    return { fixtureVersion: 3, task: "read product meta then update and verify", completed: true, upstreamRequests: requests,
      sourceReferenceBytes: discovery.wireBytes, storedFileBytes: discovery.payload.bytes,
      boundedReadWireBytes: selection.wireBytes, updateAndVerifyWireBytes: update.wireBytes + verified.wireBytes,
      fullFileTaskContextBytes: common + discovery.payload.bytes, boundedTaskContextBytes: common + selection.wireBytes,
      baselineMcpCalls: 3, boundedMcpCalls: 4,
      measurement: "Actual MCP response bytes; full-file alternative adds reference.bytes instead of the bounded-read response. No tokenizer, host file-tool envelope, or live network measurement. The agent-facing workflow did not receive the full file; the server still reads and parses it locally." };
  } finally { await client.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }
}

const report = `${JSON.stringify(await run(), null, 2)}\n`;
if (process.argv[2]) await writeFile(resolve(process.argv[2]), report);
else process.stdout.write(report);
