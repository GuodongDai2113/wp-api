import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWpApiMcpServer } from "../build/mcp/server.js";
import { WordPressClient } from "../build/wordpress/client.js";
import { measureToolCall } from "../build/shared/diagnostics.js";
import { makeFixtureFetch, makeScenarios } from "./cost-fixtures.mjs";

/** 计算实际 UTF-8 JSON 大小，不把字节数当作 token 数。 */
function bytes(value) { return Buffer.byteLength(JSON.stringify(value)); }

/**
 * 使用真实 SDK transport、WordPress client 和固定 HTTP 样本测量全部任务。
 * 每个落盘结果完整补读一次并计入成本，导出 CSV 单独记大小、不假设注入 Agent。
 */
export async function benchmarkCost(scenarioName) {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-cost-"));
  const scenarios = [];
  let discovery;
  try {
    for (const scenario of makeScenarios(directory)) {
      if (scenarioName && scenario.name !== scenarioName) continue;
      const remote = new WordPressClient({ baseUrl: "https://example.test", username: "synthetic", appPassword: "synthetic",
        fetchImpl: makeFixtureFetch(scenario.fixture) });
      const server = createWpApiMcpServer({ resultDirectory: directory, resolveClientImpl: async () => remote });
      const client = new Client({ name: "cost-benchmark", version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const send = serverTransport.send.bind(serverTransport);
      let wireBytes = 0;
      /** 捕获真正发出的完整 JSON-RPC 信封，含 SDK 包装和错误结果。 */
      serverTransport.send = async (message, options) => {
        wireBytes += bytes(message);
        return send(message, options);
      };
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        if (!discovery) {
          wireBytes = 0;
          const tools = await client.listTools();
          discovery = { resultBytes: bytes(tools), wireBytes, tools: tools.tools.map((tool) => ({ name: tool.name, bytes: bytes(tool) })).sort((a, b) => b.bytes - a.bytes) };
        }
        const calls = [];
        let finalPayload;
        const taskStarted = performance.now();
        for (const step of scenario.steps) {
          wireBytes = 0;
          let diagnostic;
          const result = await measureToolCall(step.name, () => client.callTool(step), (record) => { diagnostic = record; });
          if (result.isError && scenario.name !== "batch-partial-failure") throw new Error(`Scenario ${scenario.name}: ${result.content[0]?.text}`);
          let payload = result.structuredContent.result;
          let rereadBytes = 0;
          if (payload?.stored === true) {
            const stored = await readFile(payload.file_path);
            rereadBytes = stored.byteLength;
            payload = JSON.parse(stored);
          }
          const exportBytes = payload?.export ? (await readFile(payload.export.file_path)).byteLength : 0;
          finalPayload = payload;
          calls.push({ ...diagnostic, wireBytes, rereadBytes, exportBytes,
            failedItems: payload?.failed ?? 0, exportedRows: payload?.export?.rows ?? 0 });
        }
        if (scenario.name === "find-and-edit") assert.equal(finalPayload.status, "draft");
        if (scenario.name === "catalog-and-meta") assert.deepEqual(finalPayload.meta.spec_0, [{ title: "重量", unit: "kg" }]);
        if (scenario.name === "locate-and-edit-menu") assert.equal(finalPayload.items.find((item) => item.id === 2).title, "已更新");
        if (scenario.name === "csv-export") assert.equal(finalPayload.export.rows, 205);
        if (scenario.name === "batch-partial-failure") assert.equal(finalPayload.failed, 6);
        if (scenario.name === "long-link-update") assert.equal(finalPayload.replacements, 1);
        if (scenario.name === "many-links") assert.equal(finalPayload.links.length, 300);
        scenarios.push({ name: scenario.name, completed: true, taskElapsedMs: performance.now() - taskStarted, calls, totals: {
          requests: calls.reduce((sum, call) => sum + call.requests, 0),
          responseBytes: calls.reduce((sum, call) => sum + call.responseBytes, 0),
          wireBytes: calls.reduce((sum, call) => sum + call.wireBytes, 0),
          rereadBytes: calls.reduce((sum, call) => sum + call.rereadBytes, 0),
          elapsedMs: calls.reduce((sum, call) => sum + call.elapsedMs, 0),
          storedResults: calls.reduce((sum, call) => sum + call.storedResults, 0)
        }, processHighWaterRssKiB: process.resourceUsage().maxRSS });
      } finally {
        await client.close();
        await server.close();
      }
    }
    return { fixtureVersion: 2, node: process.version, platform: process.platform, tokenizer: null,
      measurement: "Synthetic HTTP; UTF-8 bytes; JSON-RPC excludes newline framing. File rereads count once. RSS is process lifetime high-water, not per-scenario allocation. Host visibility and real network latency are not measured.",
      discovery, scenarios };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** 每个场景使用独立 Node 进程，内存高水位只包含该场景及必要的 SDK 初始化。 */
export function benchmarkIsolated() {
  let report;
  const scenarios = [];
  for (const scenario of makeScenarios("")) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--scenario", scenario.name], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(child.stderr || `Benchmark child exited ${child.status}`);
    const result = JSON.parse(child.stdout);
    report ??= result;
    scenarios.push(...result.scenarios);
  }
  return { ...report, isolatedScenarios: true, scenarios,
    measurement: "Synthetic HTTP; UTF-8 bytes; one child process per scenario. RSS includes SDK initialization and this scenario only. File rereads count once; host visibility and real network latency are not measured." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const worker = process.argv[2] === "--scenario";
  const report = worker ? await benchmarkCost(process.argv[3]) : benchmarkIsolated();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (!worker && process.argv[2]) await writeFile(resolve(process.argv[2]), json);
  else process.stdout.write(json);
}
