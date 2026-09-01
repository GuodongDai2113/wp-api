import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readBoundedJsonFile, writeJsonFileAtomically } from "../build/shared/files/json.js";

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

test("writeJsonFileAtomically 排他发布并支持显式原子替换", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wp-api-json-write-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = path.join(directory, "nested", "data.json");
  const first = await writeJsonFileAtomically({ outputFile, value: { value: 1 }, label: "Fixture" });
  assert.equal(first.filePath, outputFile);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(await readFile(outputFile, "utf8")), { value: 1 });
  await assert.rejects(
    () => writeJsonFileAtomically({ outputFile, value: { value: 2 }, label: "Fixture" }),
    /already exists/
  );
  await writeJsonFileAtomically({ outputFile, value: { value: 2 }, overwrite: true, label: "Fixture" });
  assert.deepEqual(JSON.parse(await readFile(outputFile, "utf8")), { value: 2 });
  await assert.rejects(
    () => writeJsonFileAtomically({
      outputFile,
      value: { value: 3 },
      overwrite: true,
      expectedExistingSha256: first.sha256,
      label: "Fixture"
    }),
    /changed before atomic replacement/
  );
  assert.deepEqual(JSON.parse(await readFile(outputFile, "utf8")), { value: 2 });
});
