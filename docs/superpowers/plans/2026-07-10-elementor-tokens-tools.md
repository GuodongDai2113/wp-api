# Elementor Tokens Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增两个 MCP 工具，可靠读取与浅合并更新 Elementor 默认 Kit 的 `_elementor_page_settings`，并在写入成功后清理缓存。

**Architecture:** 延续 MCP → CLI → `WordPressClient` 调用链。`src/lib/elementor.ts` 提供无副作用的数据解析，`src/cli.ts` 负责按固定顺序编排 REST 请求，MCP 层只做 schema 校验和 argv 映射。

**Tech Stack:** TypeScript 5、Node.js test runner、Zod、WordPress REST API、MCP SDK。

## Global Constraints

- set 必须严格执行 read → 顶层浅 merge → write。
- 嵌套对象和数组遇到同名 key 时整体替换。
- POST 成功后必须调用 `DELETE elementor/v1/cache`；POST 失败时不得清缓存。
- 两个工具不接受 `postId` 或 `resource`。
- 所有新增函数、属性、接口和类型必须提供完整中文注释。
- 保留工作区中用户已有的无关修改。

---

### Task 1: 默认 Kit 数据解析纯函数

**Files:**
- Modify: `src/lib/elementor.ts`
- Test: `tests/elementor.test.js`

**Interfaces:**
- Produces: `readDefaultKitId(entities: unknown): number`
- Produces: `readElementorPageSettings(entity: unknown): ElementorSettings`
- Produces: `mergeElementorPageSettings(current: ElementorSettings, updates: ElementorSettings): ElementorSettings`

- [ ] **Step 1: 写失败测试**

新增测试，要求从数组首项读取 ID、缺失 settings 返回 `{}`，以及 `{ nested: { old: 1 }, keep: true }` 与 `{ nested: { next: 2 } }` 合并为 `{ nested: { next: 2 }, keep: true }`；空列表必须抛出 `Default Elementor Kit was not found.`。

- [ ] **Step 2: 验证测试因导出不存在而失败**

Run: `npm run build && node --test tests/elementor.test.js`
Expected: FAIL，提示新函数未从模块导出。

- [ ] **Step 3: 实现最小纯函数**

```ts
/** 从默认 Kit 列表响应中读取第一个有效的数值 ID。 */
export function readDefaultKitId(entities: unknown): number {
  if (!Array.isArray(entities) || !isObject(entities[0]) || typeof entities[0].id !== "number") {
    throw new Error("Default Elementor Kit was not found.");
  }
  return entities[0].id;
}

/** 从 REST 实体中安全读取 Elementor 页面设置。 */
export function readElementorPageSettings(entity: unknown): ElementorSettings {
  if (!isObject(entity) || !isObject(entity.meta) || !isObject(entity.meta._elementor_page_settings)) return {};
  return entity.meta._elementor_page_settings;
}

/** 顶层浅合并 Elementor 页面设置。 */
export function mergeElementorPageSettings(current: ElementorSettings, updates: ElementorSettings): ElementorSettings {
  return { ...current, ...updates };
}
```

- [ ] **Step 4: 运行纯函数测试并确认通过**

Run: `npm run build && node --test tests/elementor.test.js`
Expected: PASS。

### Task 2: CLI read → merge → write → clear 流程

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/elementor-cli.test.js`

**Interfaces:**
- Consumes: Task 1 的三个纯函数。
- Produces: `elementor get-tokens --json` 和 `elementor set-tokens --tokens-json <object> --json`。

- [ ] **Step 1: 写 get-tokens 失败测试**

测试依次响应默认 Kit 列表和详情，并断言 URL 为 `wp/v2/elementor_library?slug=default-kit`、`wp/v2/elementor_library/23?context=edit`，输出为 `{ kit_id: 23, tokens: settings }`。

- [ ] **Step 2: 验证未知子命令或缺失 ID 导致失败**

Run: `npm run build && node --test tests/elementor-cli.test.js`
Expected: FAIL，get-tokens 尚不可用。

- [ ] **Step 3: 实现 get-tokens**

在读取页面 `postId` 之前分派 token 子命令；通过 `client.request` 执行两个 GET，并用 Task 1 纯函数构造 payload。

- [ ] **Step 4: 验证 get-tokens 通过**

Run: `npm run build && node --test tests/elementor-cli.test.js`
Expected: PASS。

- [ ] **Step 5: 写 set-tokens 失败测试**

测试四个请求严格为列表 GET、详情 GET、Kit POST、缓存 DELETE；断言 POST body 仅为合并后的 `_elementor_page_settings`，且嵌套对象和数组整体替换。另加 POST 失败时调用数停在 3、缓存 DELETE 失败时 CLI 失败的测试。

- [ ] **Step 6: 验证 set-tokens 尚不可用**

Run: `npm run build && node --test tests/elementor-cli.test.js`
Expected: FAIL，set-tokens 尚不可用。

- [ ] **Step 7: 实现固定顺序写入**

解析 `--tokens-json` 为普通对象，重新读取 Kit，浅合并后调用：

```ts
await client.request(`wp/v2/elementor_library/${kitId}`, {
  method: "POST",
  body: { meta: { _elementor_page_settings: mergedTokens } }
});
await client.request("elementor/v1/cache", { method: "DELETE" });
```

返回 `{ kit_id: kitId, tokens: mergedTokens }`。

- [ ] **Step 8: 验证 CLI 全部分支**

Run: `npm run build && node --test tests/elementor-cli.test.js`
Expected: PASS，包括顺序和失败短路断言。

### Task 3: MCP 工具注册与参数映射

**Files:**
- Modify: `src/mcp/wp-api-tools.ts`
- Modify: `src/mcp/server.ts`
- Test: `tests/mcp-tools.test.js`

**Interfaces:**
- Produces: `wp_elementor_get_tokens`，无业务参数。
- Produces: `wp_elementor_set_tokens`，输入 `tokens: Record<string, unknown>`。

- [ ] **Step 1: 写失败测试**

断言 get 映射为 `elementor get-tokens --json`，set 映射为 `elementor set-tokens --json --tokens-json <JSON>`；注册测试断言两个工具存在，set 缺少 `tokens` 时 schema 拒绝。

- [ ] **Step 2: 验证新工具名不受支持**

Run: `npm run build && node --test tests/mcp-tools.test.js`
Expected: FAIL，提示 unknown tool 或工具未注册。

- [ ] **Step 3: 实现工具名、argv builder 和注册**

扩展 `WpApiToolName` union 和 switch；新增不读取 `postId` 的 token argv builder；在 server 以 `elementorSettingsSchema` 注册 set 的必填 `tokens`。

- [ ] **Step 4: 验证 MCP 测试**

Run: `npm run build && node --test tests/mcp-tools.test.js`
Expected: PASS。

### Task 4: 文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `mcp.md`

**Interfaces:**
- Documents: 两个工具的参数、浅合并语义、请求顺序及缓存清理行为。

- [ ] **Step 1: 更新文档且保留已有 README 改动**

仅在现有 Elementor/MCP 工具章节追加 `wp_elementor_get_tokens`、`wp_elementor_set_tokens`；说明 set 输入 `tokens`，不接受 `postId`，并执行 read → shallow merge → write → cache clear。

- [ ] **Step 2: 运行格式与完整验证**

Run: `git diff --check && npm test`
Expected: diff check 退出 0；完整测试 0 failures。

- [ ] **Step 3: 检查需求覆盖与工作区差异**

Run: `git diff -- src tests README.md README.zh-CN.md mcp.md && git status --short`
Expected: 只包含本功能改动与用户原有的 README 改动，不出现构建产物或无关文件。
