# Contributing

## Development

需要 Node.js 20 或更高版本。

```bash
npm ci
npm test
```

提交代码前请确认构建、完整测试和 npm 打包检查均通过：

```bash
npm run build
npm test
npm pack --dry-run
```

新增或修改函数、属性和类时，请提供完整的中文注释。安全相关改动应包含对应的回归测试。

## Pull requests

- 一个 Pull Request 聚焦一个明确目标。
- 描述行为变化、验证方式和可能的兼容性影响。
- 不要提交凭据、Application Password、构建目录或本地配置文件。
