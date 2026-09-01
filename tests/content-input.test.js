import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { resolveContentInput } from "../build/wordpress/content/input.js";

test("resolveContentInput 优先使用 MCP 内联正文", async () => {
  const value = await resolveContentInput({
    content: "inline",
    contentFile: "ignored.txt"
  });

  assert.equal(value, "inline");
});

test("resolveContentInput 从文件读取正文且不修改空白", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-content-"));
  const contentPath = path.join(tempDir, "body.md");
  await writeFile(contentPath, "Line 1\nLine 2\n", "utf8");

  const value = await resolveContentInput({ contentFile: contentPath });

  assert.equal(value, "Line 1\nLine 2\n");

  await rm(tempDir, { recursive: true, force: true });
});

test("resolveContentInput 限制内联正文和文件正文大小", async () => {
  await assert.rejects(
    () => resolveContentInput({ content: "12345", maxBytes: 4 }),
    /Inline content exceeds the maximum allowed size of 4 bytes/
  );
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-content-limit-"));
  const contentPath = path.join(tempDir, "body.md");
  await writeFile(contentPath, "12345", "utf8");
  await assert.rejects(
    () => resolveContentInput({ contentFile: contentPath, maxBytes: 4 }),
    /Content file exceeds the maximum allowed size of 4 bytes/
  );
  await rm(tempDir, { recursive: true, force: true });
});

