# Gutenberg Content Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit Gutenberg conversion option that applies to all resolved content sources before WordPress resource create/update requests are sent.

**Architecture:** Keep content source resolution unchanged, then apply an optional content transform at the resource-body boundary. Migrate the old no-dependency HTML-to-Gutenberg converter into a focused TypeScript module and expose the option through both CLI and MCP layers.

**Tech Stack:** TypeScript, Node.js ESM, `node:test`, WordPress REST JSON payloads, MCP SDK with zod schemas.

---

## File Structure

- Create `src/lib/html-to-gutenberg.ts`: TypeScript converter module with complete Chinese comments on exported and helper functions/types.
- Create `tests/html-to-gutenberg.test.js`: conversion behavior tests.
- Modify `src/lib/resources.ts`: add an optional content transform callback to `buildResourceBody()`.
- Modify `src/cli.ts`: recognize `--gutenberg` as a boolean flag and pass the converter only for content resource create/update.
- Modify `src/mcp/server.ts`: add MCP `gutenberg` boolean field to create/update resource inputs.
- Modify `src/mcp/wp-api-tools.ts`: map MCP `gutenberg: true` to CLI `--gutenberg`.
- Modify `tests/resource-cli.test.js`: CLI integration tests for inline and file content conversion plus unchanged default behavior.
- Modify `tests/mcp-tools.test.js`: MCP argument mapping test.
- Modify `README.md`, `README.zh-CN.md`, and `SKILL.md`: document the new option.

## Task 1: Converter Module

**Files:**
- Create: `src/lib/html-to-gutenberg.ts`
- Test: `tests/html-to-gutenberg.test.js`

- [ ] **Step 1: Write the failing converter tests**

Create `tests/html-to-gutenberg.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { convertHtmlToGutenberg } from "../dist/lib/html-to-gutenberg.js";

test("convertHtmlToGutenberg converts common article HTML into Gutenberg blocks", () => {
  const result = convertHtmlToGutenberg("<h2>Title</h2><p>Body</p><ul><li>One</li></ul>");

  assert.match(result, /<!-- wp:heading \{"level":2\} -->/);
  assert.match(result, /<h2 class="wp-block-heading">Title<\/h2>/);
  assert.match(result, /<!-- wp:paragraph -->\n<p>Body<\/p>\n<!-- \/wp:paragraph -->/);
  assert.match(result, /<!-- wp:list -->/);
  assert.match(result, /<!-- wp:list-item --><li>One<\/li><!-- \/wp:list-item -->/);
});

test("convertHtmlToGutenberg strips full document shell and unsafe non-content blocks", () => {
  const result = convertHtmlToGutenberg(`
    <!doctype html>
    <html>
      <head><style>.x{color:red}</style><script>bad()</script></head>
      <body><p>Only body</p></body>
    </html>
  `);

  assert.equal(result, "<!-- wp:paragraph -->\n<p>Only body</p>\n<!-- /wp:paragraph -->");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/html-to-gutenberg.test.js`

Expected: FAIL because `dist/lib/html-to-gutenberg.js` does not exist.

- [ ] **Step 3: Implement the converter**

Create `src/lib/html-to-gutenberg.ts` by porting the core logic from `J:\project\article-server\html-to-gutenberg.js`:

- export `convertHtmlToGutenberg(html: string): string`.
- include focused helper functions for shell stripping, top-level node parsing, closing-tag matching, block generation, attribute handling, and regex escaping.
- do not include upload-directory helpers.
- add complete Chinese comments for every function, property, and type.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/html-to-gutenberg.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/html-to-gutenberg.ts tests/html-to-gutenberg.test.js
git commit -m "feat: add HTML to Gutenberg converter"
```

## Task 2: CLI Content Conversion

**Files:**
- Modify: `src/lib/resources.ts`
- Modify: `src/cli.ts`
- Test: `tests/resource-cli.test.js`

- [ ] **Step 1: Write failing CLI tests**

Append these tests to `tests/resource-cli.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/resource-cli.test.js`

Expected: FAIL because `--gutenberg` is not parsed as a boolean and content is not transformed.

- [ ] **Step 3: Implement CLI conversion**

Change `src/lib/resources.ts`:

- add an exported interface `BuildResourceBodyOptions` with optional `transformContent?: (content: string) => string`.
- update `buildResourceBody(kind, options, resolveContent, bodyOptions = {})`.
- after resolving content, call `bodyOptions.transformContent(content)` only when content is a string.

Change `src/cli.ts`:

- import `convertHtmlToGutenberg`.
- include `"gutenberg"` in `parseCommandLine()` boolean options.
- pass `{ transformContent: args.options.gutenberg ? convertHtmlToGutenberg : undefined }` into `buildResourceBody()` for both `create` and `update`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/resource-cli.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/resources.ts src/cli.ts tests/resource-cli.test.js
git commit -m "feat: convert content to Gutenberg on request"
```

## Task 3: MCP Gutenberg Flag

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/wp-api-tools.ts`
- Test: `tests/mcp-tools.test.js`

- [ ] **Step 1: Write failing MCP mapping test**

Append this test to `tests/mcp-tools.test.js`:

```js
test("wp_resource_create maps gutenberg flag to CLI option", async () => {
  assert.deepEqual(
    buildCliArgsForTool("wp_resource_create", {
      resource: "posts",
      title: "Hello",
      contentFile: "./article.html",
      gutenberg: true
    }),
    [
      "posts",
      "create",
      "--json",
      "--title",
      "Hello",
      "--content-file",
      "./article.html",
      "--gutenberg"
    ]
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/mcp-tools.test.js`

Expected: FAIL because `gutenberg` is not mapped.

- [ ] **Step 3: Implement MCP support**

Change `src/mcp/server.ts`:

- add `gutenberg: z.boolean().optional().describe("Convert resolved HTML content to WordPress Gutenberg block markup before upload.")` to `resourceBodyShape`.

Change `src/mcp/wp-api-tools.ts`:

- in `appendResourceBodyArgs()`, append `--gutenberg` only when `readOptionalBoolean(input, "gutenberg")` returns true.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/mcp-tools.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/mcp/server.ts src/mcp/wp-api-tools.ts tests/mcp-tools.test.js
git commit -m "feat: expose Gutenberg conversion through MCP"
```

## Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `SKILL.md`

- [ ] **Step 1: Update docs**

Document:

- `--gutenberg` is available on content resource `create` and `update`.
- It applies to `--content`, `--content-file`, and stdin.
- It is opt-in; without it, content remains unchanged.
- MCP create/update accepts `gutenberg: true`.

- [ ] **Step 2: Run documentation-adjacent verification**

Run: `rg -n "gutenberg|Gutenberg|古腾堡" README.md README.zh-CN.md SKILL.md`

Expected: output shows the option in all three files.

- [ ] **Step 3: Commit**

Run:

```bash
git add README.md README.zh-CN.md SKILL.md
git commit -m "docs: document Gutenberg conversion option"
```

## Task 5: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: build succeeds and all `node:test` suites pass.

- [ ] **Step 2: Inspect working tree**

Run: `git status --short`

Expected: no unintended uncommitted files. If generated `dist/**` files changed from the build, commit them with the corresponding source changes or in a final build commit, matching the repository's existing tracked `dist` policy.

- [ ] **Step 3: Review final diff**

Run: `git log --oneline -5` and `git diff --stat HEAD~4..HEAD`

Expected: recent commits correspond to converter, CLI, MCP, and docs changes.
