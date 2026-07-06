# Convert CLI To TypeScript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing JavaScript CLI and core library code to TypeScript while preserving current CLI and MCP behavior.

**Architecture:** Treat `src/**/*.ts` as source of truth and `dist/**/*.js` as runtime output. Existing `bin/wp-api.js` and `bin/wp-api-mcp.js` should load compiled files from `dist`, while tests should build first and import compiled modules so Node 20+ can run without a TypeScript runtime loader.

**Tech Stack:** Node.js ESM, TypeScript 5.8, Node `node:test`, existing `@modelcontextprotocol/sdk`, existing `zod`.

---

## File Structure

- Modify: `package.json` — make `npm test` build first, add a focused `test:unit` script for running compiled tests.
- Modify: `tsconfig.json` — move toward TypeScript-only source by removing `allowJs` after JS files are renamed.
- Modify: `bin/wp-api.js` — keep this as a tiny JavaScript executable that imports `dist/cli.js`.
- Modify: `bin/wp-api-mcp.js` — keep this as a tiny JavaScript executable that imports `dist/mcp/server.js`; only verify it still matches the new build flow.
- Rename: `src/lib/content-input.js` to `src/lib/content-input.ts` — add explicit input and return types.
- Rename: `src/lib/stdin.js` to `src/lib/stdin.ts` — type the readable stream contract.
- Rename: `src/lib/links.js` to `src/lib/links.ts` — type link operation results.
- Rename: `src/lib/resources.js` to `src/lib/resources.ts` — type resource names, resource configs, and request bodies.
- Rename: `src/lib/config-store.js` to `src/lib/config-store.ts` — type stored clients and config shape.
- Rename: `src/lib/wp-client.js` to `src/lib/wp-client.ts` — type WordPress request options, responses, and errors.
- Rename: `src/cli.js` to `src/cli.ts` — type CLI args, command results, payload helpers, and injected options.
- Modify: `src/mcp/wp-api-tools.ts` — keep imports stable against compiled `dist/cli.js`; no behavior change expected.
- Modify: tests under `tests/*.test.js` — import compiled `dist` modules instead of `src` modules.

## Task 1: Test Harness Uses Compiled Output

**Files:**
- Modify: `package.json`
- Modify: `tests/content-input.test.js`
- Modify: `tests/config-store.test.js`
- Modify: `tests/links.test.js`
- Modify: `tests/links-cli.test.js`
- Modify: `tests/profile-cli.test.js`
- Modify: `tests/resource-cli.test.js`
- Modify: `tests/stdin.test.js`
- Modify: `tests/wp-client.test.js`
- Modify: `tests/mcp-tools.test.js`

- [ ] **Step 1: Write the failing test-harness change**

Change every test import that points at `../src/...` to point at `../dist/...`.

Example edits:

```js
// tests/resource-cli.test.js
import { runCli } from "../dist/cli.js";
```

```js
// tests/content-input.test.js
import { resolveContentInput } from "../dist/lib/content-input.js";
```

```js
// tests/wp-client.test.js
import { WordPressClient, WordPressApiError } from "../dist/lib/wp-client.js";
```

In `tests/mcp-tools.test.js`, remove the per-test build helper and import the compiled MCP adapter directly:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { buildCliArgsForTool, executeWpApiTool } from "../dist/mcp/wp-api-tools.js";
```

Then replace every `const { buildCliArgsForTool } = await importMcpTools();` with direct use of `buildCliArgsForTool`, and replace every `const { executeWpApiTool } = await importMcpTools();` with direct use of `executeWpApiTool`.

- [ ] **Step 2: Run tests to verify the harness fails before script updates**

Run:

```powershell
npm test
```

Expected: FAIL with module resolution errors if `dist` has not been built in the current workspace, or stale-code risk if `dist` exists from a prior build. This confirms tests now depend on compiled output.

- [ ] **Step 3: Update test scripts to build before running tests**

Update `package.json` scripts:

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "test": "npm run build && node --test",
  "test:unit": "node --test"
}
```

- [ ] **Step 4: Run tests to verify compiled-output harness passes**

Run:

```powershell
npm test
```

Expected: PASS with all existing tests passing. The exact count should include the current MCP tests and existing CLI tests.

- [ ] **Step 5: Commit**

```powershell
git add package.json tests
git commit -m "test: run cli tests against compiled output"
```

## Task 2: Convert Small Utility Modules To TypeScript

**Files:**
- Rename: `src/lib/content-input.js` to `src/lib/content-input.ts`
- Rename: `src/lib/stdin.js` to `src/lib/stdin.ts`
- Test: `tests/content-input.test.js`
- Test: `tests/stdin.test.js`

- [ ] **Step 1: Write a failing type-check expectation through the source rename**

Rename the files:

```powershell
git mv src/lib/content-input.js src/lib/content-input.ts
git mv src/lib/stdin.js src/lib/stdin.ts
```

Run:

```powershell
npm run build
```

Expected: FAIL because the renamed files have implicit `any` parameters under `strict: true`.

- [ ] **Step 2: Add explicit TypeScript types and Chinese comments**

Replace `src/lib/content-input.ts` with:

```ts
import { readFile } from "node:fs/promises";

/** 解析正文输入时允许传入的三种来源。 */
export interface ContentInputOptions {
  /** 通过命令行参数直接传入的正文内容。 */
  content?: string;
  /** 保存正文内容的本地文件路径。 */
  contentFile?: string;
  /** 从标准输入读取到的正文内容。 */
  stdinText?: string;
}

/** 按照显式正文、文件正文、标准输入的优先级解析正文内容。 */
export async function resolveContentInput({
  content,
  contentFile,
  stdinText
}: ContentInputOptions = {}): Promise<string | undefined> {
  if (typeof content === "string") {
    return content;
  }

  if (contentFile) {
    return readFile(contentFile, "utf8");
  }

  if (typeof stdinText === "string" && stdinText.length > 0) {
    return stdinText;
  }

  return undefined;
}
```

Replace `src/lib/stdin.ts` with:

```ts
import type { Readable } from "node:stream";

/** 读取标准输入时需要的最小流接口。 */
export interface StdinLike extends AsyncIterable<Buffer | string> {
  /** 标记当前输入是否连接到 TTY。 */
  isTTY?: boolean;
}

/** 在存在管道输入时读取全部标准输入文本，TTY 模式下返回 undefined。 */
export async function readStdinText(stream: StdinLike): Promise<string | undefined> {
  if ((stream as Readable).isTTY) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks).toString("utf8");
}
```

- [ ] **Step 3: Run focused tests**

Run:

```powershell
npm test -- tests\content-input.test.js tests\stdin.test.js
```

Expected: PASS for content input and stdin tests.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/content-input.ts src/lib/stdin.ts tests package.json
git add -u src/lib/content-input.js src/lib/stdin.js
git commit -m "refactor: convert input utilities to typescript"
```

## Task 3: Convert Pure Resource And Link Modules To TypeScript

**Files:**
- Rename: `src/lib/links.js` to `src/lib/links.ts`
- Rename: `src/lib/resources.js` to `src/lib/resources.ts`
- Test: `tests/links.test.js`
- Test: `tests/resource-cli.test.js`

- [ ] **Step 1: Rename modules and verify type failures**

Run:

```powershell
git mv src/lib/links.js src/lib/links.ts
git mv src/lib/resources.js src/lib/resources.ts
npm run build
```

Expected: FAIL because resource and link helper parameters need explicit types.

- [ ] **Step 2: Convert `src/lib/links.ts`**

Use these public types and keep existing behavior:

```ts
/** WordPress 文章正文对象中当前会读取的字段。 */
export interface WordPressPostContentEntity {
  /** WordPress REST 返回的正文对象。 */
  content?: {
    /** 未渲染的原始正文。 */
    raw?: string;
    /** 已渲染的 HTML 正文。 */
    rendered?: string;
  };
}

/** 添加链接时需要的匹配文本和目标地址。 */
export interface AddLinkOptions {
  /** 需要被替换为链接的精确文本。 */
  text: string;
  /** 链接目标地址。 */
  href: string;
}

/** 添加链接后的结果状态。 */
export interface AddLinkResult {
  /** 是否实际修改了正文。 */
  updated: boolean;
  /** 本次链接操作的状态。 */
  status: "updated" | "not_found" | "skipped_existing_link";
  /** 实际完成的替换次数。 */
  replacements: number;
  /** 修改后或原样返回的正文内容。 */
  content: string;
}
```

Keep function names unchanged: `extractPostContent(post)` and `addLinkToContent(content, options)`.

- [ ] **Step 3: Convert `src/lib/resources.ts`**

Use these public types:

```ts
/** wp-api 支持的资源名称。 */
export type ResourceName = "posts" | "pages" | "products" | "categories" | "product-categories";

/** 资源请求体的类型分类。 */
export type ResourceKind = "content" | "taxonomy";

/** 删除资源时的默认删除模式。 */
export type DeleteMode = "trash" | "force";

/** 某类资源对应的 WordPress REST 路由和行为配置。 */
export interface ResourceConfig {
  /** WordPress REST route 中 `wp/v2/` 之后的路径。 */
  route: string;
  /** 构造请求体时使用的资源类型。 */
  kind: ResourceKind;
  /** 删除时是否默认永久删除。 */
  deleteMode: DeleteMode;
}

/** CLI 解析后的资源参数集合。 */
export type ResourceOptions = Record<string, string | boolean | undefined>;
```

Keep function names unchanged: `getResourceConfig`, `buildResourceBody`, and `buildListQuery`.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests\links.test.js tests\resource-cli.test.js
```

Expected: PASS for link helper tests and resource CLI tests.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/links.ts src/lib/resources.ts tests package.json
git add -u src/lib/links.js src/lib/resources.js
git commit -m "refactor: convert resource helpers to typescript"
```

## Task 4: Convert Config Store And WordPress Client To TypeScript

**Files:**
- Rename: `src/lib/config-store.js` to `src/lib/config-store.ts`
- Rename: `src/lib/wp-client.js` to `src/lib/wp-client.ts`
- Test: `tests/config-store.test.js`
- Test: `tests/wp-client.test.js`

- [ ] **Step 1: Rename modules and verify type failures**

Run:

```powershell
git mv src/lib/config-store.js src/lib/config-store.ts
git mv src/lib/wp-client.js src/lib/wp-client.ts
npm run build
```

Expected: FAIL because config records, request options, and error constructor parameters need explicit types.

- [ ] **Step 2: Add config store types and Chinese comments**

In `src/lib/config-store.ts`, define:

```ts
/** 保存到本地配置文件中的完整 WordPress client。 */
export interface StoredClient {
  /** client 名称。 */
  name: string;
  /** WordPress 站点地址。 */
  siteUrl: string;
  /** WordPress 用户名。 */
  username: string;
  /** WordPress Application Password。 */
  appPassword: string;
}

/** 对外展示时隐藏密码后的 client。 */
export type PublicClient = Omit<StoredClient, "appPassword">;

/** 本地 wp-api 配置文件结构。 */
export interface ConfigData {
  /** 当前激活的 client 名称。 */
  activeClient: string | null;
  /** 已保存的 client 列表。 */
  clients: StoredClient[];
}

/** 管理 wp-api 本地配置文件的读写和 client 选择。 */
export class ConfigStore {
  /** 配置目录路径。 */
  configDir: string;
  /** 配置文件完整路径。 */
  configPath: string;
}
```

Keep all existing method names and return shapes unchanged.

- [ ] **Step 3: Add WordPress client types and Chinese comments**

In `src/lib/wp-client.ts`, define:

```ts
/** WordPress REST 错误响应携带的扩展数据。 */
export type WordPressErrorData = Record<string, unknown> | null;

/** WordPress API 错误构造参数。 */
export interface WordPressApiErrorOptions {
  /** HTTP 状态码。 */
  status: number;
  /** WordPress 错误码。 */
  code?: string;
  /** WordPress 错误消息。 */
  message: string;
  /** WordPress 错误附加数据。 */
  data?: WordPressErrorData;
}

/** WordPress 请求选项。 */
export interface RequestOptions {
  /** HTTP 方法。 */
  method?: string;
  /** 查询参数。 */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** JSON 请求体。 */
  body?: unknown;
}

/** WordPress 分页信息。 */
export interface Pagination {
  /** 匹配当前查询的总条目数。 */
  total: number;
  /** 匹配当前查询的总页数。 */
  totalPages: number;
}

/** WordPress client 构造参数。 */
export interface WordPressClientOptions {
  /** WordPress 站点根地址。 */
  baseUrl: string;
  /** WordPress 用户名。 */
  username: string;
  /** WordPress Application Password。 */
  appPassword: string;
  /** 可注入的 fetch 实现。 */
  fetchImpl?: typeof fetch;
  /** 是否输出请求日志。 */
  verbose?: boolean;
  /** 日志对象。 */
  logger?: Pick<Console, "error">;
}
```

Keep `WordPressApiError`, `WordPressNetworkError`, and `WordPressClient` exports unchanged.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests\config-store.test.js tests\wp-client.test.js
```

Expected: PASS for config and WordPress client tests.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/config-store.ts src/lib/wp-client.ts tests package.json
git add -u src/lib/config-store.js src/lib/wp-client.js
git commit -m "refactor: convert client infrastructure to typescript"
```

## Task 5: Convert CLI Orchestrator To TypeScript

**Files:**
- Rename: `src/cli.js` to `src/cli.ts`
- Modify: `src/mcp/wp-api-tools.ts`
- Test: `tests/profile-cli.test.js`
- Test: `tests/resource-cli.test.js`
- Test: `tests/links-cli.test.js`
- Test: `tests/mcp-tools.test.js`

- [ ] **Step 1: Rename CLI module and verify type failures**

Run:

```powershell
git mv src/cli.js src/cli.ts
npm run build
```

Expected: FAIL because parsed CLI args, command results, payload renderers, and injected options need explicit types.

- [ ] **Step 2: Add CLI public types**

At the top of `src/cli.ts`, add:

```ts
import type { ConfigStore } from "./lib/config-store.js";
import type { AddLinkResult } from "./lib/links.js";
import type { ResourceName } from "./lib/resources.js";

/** CLI 参数解析后的选项字典。 */
export type CliOptions = Record<string, string | boolean | undefined>;

/** CLI 参数解析后的结构。 */
export interface ParsedArgs {
  /** 位置参数列表。 */
  positionals: string[];
  /** 命名选项字典。 */
  options: CliOptions;
}

/** 完整命令行解析结果。 */
export interface ParsedCommandLine {
  /** 顶层命令名称。 */
  command: string | undefined;
  /** 命令参数。 */
  args: ParsedArgs;
}

/** CLI 命令执行结果。 */
export interface CliResult<T = unknown> {
  /** 进程语义退出码。 */
  exitCode: number;
  /** 标准输出文本。 */
  stdout: string;
  /** 标准错误文本。 */
  stderr: string;
  /** 结构化返回数据。 */
  data: T;
}

/** runCli 可注入的运行时选项。 */
export interface RunCliOptions {
  /** 覆盖本地配置目录。 */
  configDir?: string;
  /** 从标准输入读取到的正文文本。 */
  stdinText?: string;
  /** 可注入的 fetch 实现。 */
  fetchImpl?: typeof fetch;
  /** 日志对象。 */
  logger?: Pick<Console, "error">;
}
```

Then type all existing function signatures without changing names. Example:

```ts
function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: CliOptions = {};
  // keep existing body
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<CliResult> {
  // keep existing body
}
```

- [ ] **Step 3: Type link and SEO payload helpers**

Add helper interfaces in `src/cli.ts`:

```ts
/** SEO 命令返回给 CLI 和 MCP 的结构化字段。 */
interface SeoPayload {
  /** 资源 ID。 */
  id: number;
  /** 资源名称。 */
  resource: string;
  /** Rank Math SEO 标题。 */
  rank_math_title: string;
  /** Rank Math SEO 描述。 */
  rank_math_description: string;
  /** Rank Math 焦点关键词。 */
  rank_math_focus_keyword: string;
}

/** links add 命令返回给 CLI 和 MCP 的结构化字段。 */
interface LinksPayload {
  /** 文章 ID。 */
  id: number;
  /** 固定资源名称。 */
  resource: "posts";
  /** 固定动作名称。 */
  action: "links.add";
  /** 是否实际更新文章。 */
  updated: boolean;
  /** 链接添加结果状态。 */
  status: AddLinkResult["status"];
  /** 被匹配的文本。 */
  text: string;
  /** 链接目标地址。 */
  href: string;
  /** 替换次数。 */
  replacements: number;
}
```

- [ ] **Step 4: Run focused CLI and MCP tests**

Run:

```powershell
npm test -- tests\profile-cli.test.js tests\resource-cli.test.js tests\links-cli.test.js tests\mcp-tools.test.js
```

Expected: PASS for CLI behavior and MCP adapter tests.

- [ ] **Step 5: Commit**

```powershell
git add src/cli.ts src/mcp/wp-api-tools.ts tests package.json
git add -u src/cli.js
git commit -m "refactor: convert cli orchestrator to typescript"
```

## Task 6: Switch Runtime Entrypoints To Compiled TypeScript

**Files:**
- Modify: `bin/wp-api.js`
- Verify: `bin/wp-api-mcp.js`
- Test: `tests/profile-cli.test.js`
- Test: `tests/resource-cli.test.js`

- [ ] **Step 1: Write a runtime smoke test expectation**

Run the existing JavaScript bin before editing:

```powershell
node bin\wp-api.js client --json
```

Expected: FAIL with a missing active client error if no client is configured, or PASS with the active client JSON if one is configured. This captures that the bin can start.

- [ ] **Step 2: Point `bin/wp-api.js` at compiled CLI output**

Replace `bin/wp-api.js` with:

```js
#!/usr/bin/env node
import { runCli } from "../dist/cli.js";
import { readStdinText } from "../dist/lib/stdin.js";

const result = await runCli(process.argv.slice(2), {
  stdinText: await readStdinText(process.stdin)
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

process.exitCode = result.exitCode;
```

`bin/wp-api-mcp.js` should remain:

```js
#!/usr/bin/env node
import { startStdioServer } from "../dist/mcp/server.js";

try {
  await startStdioServer();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
```

- [ ] **Step 3: Build and run bin smoke checks**

Run:

```powershell
npm run build
node bin\wp-api.js client --json
cmd /c "type nul | node bin\wp-api-mcp.js"
```

Expected: `npm run build` exits 0. `node bin\wp-api.js client --json` starts and returns either the active client JSON or the existing no-active-client error. `wp-api-mcp` exits 0 when stdin closes.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests\profile-cli.test.js tests\resource-cli.test.js
```

Expected: PASS for profile and resource CLI tests.

- [ ] **Step 5: Commit**

```powershell
git add bin/wp-api.js bin/wp-api-mcp.js
git commit -m "refactor: load compiled cli from bin entrypoints"
```

## Task 7: Tighten TypeScript Configuration

**Files:**
- Modify: `tsconfig.json`
- Modify: `package.json`
- Test: all tests

- [ ] **Step 1: Make TypeScript reject remaining JavaScript source under `src`**

Update `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Run build to verify no JS source remains in `src`**

Run:

```powershell
npm run build
```

Expected: PASS. If `src/**/*.js` still exists, inspect it with `rg --files src` and convert it before continuing.

- [ ] **Step 3: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS with all tests passing.

- [ ] **Step 4: Commit**

```powershell
git add tsconfig.json package.json src tests bin
git commit -m "build: require typescript source for cli"
```

## Task 8: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Verify: `SKILL.md`
- Verify: `docs/superpowers/plans/2026-07-06-convert-cli-to-typescript.md`

- [ ] **Step 1: Update development docs**

In both README files, ensure the development section includes:

````md
Run tests:

```bash
npm test
```

Build compiled runtime files:

```bash
npm run build
```

The source files live under `src/**/*.ts`. Runtime entrypoints in `bin/` load compiled JavaScript from `dist/`.
````

- [ ] **Step 2: Verify `SKILL.md` command examples remain accurate**

Run:

```powershell
rg -n "npm test|npm run build|wp-api-mcp|src/" README.md README.zh-CN.md SKILL.md
```

Expected: Documentation mentions `npm run build` where MCP/bin runtime depends on `dist`, and existing CLI usage examples remain unchanged.

- [ ] **Step 3: Run final verification**

Run:

```powershell
npm run build
npm test
node bin\wp-api.js client list --json
cmd /c "type nul | node bin\wp-api-mcp.js"
```

Expected: build exits 0, tests pass, CLI starts and returns either client list JSON or a valid CLI error based on local config, MCP stdio smoke test exits 0.

- [ ] **Step 4: Commit**

```powershell
git add README.md README.zh-CN.md SKILL.md docs/superpowers/plans/2026-07-06-convert-cli-to-typescript.md
git commit -m "docs: document typescript runtime workflow"
```

## Self-Review

- Spec coverage: The plan covers test harness migration, utility modules, resource/link helpers, config and WordPress client infrastructure, CLI orchestration, runtime entrypoints, TypeScript config tightening, documentation, and final verification.
- Placeholder scan: The plan contains no incomplete requirement markers and each code-changing step includes concrete paths, commands, and expected results.
- Type consistency: Public types introduced in earlier tasks are reused by later CLI and MCP steps with matching names: `AddLinkResult`, `ResourceName`, `CliResult`, and `RunCliOptions`.
