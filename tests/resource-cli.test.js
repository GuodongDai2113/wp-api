import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

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

test("posts list with --per-page -1 returns items aggregated from all pages", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["posts", "list", "--per-page", "-1", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url) => {
      calls.push(url);

      if (url === "https://example.com/wp-json/wp/v2/posts?per_page=100&page=1") {
        return new Response(JSON.stringify([{ id: 1, slug: "a" }, { id: 2, slug: "b" }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-wp-total": "3",
            "x-wp-totalpages": "2"
          }
        });
      }

      if (url === "https://example.com/wp-json/wp/v2/posts?per_page=100&page=2") {
        return new Response(JSON.stringify([{ id: 3, slug: "c" }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-wp-total": "3",
            "x-wp-totalpages": "2"
          }
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [
    "https://example.com/wp-json/wp/v2/posts?per_page=100&page=1",
    "https://example.com/wp-json/wp/v2/posts?per_page=100&page=2"
  ]);
  assert.deepEqual(JSON.parse(result.stdout), {
    items: [{ id: 1, slug: "a" }, { id: 2, slug: "b" }, { id: 3, slug: "c" }],
    pagination: { total: 3, totalPages: 2 }
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("posts list text output includes pagination summary details", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  await createClient(tempDir);

  const result = await runCli(["posts", "list", "--page", "2"], {
    configDir: tempDir,
    fetchImpl: async () =>
      new Response(JSON.stringify([{ id: 3, slug: "hello" }, { id: 4, slug: "world" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-wp-total": "11",
          "x-wp-totalpages": "6"
        }
      })
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /posts:/);
  assert.match(result.stdout, /3\thello/);
  assert.match(result.stdout, /4\tworld/);
  assert.match(result.stdout, /Total 11, 6 pages, fetched 2 items, current page 2/);

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

test("pages list uses the native pages endpoint", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["pages", "list", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([{ id: 12, slug: "about-us" }]), {
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
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/pages");
  assert.deepEqual(JSON.parse(result.stdout), {
    items: [{ id: 12, slug: "about-us" }],
    pagination: { total: 1, totalPages: 1 }
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("pages create uses content fields and the native pages endpoint", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["pages", "create", "--title", "About Us", "--status", "draft", "--content", "Page body", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 12, title: { rendered: "About Us" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/pages");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    title: "About Us",
    status: "draft",
    content: "Page body"
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    id: 12,
    title: { rendered: "About Us" }
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("posts create converts inline content to Gutenberg when --gutenberg is set", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["posts", "create", "--title", "Converted", "--content", "<h2>Hello</h2><p>Body</p>", "--gutenberg", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 42, title: { rendered: "Converted" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  const body = JSON.parse(calls[0].init.body);
  assert.match(body.content, /<!-- wp:heading \{"level":2\} -->/);
  assert.match(body.content, /<h2 class="wp-block-heading">Hello<\/h2>/);
  assert.match(body.content, /<!-- wp:paragraph -->\n<p>Body<\/p>\n<!-- \/wp:paragraph -->/);

  await rm(tempDir, { recursive: true, force: true });
});

test("posts create converts content file to Gutenberg when --gutenberg is set", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const contentPath = path.join(tempDir, "article.html");
  const calls = [];
  await createClient(tempDir);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(contentPath, "<p>From file</p>", "utf8"));

  const result = await runCli(
    ["posts", "create", "--title", "File", "--content-file", contentPath, "--gutenberg", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 43, title: { rendered: "File" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(calls[0].init.body).content, "<!-- wp:paragraph -->\n<p>From file</p>\n<!-- /wp:paragraph -->");

  await rm(tempDir, { recursive: true, force: true });
});

test("posts create leaves HTML content unchanged when --gutenberg is absent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["posts", "create", "--title", "Raw", "--content", "<p>Raw body</p>", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 44, title: { rendered: "Raw" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(calls[0].init.body).content, "<p>Raw body</p>");

  await rm(tempDir, { recursive: true, force: true });
});

test("pages delete uses soft delete by default", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["pages", "delete", "12", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ deleted: true, previous: { id: 12 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/pages/12");
  assert.equal(calls[0].init.method, "DELETE");

  await rm(tempDir, { recursive: true, force: true });
});

test("products list uses the native product endpoint", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["products", "list", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([{ id: 9, slug: "widget" }]), {
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
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/product");
  assert.deepEqual(JSON.parse(result.stdout), {
    items: [{ id: 9, slug: "widget" }],
    pagination: { total: 1, totalPages: 1 }
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("products create uses the native product endpoint and content from stdin", async () => {
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
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/product");
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

test("product-categories list uses the product_cat taxonomy route", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["product-categories", "list", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([{ id: 21, name: "Meters", slug: "meters" }]), {
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
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/product_cat");
  assert.deepEqual(JSON.parse(result.stdout), {
    items: [{ id: 21, name: "Meters", slug: "meters" }],
    pagination: { total: 1, totalPages: 1 }
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("product-categories create uses taxonomy fields only", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(
    ["product-categories", "create", "--name", "Meters", "--slug", "meters", "--description", "Product meters", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 22, name: "Meters", slug: "meters" }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/product_cat");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    name: "Meters",
    slug: "meters",
    description: "Product meters"
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("product-categories delete forces permanent deletion by default", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  const calls = [];
  await createClient(tempDir);

  const result = await runCli(["product-categories", "delete", "22", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ deleted: true, previous: { id: 22 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/product_cat/22?force=true");
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

test("posts get surfaces detailed fetch failure information", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  await createClient(tempDir);

  const result = await runCli(["posts", "get", "42"], {
    configDir: tempDir,
    fetchImpl: async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("self-signed certificate"), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT"
        })
      });
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /GET https:\/\/example\.com\/wp-json\/wp\/v2\/posts\/42/);
  assert.match(result.stderr, /fetch failed/);
  assert.match(result.stderr, /DEPTH_ZERO_SELF_SIGNED_CERT/);
  assert.match(result.stderr, /self-signed certificate/);

  await rm(tempDir, { recursive: true, force: true });
});

test("seo get returns rank math fields for a post resource", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  await createClient(tempDir);
  const calls = [];

  const result = await runCli(["seo", "posts", "42", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          id: 42,
          meta: {
            rank_math_title: "SEO Title",
            rank_math_description: "SEO Description",
            rank_math_focus_keyword: "focus keyword"
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/posts/42");
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(JSON.parse(result.stdout), {
    id: 42,
    resource: "posts",
    rank_math_title: "SEO Title",
    rank_math_description: "SEO Description",
    rank_math_focus_keyword: "focus keyword"
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("seo get returns rank math fields for a page resource", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  await createClient(tempDir);
  const calls = [];

  const result = await runCli(["seo", "pages", "12", "--json"], {
    configDir: tempDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          id: 12,
          meta: {
            rank_math_title: "About SEO",
            rank_math_description: "About page SEO",
            rank_math_focus_keyword: "about us"
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/pages/12");
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(JSON.parse(result.stdout), {
    id: 12,
    resource: "pages",
    rank_math_title: "About SEO",
    rank_math_description: "About page SEO",
    rank_math_focus_keyword: "about us"
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("seo update writes only provided rank math fields through the WordPress post endpoint for post resources", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  await createClient(tempDir);
  const calls = [];

  const result = await runCli(
    ["seo", "posts", "42", "--title", "New SEO Title", "--focus-keyword", "new keyword", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (calls.length === 1) {
          return new Response(
            JSON.stringify({
              id: 42,
              meta: {
                rank_math_title: "New SEO Title",
                rank_math_description: "Old Description",
                rank_math_focus_keyword: "new keyword"
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
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/posts/42");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    meta: {
      rank_math_title: "New SEO Title",
      rank_math_focus_keyword: "new keyword"
    }
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    id: 42,
    resource: "posts",
    rank_math_title: "New SEO Title",
    rank_math_description: "Old Description",
    rank_math_focus_keyword: "new keyword"
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("seo update writes through the WordPress page endpoint and returns page rank math fields", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  await createClient(tempDir);
  const calls = [];

  const result = await runCli(
    ["seo", "pages", "12", "--title", "About SEO Title", "--description", "About SEO Description", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({
            id: 12,
            meta: {
              rank_math_title: "About SEO Title",
              rank_math_description: "About SEO Description",
              rank_math_focus_keyword: ""
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/pages/12");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    meta: {
      rank_math_title: "About SEO Title",
      rank_math_description: "About SEO Description"
    }
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    id: 12,
    resource: "pages",
    rank_math_title: "About SEO Title",
    rank_math_description: "About SEO Description",
    rank_math_focus_keyword: ""
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("seo update writes rank math fields through the WordPress taxonomy endpoint for taxonomy resources", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-"));
  await createClient(tempDir);
  const calls = [];

  const result = await runCli(
    ["seo", "product-categories", "15", "--description", "Taxonomy SEO Description"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({
            id: 15,
            meta: {
              rank_math_title: "",
              rank_math_description: "Taxonomy SEO Description",
              rank_math_focus_keyword: ""
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/product_cat/15");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    meta: {
      rank_math_description: "Taxonomy SEO Description"
    }
  });
  assert.match(result.stdout, /SEO updated for product-categories 15/);
  assert.match(result.stdout, /Description: Taxonomy SEO Description/);

  await rm(tempDir, { recursive: true, force: true });
});

test("media upload sends a local file and returns JSON payload", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-cli-media-"));
  const filePath = path.join(tempDir, "hero.png");
  const calls = [];
  await createClient(tempDir);
  await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const result = await runCli(
    ["media", "upload", "--file", filePath, "--title", "Hero", "--alt", "Hero alt", "--json"],
    {
      configDir: tempDir,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (calls.length === 1) {
          return new Response(JSON.stringify({ id: 55, source_url: "https://example.com/hero.png" }), {
            status: 201,
            headers: { "content-type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ id: 55, source_url: "https://example.com/hero.png", alt_text: "Hero alt" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/media");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "image/png");
  assert.equal(calls[1].url, "https://example.com/wp-json/wp/v2/media/55");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    title: "Hero",
    alt_text: "Hero alt"
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    id: 55,
    source_url: "https://example.com/hero.png",
    alt_text: "Hero alt"
  });

  await rm(tempDir, { recursive: true, force: true });
});

