# MCP 配置

将以下 `mcpServers` 配置加入你的 `opencode.json` 或 `cline_mcp_settings.json`。

## 本地开发

项目根目录运行，产物在 `dist/`：

```json
{
  "mcpServers": {
    "wp-api": {
      "command": "node",
      "args": ["bin/wp-api-mcp.js"]
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
      "args": ["-y", "tsx", "bin/wp-api-mcp.js"]
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

使用绝对路径指定项目内编译产物：

```json
{
  "mcpServers": {
    "wp-api": {
      "command": "node",
      "args": ["J:\\project\\wp-api\\bin\\wp-api-mcp.js"]
    }
  }
}
```
