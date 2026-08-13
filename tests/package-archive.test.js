import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";

import { createPackageArchive } from "../build/lib/package-archive.js";

test("createPackageArchive enforces source size and entry count limits", async (t) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "wp-api-archive-limits-"));
  t.after(() => rm(tempDirectory, { recursive: true, force: true }));
  const pluginDirectory = path.join(tempDirectory, "sample-plugin");
  await mkdir(pluginDirectory);
  await writeFile(path.join(pluginDirectory, "plugin.php"), "12345");

  await assert.rejects(
    () => createPackageArchive("plugin", pluginDirectory, undefined, { maxSourceBytes: 4 }),
    /maximum allowed size of 4 bytes/
  );
  await writeFile(path.join(pluginDirectory, "readme.txt"), "readme");
  await assert.rejects(
    () => createPackageArchive("plugin", pluginDirectory, undefined, { maxEntries: 1 }),
    /maximum allowed entry count of 1/
  );
});

test("createPackageArchive rejects symbolic links in package sources", async (t) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "wp-api-archive-link-"));
  t.after(() => rm(tempDirectory, { recursive: true, force: true }));
  const pluginDirectory = path.join(tempDirectory, "sample-plugin");
  const outsideFile = path.join(tempDirectory, "outside.txt");
  await mkdir(pluginDirectory);
  await writeFile(outsideFile, "secret");

  try {
    await symlink(outsideFile, path.join(pluginDirectory, "linked.txt"), "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip(`The current platform cannot create test symlinks: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => createPackageArchive("plugin", pluginDirectory),
    /must not contain symbolic links/
  );
});
