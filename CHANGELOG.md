# Changelog

本项目的重要变更记录在此文件中，版本格式遵循语义化版本。

## Unreleased

### Security

- 阻止编码后的 REST API 路径逃出目标站点的 `wp-json` 根目录。

### Changed

- 为全部 MCP 工具增加只读、破坏性、幂等性和外部交互 annotations。
- 从本地结构目录移除 `product-tag`；`product-tags` 资源操作保持可用。
- 补充 npm 发布元数据、许可证和安全报告说明。

## 2.0.0

- 提供纯 STDIO MCP 服务、加密 client 配置、WordPress 内容与媒体管理、Elementor、Jelly Catalog、Jelly Core 软件包和 Jelly Form 工具。
