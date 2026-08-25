# Changelog

本项目的重要变更记录在此文件中，版本格式遵循语义化版本。

## Unreleased

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
