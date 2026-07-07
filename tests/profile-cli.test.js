import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { runCli } from "../build/cli.js";

test("client add stores a client and client list returns it", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));

  const addResult = await runCli(
    [
      "client",
      "add",
      "prod",
      "--site-url",
      "https://example.com",
      "--username",
      "admin",
      "--app-password",
      "app-pass-1"
    ],
    { configDir: tempDir }
  );

  const listResult = await runCli(["client", "list", "--json"], {
    configDir: tempDir
  });

  assert.equal(addResult.exitCode, 0);
  assert.match(addResult.stdout, /Saved client "prod"/);
  assert.equal(listResult.exitCode, 0);
  assert.deepEqual(JSON.parse(listResult.stdout), {
    activeClient: null,
    clients: [
      {
        name: "prod",
        siteUrl: "https://example.com",
        username: "admin"
      }
    ]
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("client list text output shows only client names", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));

  await runCli(
    [
      "client",
      "add",
      "prod",
      "--site-url",
      "https://example.com",
      "--username",
      "admin",
      "--app-password",
      "app-pass-1"
    ],
    { configDir: tempDir }
  );

  const listResult = await runCli(["client", "list"], { configDir: tempDir });

  assert.equal(listResult.exitCode, 0);
  assert.match(listResult.stdout, /Active client: \(none\)/);
  assert.match(listResult.stdout, /- prod/);
  assert.doesNotMatch(listResult.stdout, /\(products\)|\(catalog\)/);

  await rm(tempDir, { recursive: true, force: true });
});

test("client use switches the active client", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));

  await runCli(
    [
      "client",
      "add",
      "prod",
      "--site-url",
      "https://example.com",
      "--username",
      "admin",
      "--app-password",
      "app-pass-1"
    ],
    { configDir: tempDir }
  );
  await runCli(
    [
      "client",
      "add",
      "staging",
      "--site-url",
      "https://staging.example.com",
      "--username",
      "editor",
      "--app-password",
      "app-pass-2"
    ],
    { configDir: tempDir }
  );

  const useResult = await runCli(["client", "use", "staging"], {
    configDir: tempDir
  });
  const listResult = await runCli(["client", "list", "--json"], {
    configDir: tempDir
  });

  assert.equal(useResult.exitCode, 0);
  assert.match(useResult.stdout, /Active client set to "staging"/);
  assert.equal(JSON.parse(listResult.stdout).activeClient, "staging");

  await rm(tempDir, { recursive: true, force: true });
});

test("client without subcommand returns the active client", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));

  await runCli(
    [
      "client",
      "add",
      "prod",
      "--site-url",
      "https://example.com",
      "--username",
      "admin",
      "--app-password",
      "app-pass-1"
    ],
    { configDir: tempDir }
  );
  await runCli(["client", "use", "prod"], { configDir: tempDir });

  const result = await runCli(["client", "--json"], { configDir: tempDir });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    name: "prod",
    siteUrl: "https://example.com",
    username: "admin"
  });

  await rm(tempDir, { recursive: true, force: true });
});

