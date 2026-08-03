import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { WordPressClient, WordPressApiError } from "../build/lib/wp-client.js";

test("WordPressClient sends Application Password auth and preserves pagination headers", async () => {
  const calls = [];
  const client = new WordPressClient({
    baseUrl: "https://example.com/",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([{ id: 10, title: { rendered: "Hello" } }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-wp-total": "25",
          "x-wp-totalpages": "3"
        }
      });
    }
  });

  const result = await client.list("posts", { search: "hello", page: 2, per_page: 10 });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://example.com/wp-json/wp/v2/posts?search=hello&page=2&per_page=10"
  );
  assert.equal(calls[0].init.headers.Authorization, "Basic YWRtaW46c2VjcmV0");
  assert.deepEqual(result.pagination, { total: 25, totalPages: 3 });
  assert.equal(result.items[0].id, 10);
});

test("WordPressClient surfaces WordPress API errors with status and code", async () => {
  const client = new WordPressClient({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          code: "rest_forbidden",
          message: "Sorry, you are not allowed to do that.",
          data: { status: 401 }
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" }
        }
      )
  });

  await assert.rejects(
    () => client.get("posts", 1),
    (error) => {
      assert.ok(error instanceof WordPressApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "rest_forbidden");
      assert.match(error.message, /Sorry, you are not allowed/);
      return true;
    }
  );
});

test("WordPressClient surfaces fetch errors with request context and cause details", async () => {
  const fetchError = new TypeError("fetch failed", {
    cause: Object.assign(new Error("self-signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT"
    })
  });

  const client = new WordPressClient({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async () => {
      throw fetchError;
    }
  });

  await assert.rejects(
    () => client.get("posts", 42),
    (error) => {
      assert.equal(error.name, "WordPressNetworkError");
      assert.match(error.message, /GET https:\/\/example\.com\/wp-json\/wp\/v2\/posts\/42/);
      assert.match(error.message, /fetch failed/);
      assert.match(error.message, /DEPTH_ZERO_SELF_SIGNED_CERT/);
      assert.match(error.message, /self-signed certificate/);
      return true;
    }
  );
});

test("WordPressClient list fetches all pages when per_page is -1", async () => {
  const calls = [];
  const client = new WordPressClient({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async (url) => {
      calls.push(url);

      if (url === "https://example.com/wp-json/wp/v2/posts?per_page=100&page=1") {
        return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-wp-total": "3",
            "x-wp-totalpages": "2"
          }
        });
      }

      if (url === "https://example.com/wp-json/wp/v2/posts?per_page=100&page=2") {
        return new Response(JSON.stringify([{ id: 3 }]), {
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

  const result = await client.list("posts", { per_page: -1 });

  assert.deepEqual(calls, [
    "https://example.com/wp-json/wp/v2/posts?per_page=100&page=1",
    "https://example.com/wp-json/wp/v2/posts?per_page=100&page=2"
  ]);
  assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.deepEqual(result.pagination, { total: 3, totalPages: 2 });
});

test("WordPressClient uploads a local image file to the media endpoint", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-media-"));
  const filePath = path.join(tempDir, "hero image.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const calls = [];
  await writeFile(filePath, bytes);

  const client = new WordPressClient({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 33, source_url: "https://example.com/hero-image.png" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await client.uploadMediaFromFile(filePath);

  assert.equal(result.id, 33);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/wp-json/wp/v2/media");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Basic YWRtaW46c2VjcmV0");
  assert.equal(calls[0].init.headers.Accept, "application/json");
  assert.equal(calls[0].init.headers["Content-Type"], "image/png");
  assert.equal(calls[0].init.headers["Content-Disposition"], 'attachment; filename="hero image.png"');
  assert.deepEqual(Buffer.from(calls[0].init.body), bytes);

  await rm(tempDir, { recursive: true, force: true });
});

test("WordPressClient updates media metadata after uploading when provided", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-media-"));
  const filePath = path.join(tempDir, "photo.jpg");
  const calls = [];
  await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff]));

  const client = new WordPressClient({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ id: 44, source_url: "https://example.com/photo.jpg" }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ id: 44, title: { rendered: "Hero" }, alt_text: "Alt" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await client.uploadMediaFromFile(filePath, {
    title: "Hero",
    altText: "Alt",
    caption: "Caption",
    description: "Description"
  });

  assert.equal(result.id, 44);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://example.com/wp-json/wp/v2/media/44");
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    title: "Hero",
    alt_text: "Alt",
    caption: "Caption",
    description: "Description"
  });

  await rm(tempDir, { recursive: true, force: true });
});

test("WordPressClient accepts a successful empty JSON response", async () => {
  const client = new WordPressClient({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async () => new Response("", {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });

  const result = await client.requestApiPath("elementor/v1/cache", { method: "DELETE" });

  assert.equal(result.data, null);
});

test("WordPressClient pushes a local theme zip directly to jelly-core", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-theme-"));
  const filePath = path.join(tempDir, "jelly-theme.zip");
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const calls = [];
  await writeFile(filePath, bytes);

  const client = new WordPressClient({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        success: true,
        action: "installed",
        theme_name: "Jelly Theme",
        theme_slug: "jelly-theme",
        theme_version: "1.0.0",
        is_active: false
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await client.uploadThemeFromFile(filePath);

  assert.equal(result.theme_slug, "jelly-theme");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/wp-json/jelly-core/v1/themes/install");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/zip");
  assert.equal(calls[0].init.headers["X-Jelly-Theme-Slug"], "jelly-theme");
  assert.match(calls[0].init.headers["X-Jelly-Timestamp"], /^\d+$/);
  assert.ok(calls[0].init.headers["X-Jelly-Signature"]);
  assert.deepEqual(Buffer.from(calls[0].init.body), bytes);

  await rm(tempDir, { recursive: true, force: true });
});

test("WordPressClient activates a theme through jelly-core", async () => {
  const calls = [];
  const client = new WordPressClient({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        success: true,
        action: "activated",
        theme_slug: "jelly-theme",
        is_active: true
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await client.updateThemeStatus("jelly-theme", "active");

  assert.equal(result.is_active, true);
  assert.equal(calls[0].url, "https://example.com/wp-json/jelly-core/v1/themes/jelly-theme/status");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { status: "active" });
  assert.match(calls[0].init.headers["X-Jelly-Timestamp"], /^\d+$/);
  assert.ok(calls[0].init.headers["X-Jelly-Signature"]);
});

test("WordPressClient deactivates a theme by sending a replacement theme", async () => {
  const calls = [];
  const client = new WordPressClient({
    baseUrl: "https://example.com",
    username: "admin",
    appPassword: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        success: true,
        action: "deactivated",
        theme_slug: "jelly-theme",
        active_theme_slug: "twentytwentyfive",
        is_active: false
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await client.updateThemeStatus("jelly-theme", "inactive", "twentytwentyfive");

  assert.equal(result.is_active, false);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    status: "inactive",
    replacement_theme: "twentytwentyfive"
  });
});

