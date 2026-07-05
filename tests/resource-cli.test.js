import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { runCli } from "../src/cli.js";

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

test("posts list passes filters and returns JSON payload", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["posts", "list", "--search", "hello", "--page", "2", "--per-page", "5", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify([{ id: 3, slug: "hello" }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-wp-total": "1",
            "x-wp-totalpages": "1"
          }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(
    calls[0].url,
    "https://example.com/wp-json/wp/v2/posts?search=hello&page=2&per_page=5"
  );
  assert.deepEqual(JSON.parse(result.stdout), {
    items: [{ id: 3, slug: "hello" }],
    pagination: { total: 1, totalPages: 1 }
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("global --client works when placed before the resource command", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["--client", "prod", "posts", "list", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([{ id: 7, slug: "welcome" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-wp-total": "1",
          "x-wp-totalpages": "1"
        }
      });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/posts");

  await rm(tempDir, { recursive: true, force: true });
});

test("products create uses the fixed products endpoint and content from stdin", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["products", "create", "--title", "Widget", "--status", "draft", "--json"],
    {
      configDir: tempDir,
      stdinText: "Long description",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 9, title: { rendered: "Widget" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/products");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    title: "Widget",
    status: "draft",
    content: "Long description"
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    id: 9,
    title: { rendered: "Widget" }
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("categories update sends taxonomy fields only", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["categories", "update", "15", "--name", "News", "--slug", "news", "--description", "Site news"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 15, name: "News" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/categories/15");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    name: "News",
    slug: "news",
    description: "Site news"
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("categories delete forces permanent deletion by default", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["categories", "delete", "15", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ deleted: true, previous: { id: 15 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/categories/15?force=true");
  assert.equal(calls[0].init.method, "DELETE");

  await rm(tempDir, { recursive: true, force: true });
});

test("posts delete uses soft delete by default and surfaces wp errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["posts", "delete", "42"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          code: "rest_cannot_delete",
          message: "Cannot delete item.",
          data: { status: 401 }
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/posts/42");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /HTTP 401/);
  assert.match(result.stderr, /rest_cannot_delete/);

  await rm(tempDir, { recursive: true, force: true });
});
