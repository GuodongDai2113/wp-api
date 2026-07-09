import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { runCli } from "../build/cli.js";

async function createClient(configDir) {
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
    { configDir }
  );
  await runCli(["client", "use", "prod"], { configDir });
}

function elementorEntity(id, data, extraMeta = {}) {
  return {
    id,
    title: { rendered: "Landing" },
    meta: {
      _elementor_data: JSON.stringify(data),
      _elementor_edit_mode: "builder",
      ...extraMeta
    }
  };
}

test("elementor export reads Elementor data from pages without a resource flag", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-elementor-cli-"));
  const tree = [{ id: "aaaaaaa", elType: "container", settings: {}, elements: [] }];
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["elementor", "export", "12", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(elementorEntity(12, tree)), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/pages/12?context=edit");
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(JSON.parse(result.stdout), {
    post_id: 12,
    resource: "pages",
    json: tree
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("elementor commands reject the resource flag", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-elementor-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["elementor", "export", "42", "--resource", "pages", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(elementorEntity(42, [])), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Elementor commands do not accept --resource/);
  assert.equal(calls.length, 0);

  await rm(tempDir, { recursive: true, force: true });
});

test("elementor init enables Elementor meta on an existing page", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-elementor-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["elementor", "init", "12", "--page-settings-json", "{\"hide_title\":\"yes\"}", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(elementorEntity(12, [], { _elementor_page_settings: { hide_title: "yes" } })), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/pages/12");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    meta: {
      _elementor_data: "[]",
      _elementor_edit_mode: "builder",
      _elementor_template_type: "wp-page",
      _elementor_page_settings: {
        hide_title: "yes"
      }
    }
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    post_id: 12,
    resource: "pages",
    initialized: true
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("elementor get-element reads settings for an existing element", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-elementor-cli-"));
  const tree = [{ id: "aaaaaaa", elType: "widget", widgetType: "heading", settings: { title: "Hero" }, elements: [] }];
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["elementor", "get-element", "12", "--element-id", "aaaaaaa", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(elementorEntity(12, tree)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/pages/12?context=edit");
  assert.deepEqual(JSON.parse(result.stdout), {
    post_id: 12,
    resource: "pages",
    element_id: "aaaaaaa",
    elType: "widget",
    widgetType: "heading",
    settings: { title: "Hero" }
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("elementor find searches existing Elementor settings without mutating the page", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-elementor-cli-"));
  const tree = [{ id: "aaaaaaa", elType: "widget", widgetType: "heading", settings: { title: "Hero" }, elements: [] }];
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["elementor", "find", "12", "--search-text", "Hero", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(elementorEntity(12, tree)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(JSON.parse(result.stdout), {
    post_id: 12,
    resource: "pages",
    matches: [
      {
        element_id: "aaaaaaa",
        elType: "widget",
        widgetType: "heading",
        settings_preview: { title: "Hero" }
      }
    ],
    count: 1
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("elementor structure reads a lightweight existing tree", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-elementor-cli-"));
  const tree = [{ id: "aaaaaaa", elType: "widget", widgetType: "heading", settings: { title: "Hero" }, elements: [] }];
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["elementor", "structure", "12", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(elementorEntity(12, tree)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    post_id: 12,
    resource: "pages",
    structure: [
      {
        id: "aaaaaaa",
        elType: "widget",
        widgetType: "heading",
        settings_summary: {
          title: "Hero"
        }
      }
    ]
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("elementor import replaces the full Elementor tree only through raw data", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-elementor-cli-"));
  const tree = [{ id: "aaaaaaa", elType: "widget", widgetType: "heading", settings: { title: "Hero" }, elements: [] }];
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    [
      "elementor",
      "import",
      "12",
      "--data-json",
      JSON.stringify(tree),
      "--json"
    ],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(elementorEntity(12, tree)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  const savedTree = JSON.parse(JSON.parse(calls[0].init.body).meta._elementor_data);
  assert.deepEqual(savedTree, tree);
  assert.deepEqual(JSON.parse(result.stdout), {
    post_id: 12,
    resource: "pages",
    imported: true,
    elements_count: 1
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("elementor construction commands are not available in wp-api", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-elementor-cli-"));
  const calls = [];
  await createClient(tempDir);

  for (const subcommand of ["add-container", "add-widget", "update-element", "batch-update", "reorder", "move", "remove", "duplicate"]) {
    const result = await runCli(["elementor", subcommand, "12", "--json"], {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(elementorEntity(12, [])), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, new RegExp(`Unknown elementor subcommand: ${subcommand}`));
  }
  assert.equal(calls.length, 0);

  await rm(tempDir, { recursive: true, force: true });
});
