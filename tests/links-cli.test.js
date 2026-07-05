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

async function withClient(callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-links-cli-"));

  try {
    await createClient(tempDir);
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function withTempConfig(callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-links-cli-"));

  try {
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("links add requires a post id", async () => {
  await withClient(async (configDir) => {
    const result = await runCli(["links", "add", "--text", "Beta", "--href", "https://example.com/beta"], {
      configDir
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "Post id is required.\n");
  });
});

test("links add rejects a nonnumeric post id before resolving a client", async () => {
  await withTempConfig(async (configDir) => {
    const calls = [];

    const result = await runCli(["links", "add", "abc", "--text", "Beta", "--href", "https://example.com/beta"], {
      configDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 42, content: { raw: "Alpha Beta" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "Post id must be a positive integer.\n");
    assert.equal(calls.length, 0);
  });
});

test("links add rejects a non-positive post id before resolving a client", async () => {
  await withTempConfig(async (configDir) => {
    const calls = [];

    const result = await runCli(["links", "add", "0", "--text", "Beta", "--href", "https://example.com/beta"], {
      configDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 42, content: { raw: "Alpha Beta" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "Post id must be a positive integer.\n");
    assert.equal(calls.length, 0);
  });
});

test("links add requires text and href", async () => {
  await withClient(async (configDir) => {
    const missingText = await runCli(["links", "add", "42", "--href", "https://example.com/beta"], {
      configDir
    });
    const missingHref = await runCli(["links", "add", "42", "--text", "Beta"], {
      configDir
    });

    assert.equal(missingText.exitCode, 1);
    assert.equal(missingText.stderr, "Missing required flags: --text, --href\n");
    assert.equal(missingHref.exitCode, 1);
    assert.equal(missingHref.stderr, "Missing required flags: --text, --href\n");
  });
});

test("links add rejects a value-less text flag", async () => {
  await withClient(async (configDir) => {
    const calls = [];

    const result = await runCli(["links", "add", "42", "--text", "--href", "https://example.com/beta"], {
      configDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 42, content: { raw: "Alpha Beta" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "Missing required flags: --text, --href\n");
    assert.equal(calls.length, 0);
  });
});

test("links add rejects a value-less href flag", async () => {
  await withClient(async (configDir) => {
    const calls = [];

    const result = await runCli(["links", "add", "42", "--text", "Beta", "--href"], {
      configDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 42, content: { raw: "Alpha Beta" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "Missing required flags: --text, --href\n");
    assert.equal(calls.length, 0);
  });
});

test("links command requires the add subcommand", async () => {
  await withClient(async (configDir) => {
    const missing = await runCli(["links"], { configDir });
    const unknown = await runCli(["links", "remove", "42"], { configDir });

    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr, "Unknown links subcommand: (missing)\n");
    assert.equal(unknown.exitCode, 1);
    assert.equal(unknown.stderr, "Unknown links subcommand: remove\n");
  });
});

test("links add fetches a post then updates raw content", async () => {
  await withClient(async (configDir) => {
    const calls = [];

    const result = await runCli(
      ["links", "add", "42", "--text", "Beta", "--href", "https://example.com/beta", "--json"],
      {
        configDir,
        fetchImpl: async (url, init) => {
          calls.push({ url, init });

          if (calls.length === 1) {
            return new Response(
              JSON.stringify({
                id: 42,
                content: {
                  raw: "Alpha Beta",
                  rendered: "<p>Rendered Beta</p>"
                }
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" }
              }
            );
          }

          if (calls.length === 2) {
            return new Response(
              JSON.stringify({
                id: 42,
                content: {
                  raw: 'Alpha <a href="https://example.com/beta">Beta</a>'
                }
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" }
              }
            );
          }

          throw new Error(`Unexpected request #${calls.length}: ${url}`);
        }
      }
    );

    assert.equal(result.exitCode, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/posts/42");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[1].url, "https://example.com/wp-json/wp/v2/posts/42");
    assert.equal(calls[1].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      content: 'Alpha <a href="https://example.com/beta">Beta</a>'
    });
    assert.deepEqual(JSON.parse(result.stdout), {
      id: 42,
      resource: "posts",
      action: "links.add",
      updated: true,
      status: "updated",
      text: "Beta",
      href: "https://example.com/beta",
      replacements: 1
    });
  });
});

test("links add uses rendered content when raw content is unavailable", async () => {
  await withClient(async (configDir) => {
    const calls = [];

    const result = await runCli(["links", "add", "42", "--text", "Beta", "--href", "https://example.com/beta"], {
      configDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });

        if (calls.length === 1) {
          return new Response(
            JSON.stringify({
              id: 42,
              content: {
                rendered: "<p>Alpha Beta</p>"
              }
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          );
        }

        return new Response(JSON.stringify({ id: 42 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    assert.equal(result.exitCode, 0);
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      content: '<p>Alpha <a href="https://example.com/beta">Beta</a></p>'
    });
    assert.equal(result.stdout, "Link added to post 42: Beta -> https://example.com/beta\n");
  });
});

test("links add does not update when text is not found", async () => {
  await withClient(async (configDir) => {
    const calls = [];

    const result = await runCli(
      ["links", "add", "42", "--text", "Gamma", "--href", "https://example.com/gamma", "--json"],
      {
        configDir,
        fetchImpl: async (url, init) => {
          calls.push({ url, init });
          return new Response(JSON.stringify({ id: 42, content: { raw: "Alpha Beta" } }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
      }
    );

    assert.equal(result.exitCode, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      id: 42,
      resource: "posts",
      action: "links.add",
      updated: false,
      status: "not_found",
      text: "Gamma",
      href: "https://example.com/gamma",
      replacements: 0
    });
    assert.equal(result.data.status, "not_found");
  });
});

test("links add reports no matching text in text output", async () => {
  await withClient(async (configDir) => {
    const result = await runCli(["links", "add", "42", "--text", "Gamma", "--href", "https://example.com/gamma"], {
      configDir,
      fetchImpl: async () =>
        new Response(JSON.stringify({ id: 42, content: { raw: "Alpha Beta" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "No matching text found in post 42: Gamma\n");
  });
});

test("links add does not update when first match is already inside a link", async () => {
  await withClient(async (configDir) => {
    const calls = [];

    const result = await runCli(["links", "add", "42", "--text", "Beta", "--href", "https://example.com/beta"], {
      configDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 42, content: { raw: '<a href="/old">Beta</a> Beta' } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    assert.equal(result.exitCode, 0);
    assert.equal(calls.length, 1);
    assert.equal(result.stdout, "Matching text is already inside a link in post 42: Beta\n");
    assert.equal(result.data.status, "skipped_existing_link");
    assert.equal(result.data.updated, false);
  });
});
