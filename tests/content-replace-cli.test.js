import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { runCli } from "../build/cli.js";

/** 创建测试用客户端配置并在回调结束后清理临时目录。 */
async function withClient(callback) {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-content-replace-"));
  try {
    await runCli([
      "client", "add", "prod", "--site-url", "https://example.com",
      "--username", "admin", "--app-password", "app-pass-1"
    ], { configDir });
    await runCli(["client", "use", "prod"], { configDir });
    await callback(configDir);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

test("content replace updates all exact matches in raw post content", async () => {
  await withClient(async (configDir) => {
    const calls = [];
    const result = await runCli(
      ["content", "replace", "42", "--text", "teh", "--replacement", "the", "--json"],
      {
        configDir,
        fetchImpl: async (url, init = {}) => {
          calls.push({ url, init });
          const body = init.body ? JSON.parse(init.body) : undefined;
          return new Response(JSON.stringify(
            body ? { id: 42, content: { raw: body.content } } : { id: 42, content: { raw: "teh word, teh typo" } }
          ), { status: 200, headers: { "content-type": "application/json" } });
        }
      }
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.data.replacements, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/posts/42?context=edit");
    assert.deepEqual(JSON.parse(calls[1].init.body), { content: "the word, the typo" });
  });
});

test("content replace does not update when no text matches", async () => {
  await withClient(async (configDir) => {
    const calls = [];
    const result = await runCli(
      ["content", "replace", "42", "--text", "teh", "--replacement", "the", "--json"],
      {
        configDir,
        fetchImpl: async (url, init = {}) => {
          calls.push({ url, init });
          return new Response(JSON.stringify({ id: 42, content: { raw: "correct text" } }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
      }
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.data.updated, false);
    assert.equal(calls.length, 1);
  });
});
