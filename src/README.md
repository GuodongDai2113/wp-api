# 源码结构

`src` 按运行入口、应用配置、MCP 接入、WordPress 领域能力和通用能力分层：

```text
src/
├─ bin/                 # npm 命令行入口，只负责解析环境并启动服务
├─ config/              # 连接配置的存储与本地配置服务
├─ mcp/                 # MCP 服务、连接解析和工具路由
│  ├─ shared/           # 多类 MCP 工具共用的 WordPress 协议与校验
│  └─ tools/            # 每类 MCP 工具的输入校验与领域调用
├─ shared/              # 与具体业务无关的对象和文件处理能力
│  └─ files/            # 通用文件读写与原子导出能力
└─ wordpress/           # WordPress 客户端与领域能力
   ├─ content/          # 正文输入、转换、链接和替换
   ├─ elementor/        # Elementor 文档处理
   ├─ media/            # 媒体预处理
   └─ packages/         # 插件与主题软件包处理
```

## 依赖方向

- `bin` 可以依赖 `config` 和 `mcp`，但不承载业务逻辑。
- `mcp` 可以依赖 `wordpress`、`config` 和 `shared`。
- `wordpress` 只依赖自身子模块、第三方库和 Node.js 标准库。
- `shared` 不依赖 `mcp`、`config` 或 `wordpress`。
- 工具实现放在 `mcp/tools`，文件名直接使用领域名称，不再重复添加 `-tools` 后缀。

新增模块时应优先放到最具体的领域目录；只有确实与业务无关且被多个领域复用的能力才放入 `shared`。
