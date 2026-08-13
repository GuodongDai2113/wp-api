# wp-api MCP 服务配置与工具参考

`wp-api` v2 是纯 STDIO MCP 服务。它不提供交互式命令界面；MCP host 应启动 `wp-api-mcp`，或在项目目录执行 `npm start`，然后通过 27 个结构化工具完成全部操作。

## 1. 安装和启动入口

环境要求：

- Node.js 20+
- 开启 REST API 的 WordPress 站点
- 有足够能力的 WordPress 用户及其 Application Password

在项目根目录安装并构建：

```bash
npm install
npm run build
```

编译产物入口为：

```text
build/bin/wp-api-mcp.js
```

可用的启动方式只有：

- `node <绝对路径>/build/bin/wp-api-mcp.js`
- 安装或链接包后执行 `wp-api-mcp`
- 在项目目录执行 `npm start`

这些入口都使用 STDIO 协议。标准输出由 MCP 消息占用，不应把进程当成交互式 shell 使用。

## 2. MCP host 配置

### 2.1 Codex

根据 [OpenAI 官方 Codex MCP 文档](https://developers.openai.com/codex/mcp/)，Codex 默认从 `~/.codex/config.toml` 读取 MCP 配置；受信任的项目也可以使用项目内 `.codex/config.toml`。

直接运行编译产物：

```toml
[mcp_servers.wp_api]
command = "node"
args = ["C:/absolute/path/to/wp-api/build/bin/wp-api-mcp.js"]
cwd = "C:/absolute/path/to/wp-api"
startup_timeout_sec = 10
tool_timeout_sec = 120

[mcp_servers.wp_api.env]
WP_API_ALLOWED_LOCAL_ROOTS = "C:/wordpress-content;D:/wordpress-packages"
```

`wp-api-mcp` 已加入 `PATH` 时：

```toml
[mcp_servers.wp_api]
command = "wp-api-mcp"
cwd = "C:/absolute/path/to/allowed-workspace"
tool_timeout_sec = 120
```

软件包上传、媒体上传和本地压缩可能超过 host 的默认工具超时，可按站点速度和包大小调整 `tool_timeout_sec`。修改配置后重启对应的 ChatGPT 桌面应用、Codex CLI 或 IDE 扩展，并在 MCP 服务列表中确认 `wp_api` 已连接。

### 2.2 通用 JSON 配置

使用常见 `mcpServers` 结构的 host：

```json
{
  "mcpServers": {
    "wp-api": {
      "command": "node",
      "args": ["/absolute/path/to/wp-api/build/bin/wp-api-mcp.js"],
      "cwd": "/absolute/path/to/wp-api",
      "env": {
        "WP_API_ALLOWED_LOCAL_ROOTS": "/srv/wordpress-content:/srv/wordpress-packages"
      }
    }
  }
}
```

具体配置文件名、超时字段及重载方式由 MCP host 决定。`args` 中应使用绝对路径，`cwd` 应指向允许 Agent 访问本地文件的最小目录。

### 2.3 允许的本地根目录

服务默认只允许以下路径位于进程 `cwd` 内：

- 资源正文文件 `contentFile`
- 媒体文件 `filePath`
- 安装/更新软件包的 `file`
- 本地打包源目录 `folderPath`
- 本地打包输出 `outputPath`

使用 `WP_API_ALLOWED_LOCAL_ROOTS` 可以额外开放可信目录：

```text
# Windows，以分号分隔
C:\content;D:\packages

# Linux/macOS，以冒号分隔
/srv/content:/srv/packages
```

每个额外根目录必须已存在且确实是目录。服务会同时校验输入的绝对位置和消除符号链接后的真实位置，因此不能使用符号链接跳出允许范围。不存在的 `outputPath` 会从最近的现存父目录开始校验。

该允许列表不是操作系统沙箱。获准目录不应允许不受信任的本地用户或进程并发修改，否则路径校验与实际打开、读取或写入之间仍可能发生路径替换竞态。

## 3. 首次连接 WordPress

client 的构建源是项目目录内的 `config/config.json`。`npm run build` 会将它复制到 `build/config/config.json`，编译后的 MCP 服务只引用并更新这个 build 内副本。Application Password 会以明文进入 build 和 npm 安装包；`wp_client_list` 返回时会将其移除。不要把包发布到公共 registry。

首次使用依次调用：

### 3.1 保存连接：`wp_client_add`

```json
{
  "name": "production",
  "siteUrl": "https://example.com",
  "username": "editor",
  "appPassword": "xxxx xxxx xxxx xxxx xxxx xxxx"
}
```

同名 client 会被覆盖。保存连接不会自动将它设为当前激活项。

### 3.2 选择连接：`wp_client_use`

```json
{
  "name": "production"
}
```

### 3.3 检查连接：`wp_client_list`

```json
{}
```

返回结构包含 `activeClient` 和不含密码的 `clients`。

配置更新只在单个服务进程内串行化，没有跨进程文件锁。多个 MCP host 共享同一个 `build/config/config.json` 时，应避免同时调用 `wp_client_add` 或 `wp_client_use`，否则最后完成的写入可能覆盖另一个进程基于旧快照所做的变更。重新构建还会用项目内 `config/config.json` 覆盖 build 副本；需要保留运行时新增的 client 时，应先同步回构建源。

## 4. 通用调用约定

除三个 client 工具和两个纯本地打包工具外，所有工具均支持：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `client` | string，可选 | 本次调用使用的已保存 client；不改变当前激活项 |
| `siteUrl` | string，可选 | 本次调用临时使用的同源 WordPress 子路径 |

不传 `client` 时使用当前激活项。没有显式 client 且没有当前激活项时，远端工具会返回错误。

所有工具都通过 MCP 同时返回文本 JSON 与结构化内容；结构化 payload 位于：

```json
{
  "result": {}
}
```

失败会作为 MCP tool error 返回，不会把错误伪装成成功结果。写操作应由上层 Agent 在调用前向用户确认目标站点、资源 ID 和破坏性语义。

## 5. 27 个 MCP 工具

### 5.1 Client（3 个）

| 工具 | 必填输入 | 说明 |
| --- | --- | --- |
| `wp_client_add` | `name`, `siteUrl`, `username`, `appPassword` | 新增或覆盖本地连接；返回内容隐藏密码 |
| `wp_client_use` | `name` | 把已保存连接设为当前激活项 |
| `wp_client_list` | 无 | 返回 `activeClient` 和安全的 client 列表 |

目前没有远程删除 client 的 MCP 工具。如需停用旧凭据，应先在 WordPress 端撤销对应 Application Password。

### 5.2 WordPress 资源（5 个）

`resource` 允许：

```text
posts | pages | products | categories | product-categories
```

路由映射：

| resource | REST 路由 | 类型 |
| --- | --- | --- |
| `posts` | `/wp-json/wp/v2/posts` | 内容 |
| `pages` | `/wp-json/wp/v2/pages` | 内容 |
| `products` | `/wp-json/wp/v2/product` | 内容 |
| `categories` | `/wp-json/wp/v2/categories` | taxonomy |
| `product-categories` | `/wp-json/wp/v2/product_cat` | taxonomy |

| 工具 | 必填输入 | 可选输入 |
| --- | --- | --- |
| `wp_resource_list` | `resource` | `search`, `page`, `perPage`, `status`, 通用连接字段 |
| `wp_resource_get` | `resource`, `id` | 通用连接字段 |
| `wp_resource_create` | `resource`，并至少提供一个适用写入字段 | 下列资源写入字段、通用连接字段 |
| `wp_resource_update` | `resource`, `id` | 下列资源写入字段、通用连接字段；至少提供一个有效更新字段 |
| `wp_resource_delete` | `resource`, `id` | `force`, 通用连接字段 |

内容资源写入字段：

- `title`, `slug`, `status`, `excerpt`
- `content` 或 `contentFile`；两者同时存在时 `content` 优先
- `gutenberg`：将解析后的 HTML 转换为 Gutenberg 区块标记
- `featuredMedia`：非负附件 ID，`0` 表示清空
- `categories`：正整数 ID 数组，`[]` 表示清空

taxonomy 写入字段：

- `name`, `slug`, `description`
- `parent`：非负 ID，`0` 表示移除父级

`perPage` 可为 `1..100`，或使用 `-1` 聚合全部分页。分类和产品分类没有回收站，`wp_resource_delete` 对这两类资源强制要求 `force: true`；文章、页面和产品只有显式传入 `force: true` 才会永久删除，否则进入回收站。

### 5.3 SEO 与文章编辑（4 个）

| 工具 | 必填输入 | 可选/动作相关输入 |
| --- | --- | --- |
| `wp_seo_get` | `resource`, `id` | 通用连接字段 |
| `wp_seo_update` | `resource`, `id` | `title`, `description`, `focusKeyword` 中至少一个；通用连接字段 |
| `wp_post_link` | `action`, `postId` | `text`, `href`, `newHref`, `newText`，按动作决定 |
| `wp_post_content_replace` | `postId`, `text`, `replacement` | 通用连接字段 |

SEO 工具通过资源自身的 REST `meta` 读写：

- `rank_math_title`
- `rank_math_description`
- `rank_math_focus_keyword`

目标 WordPress 必须注册并允许当前用户通过 REST 访问这些 meta。`wp_seo_update` 中的空字符串表示显式清空，不能省略全部三个更新字段。

`wp_post_link` 的动作规则：

| `action` | 必填字段 | 行为 |
| --- | --- | --- |
| `list` | `postId` | 列出正文链接，不写入 |
| `add` | `postId`, `text`, `href` | 为第一个可匹配的可见文本添加链接 |
| `update` | `postId`, `href`，以及 `newHref`/`newText` 至少一个 | 更新匹配链接，可用 `text` 进一步过滤 |
| `remove` | `postId`, `href` | 移除匹配链接但保留锚文本，可用 `text` 过滤 |

链接地址必须是 HTTP(S) URL 或不含控制字符的相对 URL。文章链接和正文替换都读取 `context=edit` 下的 raw content；账号必须有编辑权限。正文替换会替换所有精确匹配，`replacement: ""` 表示删除匹配文本。

### 5.4 媒体（1 个）

`wp_media_upload` 必填 `filePath`，可选：

- `title`
- `altText`
- `caption`
- `description`
- 通用连接字段

允许的位图扩展名为 `.avif`、`.gif`、`.jpeg`、`.jpg`、`.png`、`.webp`。上传成功后，如果提供了附件元数据，服务会再更新媒体实体。

### 5.5 Elementor（6 个）

Elementor 工具固定操作 `pages`，不接受 `resource` 字段。每个工具都要求正整数 `postId`，并支持通用连接字段。

| 工具 | 额外输入 | 说明 |
| --- | --- | --- |
| `wp_elementor_init` | `data?`, `pageSettings?` | 仅当现有元素树为空时初始化 Elementor meta；未传 `data` 时写入空元素树 |
| `wp_elementor_export` | 无 | 返回完整原始元素树 `json` |
| `wp_elementor_import` | `data` | 用结构化数组整体替换元素树 |
| `wp_elementor_structure` | 无 | 返回 ID、元素类型、widget 类型和关键 setting 的精简树 |
| `wp_elementor_get_element` | `elementId` | 返回单个元素的完整 settings |
| `wp_elementor_find` | `widgetType?`, `elementType?`, `searchText?`, `settingKey?`, `settingValue?` | 所有已提供条件按“且”匹配 |

`data` 必须是 Elementor 元素对象数组，`pageSettings` 必须是对象。init 会先读取页面并拒绝覆盖非空元素树；import 会整体覆盖页面的 Elementor 元数据，调用前应先用 export 备份当前元素树。

### 5.6 插件、主题与本地打包（8 个）

远端软件包工具使用 `packageType: "plugin" | "theme"`。

| 工具 | 必填输入 | 可选输入/说明 |
| --- | --- | --- |
| `wp_package_list` | `packageType` | `status: "active" | "inactive"`、`search`、通用连接字段；主题忽略 `search` |
| `wp_package_get` | `packageType`, `package` | 通用连接字段 |
| `wp_package_install` | `packageType`, `file` | 通用连接字段；本地 ZIP |
| `wp_package_update` | `packageType`, `file` | 通用连接字段；本地 ZIP |
| `wp_package_activate` | `packageType`, `package` | 通用连接字段 |
| `wp_package_deactivate` | `packageType: "plugin"`, `package` | 通用连接字段；不支持主题 |
| `wp_package_pack_theme` | `folderPath` | `outputPath`；纯本地，不使用 client |
| `wp_package_pack_plugin` | `folderPath` | `outputPath`；纯本地，不使用 client |

`package` 对插件是主文件标识，对主题是 stylesheet slug。安装和更新只接受扩展名为 `.zip` 且具有常见 ZIP 文件头的本地文件。

本地打包规则：

- ZIP 内保留源文件夹作为顶层目录，可直接交给 WordPress 安装。
- `outputPath` 必须以 `.zip` 结尾。
- 未传 `outputPath` 时，在源文件夹同级生成 `<文件夹名>.zip`。
- 输出文件不能位于源文件夹内部。
- 源树不允许符号链接或特殊文件。
- 写入时先生成临时文件，再原子替换目标 ZIP。

## 6. Jelly Core 依赖范围

| 操作 | 使用的接口 | 需要 Jelly Core |
| --- | --- | --- |
| 列出/读取插件和主题 | WordPress 原生 REST | 否 |
| 激活/停用插件 | WordPress 原生 `/wp/v2/plugins` | 否 |
| 安装/更新插件 | 媒体上传 + Jelly Core | 是 |
| 安装/更新主题 | Jelly Core | 是 |
| 激活主题 | Jelly Core | 是 |
| 停用主题 | 不支持 | — |

需要 Jelly Core 的操作会先以 `per_page=-1` 聚合全部活动插件，并识别 `jelly-core`、`jelly-core/jelly-core` 或 `jelly-core/jelly-core.php`。检查失败时不会上传文件或发出后续变更请求。

Jelly Core 自定义端点必须在 WordPress 服务端执行登录用户和 capability 校验。服务发出的 `X-Jelly-Timestamp`、`X-Jelly-Signature` 等字段只用于兼容旧协议，不含共享秘密，不能作为独立认证依据。

## 7. URL 和网络安全规则

站点 URL：

- 必须使用 HTTPS。
- 只有明确的回环地址允许 HTTP：`localhost`、`*.localhost`、`127.0.0.0/8`、`::1`。
- 禁止 URL 内嵌用户名或密码。
- 禁止 query 和 fragment。
- 每次调用的 `siteUrl` 覆盖必须与已保存 URL 同源，仅可改变路径。
- 携带 Application Password 的 WordPress 请求不跟随 301/302/303/307/308 重定向；应保存规范 URL。

服务使用 HTTP Basic Authentication 发送 WordPress Application Password。请为 MCP 使用专门的低权限 WordPress 账号，定期轮换密码，并在不再使用时从 WordPress 撤销。

## 8. 默认资源上限

| 资源 | 默认上限 |
| --- | ---: |
| 单次请求 | 30 秒超时 |
| 单个 WordPress REST 响应体 | 25 MiB |
| `contentFile` | 25 MiB UTF-8 内容 |
| 本地媒体文件 | 50 MiB |
| 本地插件/主题 ZIP | 100 MiB |
| Elementor 元素树 | 10 MiB JSON、10,000 个元素、100 层父子深度 |
| `perPage: -1` | 最多 100 页，聚合结果约 50 MiB JSON |
| 本地打包源树 | 20,000 个文件/目录条目 |
| 本地打包源文件总量 | 512 MiB 未压缩文件 |

这些上限用于防止无界内存、网络和压缩消耗。当前 STDIO 入口不提供环境变量来放宽它们；如需处理更大对象，应先评估 host 超时、Node.js 内存和 WordPress/PHP 上传限制，再通过受控代码集成调整 client 选项。

## 9. 常见故障

### 服务启动后没有终端提示

这是正常行为。STDIO 服务正在等待 MCP host 的初始化消息。让 host 启动进程，不要在终端中手工输入业务命令。

### `No client selected`

先调用 `wp_client_add` 保存连接，再调用 `wp_client_use` 选择当前连接；或在远端工具中显式传入已保存的 `client`。

### 认证后收到重定向错误

把保存的 `siteUrl` 改为最终规范地址，例如补上正确的 HTTPS、域名或 WordPress 子目录。服务不会让携带凭据的请求自动跳转。

### 本地路径超出允许根目录

确认 MCP host 的 `cwd`，把文件移入该目录，或将最小必要目录加入 `WP_API_ALLOWED_LOCAL_ROOTS`。增加环境变量后需要重启 MCP 服务。

### Elementor 或 SEO meta 不可见

确认目标插件已安装，并且相关 meta 使用 `show_in_rest` 注册；还要确认当前 WordPress 用户拥有 edit context 所需权限。

### 软件包操作提示 Jelly Core 未激活

先在目标 WordPress 站点安装并激活 Jelly Core。检查发生在上传/修改之前，失败后无需清理半完成的软件包变更。

## 10. v2 破坏性变更

v2 移除了 `wp-api` CLI、命令参数解析、stdin 正文命令模式以及 CLI 专属文本/JSON 输出选项。迁移方式是让 MCP host 启动 `wp-api-mcp`（或 `npm start`），并改为调用对应结构化工具。凭据从项目内 `config/config.json` 构建到 `build/config/config.json`。
