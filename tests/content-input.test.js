import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { resolveContentInput } from "../src/lib/content-input.js";

test("resolveContentInput prefers explicit --content over file or stdin", async () => {
  const value = await resolveContentInput({
    content: "inline",
    contentFile: "ignored.txt",
    stdinText: "stdin value"
  });

  assert.equal(value, "inline");
});

test("resolveContentInput reads content from file and trims nothing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-content-"));
  const contentPath = path.join(tempDir, "body.md");
  await writeFile(contentPath, "Line 1\nLine 2\n", "utf8");

  const value = await resolveContentInput({ contentFile: contentPath });

  assert.equal(value, "Line 1\nLine 2\n");

  await rm(tempDir, { recursive: true, force: true });
});

test("resolveContentInput falls back to stdin text", async () => {
  const value = await resolveContentInput({ stdinText: "from stdin" });
  assert.equal(value, "from stdin");
});
