import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { ConfigStore } from "../build/lib/config-store.js";

test("ConfigStore persists clients and active client selection", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-config-"));
  const store = new ConfigStore({ configDir: tempDir });

  await store.saveClient({
    name: "prod",
    siteUrl: "https://example.com",
    username: "admin",
    appPassword: "app-pass-1"
  });

  await store.saveClient({
    name: "staging",
    siteUrl: "https://staging.example.com",
    username: "editor",
    appPassword: "app-pass-2"
  });

  await store.setActiveClient("staging");

  const clients = await store.listClients();
  const active = await store.getActiveClient();
  const raw = JSON.parse(await readFile(path.join(tempDir, "config.json"), "utf8"));

  assert.equal(clients.length, 2);
  assert.equal(active.name, "staging");
  assert.equal(raw.activeClient, "staging");
  assert.deepEqual(
    clients.map((client) => client.name),
    ["prod", "staging"]
  );

  await rm(tempDir, { recursive: true, force: true });
});

test("ConfigStore removes an active client and clears selection", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-config-"));
  const store = new ConfigStore({ configDir: tempDir });

  await store.saveClient({
    name: "prod",
    siteUrl: "https://example.com",
    username: "admin",
    appPassword: "app-pass-1"
  });
  await store.setActiveClient("prod");
  await store.removeClient("prod");

  const clients = await store.listClients();
  const active = await store.getActiveClient();

  assert.equal(clients.length, 0);
  assert.equal(active, null);

  await rm(tempDir, { recursive: true, force: true });
});

test("ConfigStore migrates legacy profile keys to client keys when re-saving", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-config-"));
  const configPath = path.join(tempDir, "config.json");
  const store = new ConfigStore({ configDir: tempDir });

  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        activeProfile: "prod",
        profiles: [
          {
            name: "prod",
            siteUrl: "https://example.com",
            username: "admin",
            appPassword: "app-pass-1",
            productType: "catalog"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const active = await store.getActiveClient();
  await store.setActiveClient("prod");
  const raw = JSON.parse(await readFile(configPath, "utf8"));

  assert.deepEqual(active, {
    name: "prod",
    siteUrl: "https://example.com",
    username: "admin"
  });
  assert.deepEqual(raw, {
    activeClient: "prod",
    clients: [
      {
        name: "prod",
        siteUrl: "https://example.com",
        username: "admin",
        appPassword: "app-pass-1"
      }
    ]
  });

  await rm(tempDir, { recursive: true, force: true });
});

