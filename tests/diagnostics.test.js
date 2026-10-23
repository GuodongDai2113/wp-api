import test from "node:test";
import assert from "node:assert/strict";
import { measureToolCall, recordDiagnostic } from "../build/shared/diagnostics.js";
import { WordPressClient } from "../build/wordpress/client.js";
import { benchmarkCost } from "../scripts/benchmark-cost.mjs";
import { spawnSync } from "node:child_process";

/** 验证并发工具的计数隔离，且日志不包含请求或响应中的敏感数据。 */
test("diagnostics isolate concurrent calls and contain only counts", async () => {
  const logs = [];
  await Promise.all([1, 2].map((count) => measureToolCall(`tool-${count}`, async () => {
    const client = new WordPressClient({ baseUrl: "https://secret.test", username: "secret-user", appPassword: "secret-password",
      /** 返回固定含敏感占位值的 JSON，仅允许字节数进入诊断。 */
      fetchImpl: async () => new Response('{"secret":"private-body"}', { headers: { "content-type": "application/json" } }) });
    for (let index = 0; index < count; index++) await client.get("posts", 1);
    return { content: [{ type: "text", text: "中文" }], structuredContent: { result: "private-body" } };
  }, (record) => logs.push(record))));
  for (const log of logs) {
    const count = Number(log.tool.at(-1));
    assert.equal(log.requests, count);
    assert.equal(log.responseBytes, count * Buffer.byteLength('{"secret":"private-body"}'));
    assert.equal(log.textBytes, 6);
    assert.equal(log.completed, true);
    assert.ok(log.resultBytes > log.structuredBytes);
  }
  assert.doesNotMatch(JSON.stringify(logs), /secret|private-body/);
});

/** 日志异常不得掩盖已完成的写入或原始操作错误。 */
test("diagnostic failures preserve operation outcome and original error", async () => {
  const failure = new Error("original-private-error");
  let log;
  await assert.rejects(measureToolCall("failure", async () => {
    recordDiagnostic("requests", 1);
    throw failure;
  }, (record) => { log = record; throw new Error("sink failure"); }), (error) => error === failure);
  assert.equal(log.completed, false);
  assert.equal(log.resultBytes, null);
  assert.equal(log.requests, 1);
  assert.doesNotMatch(JSON.stringify(log), /private-error/);
  assert.equal(await measureToolCall("success", async () => 42, () => { throw new Error("sink failure"); }), 42);
});

/** 网络异常、响应超限和 HTTP 失败仍保留实际请求数与已读取字节。 */
test("diagnostics count failed HTTP attempts without exposing error payloads", async () => {
  for (const mode of ["network", "limit", "http"]) {
    let log;
    const client = new WordPressClient({ baseUrl: "https://example.test", username: "test", appPassword: "test",
      maxResponseBytes: mode === "limit" ? 5 : 1024,
      /** 模拟不同阶段的失败；超限响应不提供 content-length，以覆盖真实流读取。 */
      fetchImpl: async () => {
        if (mode === "network") throw new Error("private-network-message");
        return new Response('{"message":"private-http-message"}', { status: mode === "http" ? 403 : 200,
          headers: { "content-type": "application/json" } });
      } });
    await assert.rejects(measureToolCall("failed-request", () => client.get("posts", 1), (record) => { log = record; }));
    assert.equal(log.requests, 1);
    assert.equal(log.completed, false);
    assert.equal(log.responseBytes, mode === "network" ? 0 : 34);
    assert.doesNotMatch(JSON.stringify(log), /private-/);
  }
});

/** 嵌套测量沿用外层上下文，避免开启环境变量后覆盖基准工具的计数。 */
test("nested diagnostic scopes retain outer counters", async () => {
  let log;
  await measureToolCall("outer", () => measureToolCall("inner", async () => {
    recordDiagnostic("requests", 2);
    return {};
  }, () => assert.fail("nested sink should not run")), (record) => { log = record; });
  assert.equal(log.requests, 2);
});

/** 在独立进程校验真实环境开关、stderr 输出及默认静默行为，不污染测试进程环境。 */
test("diagnostic environment flag writes only numeric metadata to stderr", () => {
  for (const enabled of ["0", "1"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { measureToolCall, recordDiagnostic } from './build/shared/diagnostics.js';
      await measureToolCall('wp_resource_get', async () => {
        recordDiagnostic('requests', 1);
        return { content: [{ type: 'text', text: 'private-body' }] };
      });
      process.stdout.write('protocol-channel');
    `], { encoding: "utf8", env: { ...process.env, WP_API_DIAGNOSTICS: enabled } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "protocol-channel");
    if (enabled === "0") assert.equal(child.stderr, "");
    else {
      assert.equal(JSON.parse(child.stderr).requests, 1);
      assert.doesNotMatch(child.stderr, /private-body/);
    }
  }
});

/** 完整任务链通过真实 transport 测量请求、导出、落盘补读及部分失败。 */
test("cost fixtures exercise complete tasks and account for file rereads", async () => {
  const report = await benchmarkCost();
  assert.ok(report.discovery.wireBytes > report.discovery.resultBytes);
  const find = (name) => report.scenarios.find((scenario) => scenario.name === name);
  assert.equal(find("csv-export").totals.requests, 4);
  assert.equal(find("csv-export").calls[0].exportedRows, 205);
  assert.equal(find("large-menu").totals.requests, 4);
  assert.equal(find("batch-partial-failure").totals.requests, 2);
  assert.equal(find("batch-partial-failure").calls[0].failedItems, 6);
  assert.ok(find("batch-partial-failure").totals.responseBytes < 2048);
  assert.equal(find("long-post").totals.storedResults, 1);
  assert.ok(find("long-post").totals.rereadBytes > 8192);
  assert.equal(find("find-and-edit").totals.requests, 3);
  assert.equal(find("catalog-and-meta").totals.requests, 3);
  assert.equal(find("locate-and-edit-menu").totals.requests, 9);
  assert.equal(find("long-link-update").totals.requests, 2);
  assert.equal(find("long-link-update").totals.storedResults, 0);
  assert.ok(find("long-link-update").totals.wireBytes < 2048);
  assert.ok(find("long-link-update").totals.responseBytes < 50000);
  assert.ok(find("100-resources").totals.responseBytes > 10000);
});
