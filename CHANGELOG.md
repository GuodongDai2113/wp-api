# Changelog

本项目的重要变更记录在此文件中，版本格式遵循语义化版本。

## Unreleased

### Changed

- 资源 batch 新增 8 MiB 单请求和 25 MiB 整次调用 JSON 上限，并按条目数与实际字节数共同分块；资源和 SEO CSV 导出改为动态跟踪分页并通过排他硬链接发布，消除最终落盘覆盖竞态。
- MCP 移除 `product_tag` 资源和产品标签关联；post 与产品统一使用 `categories` 输入，并分别自动映射到 REST `categories` 与 `product_cat`。
- 资源 CRUD 改用 `target: { type, resource }` 判别 post 与 taxonomy，创建/更新字段收拢到 `data`，批量条目改为 `{ id?, data }`；资源 CSV 同步拆分为 post 与 taxonomy 两套严格表头。
- 新增 `wp_resource_count`、`wp_resource_batch_create` 和 `wp_resource_batch_update`；资源列表改为有界分页，并支持按每页 100 条原子导出可回导的类型专用 CSV。
- 移除 `WordPressClient.list()` 的 `per_page=-1` 内存聚合；Jelly Core 激活检查改为逐页查询，资源和 SEO CSV 共用有界解析与标准编码能力。
- 用只读的 `wp_client_get` 替换 `wp_client_use`，`wp_client_list` 改为直接返回全部连接名称与站点 URL；移除当前连接状态、配置页面默认连接操作，并要求远端工具显式传入 `client`。
- 所有 MCP 工具的紧凑 JSON 结果超过 8 KiB 时，完整结果改为保存到本地 `.wp-api-results` JSON 文件，MCP 响应只返回绝对路径、字节数和 SHA-256，避免大型 `structuredContent` 被会话折叠。
- Elementor 破坏性替换旧的 get/update/import 工具为 `wp_elementor_pull` 和 `wp_elementor_push`：完整 data 通过带站点、页面和 revision 的版本化本地 JSON 往返，支持并发保护、安全重试、缓存刷新与本地基线原子更新。
- 新增纯本地 `wp_elementor_inspect` 和 `wp_elementor_edit`：支持有界元素/JSON Pointer 定位、文件 SHA-256 并发保护，以及 settings 更新、元素替换、插入、删除和移动的原子树编辑。
- Elementor 紧凑 data 默认上限从 10 MiB/10,000 元素提升到可配置的 100 MiB/100,000 元素，并通过 `WP_API_MAX_ELEMENTOR_DATA_BYTES` 覆盖；其他 WordPress REST 请求仍保持原响应上限。
- 资源创建/更新新增 `metaFile`，通过通用的 10 MiB 有界 JSON 文件读取器解析，减少大型写入参数占用 Agent 会话。
- 将 MCP 工具 `wp_api_schema` 重命名为 `wp_rest_api`；新工具移除 `client` 和 `siteUrl`，改为通过必填裸域名 `domain` 固定拼接公开 HTTPS REST 地址。`apiPath` 默认为 `wp-json`，支持完整 `wp-json/...` 路径和省略该前缀的简写，并且永不读取或发送本地凭据。

## 2.1.0

### Security

- 阻止编码后的 REST API 路径逃出目标站点的 `wp-json` 根目录。
- Gutenberg HTML 转换改用 HTML5 parser，并按标签、属性和 WordPress URL 协议允许列表移除事件属性、活动协议及危险嵌入内容。

### Changed

- `wp_media_upload` 在上传前于内存中将 JPEG/PNG 按参考尺寸规则压缩为质量 85 的 WebP，同时保留 PNG 透明度；GIF、AVIF 和已有 WebP 保持原格式。
- `wp_api_schema` 的根路由和具体 `OPTIONS` 查询默认返回轻量摘要，并支持显式 `detail: "full"` 原始响应。
- `wp_structure_get` 默认返回概览并支持按 `write`、`response`、`example` 分片查询，避免重复返回 Agent 已知的信息。
- 本地结构目录补齐 `product-tag`，避免为已支持资源回退到更大的远端 schema 查询。
- Elementor 工具收敛为 page-only 的读取、正文局部修改和完整覆盖导入，移除初始化、部件结构、单元素和搜索工具；局部修改要求回传读取版本，兼容官方空 `settings` 数组，并校验 REST meta 实际落盘。
- Elementor 读取工具定名为 `wp_elementor_get`。
- `wp_elementor_update` 和 `wp_elementor_import` 在数据落盘校验后自动调用 Elementor 原生 REST 接口刷新全站缓存，不再暴露独立缓存工具。
- 超过 8 KiB 的 MCP 结果不再在文本内容中重复完整 JSON；完整数据仍保留在 `structuredContent.result`。
- 为全部 MCP 工具增加只读、破坏性、幂等性和外部交互 annotations。
- 补充 npm 发布元数据、许可证和安全报告说明。

## 2.0.0

- 提供纯 STDIO MCP 服务、加密 client 配置、WordPress 内容与媒体管理、Elementor、Jelly Catalog、Jelly Core 软件包和 Jelly Form 工具。
