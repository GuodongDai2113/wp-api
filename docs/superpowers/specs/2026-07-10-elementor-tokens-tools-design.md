# Elementor Tokens MCP 工具设计

## 目标

新增 `wp_elementor_get_tokens` 与 `wp_elementor_set_tokens` 两个 MCP 工具，用于读取和更新 Elementor 默认 Kit 的 `meta._elementor_page_settings`。更新工具必须严格执行 read → merge → write，并在写入成功后清理 Elementor 缓存。

## 架构

沿用现有 MCP → CLI → `WordPressClient` 调用链。新增内部 `elementor get-tokens` 和 `elementor set-tokens` CLI 子命令，MCP 工具只负责输入校验和 CLI 参数转换。这样可以复用现有站点配置、认证、HTTP 错误处理和结构化输出机制。

两个工具面向站点的默认 Elementor Kit，不接受 `postId` 或 `resource`。

## `wp_elementor_get_tokens`

工具无需业务参数，仅使用现有全局客户端选择参数。

执行流程：

1. 请求 `GET wp/v2/elementor_library?slug=default-kit`。
2. 从第一个结果读取数值型 Kit ID；结果为空或 ID 无效时抛出明确错误。
3. 请求 `GET wp/v2/elementor_library/{kitId}?context=edit`。
4. 返回该实体的 `meta._elementor_page_settings`；字段缺失或不是普通对象时按空对象处理。

结构化结果包含：

- `kit_id`：默认 Kit ID。
- `tokens`：`meta._elementor_page_settings` 对象。

## `wp_elementor_set_tokens`

工具必填参数为 `tokens: Record<string, unknown>`。

执行流程严格固定为：

1. 请求 `GET wp/v2/elementor_library?slug=default-kit`，获取默认 Kit ID。
2. 请求 `GET wp/v2/elementor_library/{kitId}?context=edit`，读取现有设置。
3. 对现有 `_elementor_page_settings` 与输入 `tokens` 做顶层浅合并；未传入字段保留，同名字段由输入覆盖，嵌套对象和数组整体替换。
4. 请求 `POST wp/v2/elementor_library/{kitId}`，请求体仅包含 `{ meta: { _elementor_page_settings: mergedTokens } }`。
5. 仅在 POST 成功后请求 `DELETE elementor/v1/cache`。
6. 返回 `kit_id` 和最终的 `tokens`。

不得把 set 简化为盲写；每次调用都必须重新读取当前远端值，避免覆盖未包含在本次输入中的设置。

## 错误处理

- 默认 Kit 查询为空或 ID 非法：终止执行，不发起后续请求。
- Kit 详情缺少有效的 settings 对象：以空对象参与合并。
- POST 失败：直接返回现有 WordPress API 错误，不清理缓存。
- 缓存清理失败：工具调用失败并保留缓存清理错误；已完成的 Kit 写入不回滚。
- 所有非成功 HTTP 响应继续使用项目现有的 WordPress REST 错误格式。

## 代码边界

- `src/lib/elementor.ts`：承载 Kit ID 提取、page settings 读取和浅合并等纯函数。
- `src/cli.ts`：实现两个 Elementor CLI 子命令及顺序化 REST 调用。
- `src/mcp/wp-api-tools.ts`：新增工具名与 CLI argv 映射。
- `src/mcp/server.ts`：注册两个 MCP 工具及 Zod 输入 schema。
- README 与 MCP 工具清单：补充新工具及行为说明。

所有新增函数、属性和类型使用完整中文注释，遵循项目 `AGENTS.md` 要求。

## 测试

测试覆盖：

- get-tokens 的默认 Kit 查询、详情读取和输出。
- settings 缺失时返回空对象。
- set-tokens 的请求顺序严格为列表 GET、详情 GET、Kit POST、缓存 DELETE。
- 顶层浅合并保留未传字段，并整体替换同名嵌套对象或数组。
- 找不到默认 Kit 时不继续请求。
- Kit POST 失败时不请求缓存清理。
- 缓存 DELETE 失败时工具返回失败。
- MCP 工具注册、输入校验和 CLI 参数转换。
- TypeScript 构建及完整测试套件。
