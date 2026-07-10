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
- `wp_post_link_add`
- `wp_media_upload`
- `wp_elementor_get_tokens`
- `wp_elementor_set_tokens`

`wp_media_upload` 使用本地路径上传图片到 WordPress 媒体库。`filePath` 必须是 MCP server 进程可以读取的路径，可选字段包括 `title`、`altText`、`caption`、`description`。

`wp_elementor_get_tokens` 读取 Elementor 默认 Kit 的 `_elementor_page_settings`。`wp_elementor_set_tokens` 接收必填 `tokens` 对象，按 read → 顶层浅 merge → write 的顺序更新，写入成功后调用 `DELETE /wp-json/elementor/v1/cache`。两个工具均不接受 `postId` 或 `resource`。

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
