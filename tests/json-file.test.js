import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readBoundedJsonFile } from "../build/shared/files/json.js";

test("readBoundedJsonFile 分块读取有效 JSON 并执行文件大小限制", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wp-api-json-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const validFile = path.join(directory, "valid.json");
  const invalidFile = path.join(directory, "invalid.json");
  const oversizedFile = path.join(directory, "oversized.json");
  await writeFile(validFile, JSON.stringify({ title: "Example" }), "utf8");
  await writeFile(invalidFile, "{broken", "utf8");
  await writeFile(oversizedFile, JSON.stringify({ value: "x".repeat(100) }), "utf8");

  assert.deepEqual(await readBoundedJsonFile(validFile), { title: "Example" });
  await assert.rejects(
    () => readBoundedJsonFile(invalidFile, { label: "Fixture" }),
    /Fixture does not contain valid JSON/
  );
  await assert.rejects(
    () => readBoundedJsonFile(oversizedFile, { maxBytes: 20, label: "Fixture" }),
    /Fixture exceeds the maximum allowed size of 20 bytes/
  );
});
