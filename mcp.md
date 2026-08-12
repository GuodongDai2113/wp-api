# MCP 配置

将以下 `mcpServers` 配置加入你的 `opencode.json` 或 `cline_mcp_settings.json`。

## 本地开发

项目根目录运行，产物在 `dist/`：

```json
{
  "mcpServers": {
    "wp-api": {
      "command": "node",
      "args": ["build/bin/wp-api-mcp.js"]
    }
  }
}
```

如果希望跳过 `npm run build` 直接用 TypeScript 源码，可以借助 `npx tsx`：

```json
{
  "mcpServers": {
    "wp-api": {
      "command": "npx",
      "args": ["-y", "tsx", "build/bin/wp-api-mcp.js"]
    }
  }
}
```

## 打包后（npm link / npm install -g）

通过 `bin` 入口直接引用：

```json
{
  "mcpServers": {
    "wp-api": {
      "command": "wp-api-mcp"
    }
  }
}
```

## 可用工具

常用工具包括：

- `wp_client_list`
- `wp_client_add`
- `wp_client_use`
- `wp_resource_list`
- `wp_resource_get`
- `wp_resource_create`
- `wp_resource_update`
- `wp_resource_delete`
- `wp_seo_get`
- `wp_seo_update`
- `wp_post_link` (`action`: `list`, `add`, `update`, or `remove`)
- `wp_media_upload`
- `wp_package_list`
- `wp_package_get`
- `wp_package_install`
- `wp_package_update`
- `wp_package_activate`
- `wp_package_deactivate`
- `wp_package_pack_theme`
- `wp_package_pack_plugin`

`wp_media_upload` 使用本地路径上传图片到 WordPress 媒体库。`filePath` 必须是 MCP server 进程可以读取的路径，可选字段包括 `title`、`altText`、`caption`、`description`。

`wp_package_*` 使用必填的 `packageType` 区分 `plugin` 和 `theme`。列表、详情、ZIP 安装、ZIP 更新和激活同时支持插件与主题；`wp_package_deactivate` 仅支持插件。安装与更新的 `file` 必须是 MCP server 进程可以读取的本地 ZIP 路径。

`wp_package_pack_theme` 和 `wp_package_pack_plugin` 是纯本地打包工具。两者都接收必填的 `folderPath`；可选 `outputPath` 必须以 `.zip` 结尾，未提供时会在源文件夹同级生成 `<文件夹名>.zip`。ZIP 内保留源文件夹作为顶层目录，可直接用于 WordPress 安装；输出文件不允许位于源文件夹内部。

安装或更新插件、安装或更新主题以及激活主题依赖目标站点已经安装并激活 Jelly Core。MCP 会先读取目标站点的活动插件列表；如果没有找到活动状态的 `jelly-core/jelly-core.php`，会向 Agent 返回明确错误并终止操作，不会上传文件或发送后续变更请求。列表、详情以及插件激活和禁用使用 WordPress 原生接口，不依赖 Jelly Core。

使用绝对路径指定项目内编译产物：

```json
{
  "mcpServers": {
    "wp-api": {
      "command": "node",
      "args": ["J:\\project\\wp-api\\build\\bin\\wp-api-mcp.js"]
    }
  }
}
```
