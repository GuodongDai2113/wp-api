# wp-api

一个纯 [Model Context Protocol](https://modelcontextprotocol.io/) 服务，通过 WordPress 原生 REST API 以及 Jelly Core、Jelly Catalog 和 Jelly Form REST API 管理站点。服务使用 STDIO 传输，提供 31 个结构化工具，覆盖 client、内容、SEO、Elementor、媒体、插件/主题及询价管理。

English documentation: [README.md](./README.md) · MCP 详细配置：[mcp.md](./mcp.md)

v2 仅提供 MCP 服务。唯一的可执行入口是 `wp-api-mcp`，不再提供独立的 `wp-api` 命令界面。

## 环境要求

- Node.js 20 或更高版本
- 已开启 REST API 的 WordPress 站点
- WordPress 用户及其 [Application Password](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)
- 与 MCP 可能执行的操作相匹配的 WordPress 权限
- 使用 SEO 工具时，Rank Math 元字段需要通过 REST 暴露
- 使用下文指定的软件包操作时，目标站点需要安装并激活 Jelly Core

产品能力适配 Jelly Catalog，不适配 WooCommerce。目标站点需要启用 Jelly Catalog，并把产品和产品分类分别暴露为 `/wp-json/wp/v2/product` 与 `/wp-json/wp/v2/product_cat`。Elementor 工具要求对应页面的 meta 可通过 REST 读写。

## 安装与构建

```bash
npm install
npm run build
```

直接检查编译后的 STDIO 服务是否能启动：

```bash
npm start
```

`npm start` 和 `wp-api-mcp` 会在标准输入上等待 MCP host，不提供交互式终端。正常使用时应让 MCP host 自动拉起该进程。

通过 `npm link` 或全局安装后，包只暴露 `wp-api-mcp` 这一个可执行入口：

```bash
npm link
```

## 连接 MCP host

建议使用绝对路径并明确设置 `cwd`。进程工作目录同时也是本地文件工具的默认访问边界。

### Codex

Codex 从 `~/.codex/config.toml` 读取 MCP 配置，也可以在受信任项目内使用 `.codex/config.toml`。同一台主机上的 ChatGPT 桌面应用、Codex CLI 和 Codex IDE 扩展共享这份配置。格式依据 [OpenAI 官方 Codex MCP 文档](https://developers.openai.com/codex/mcp/)：

```toml
[mcp_servers.wp_api]
command = "node"
args = ["C:/absolute/path/to/wp-api/build/bin/wp-api-mcp.js"]
cwd = "C:/absolute/path/to/wp-api"

[mcp_servers.wp_api.env]
WP_API_ALLOWED_LOCAL_ROOTS = "C:/wordpress-content;D:/wordpress-packages"
```

如果 `wp-api-mcp` 已加入 `PATH`，可以简化为：

```toml
[mcp_servers.wp_api]
command = "wp-api-mcp"
cwd = "C:/absolute/path/to/allowed-workspace"
```

### 通用 STDIO MCP host

使用常见 `mcpServers` JSON 结构的 host 可以配置为：

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

配置文件名由具体 host 决定。修改后需要重启或重新加载 MCP host。

## 首次配置 client

连接信息完全通过 MCP 工具配置，不需要额外命令。在 MCP host 中依次调用以下三个工具：

1. `wp_client_add`

   ```json
   {
     "name": "production",
     "siteUrl": "https://example.com",
     "username": "editor",
     "appPassword": "xxxx xxxx xxxx xxxx xxxx xxxx"
   }
   ```

2. `wp_client_use`

   ```json
   { "name": "production" }
   ```

3. `wp_client_list`

   ```json
   {}
   ```

`wp_client_list` 用于确认当前激活项，且不会返回 Application Password。项目内的 `config/config.json` 是凭据构建源，`npm run build` 会把它复制为运行时实际引用的 `build/config/config.json`。源文件已被 Git 忽略，但 `build` 会进入 npm 安装包，因此该安装包必须作为含明文凭据的敏感文件处理，禁止发布到公共 registry 或对外共享。

配置写入会在单个服务进程内串行化，但当前没有跨进程文件锁。多个 MCP host 若共享同一系统账户和配置文件，不应并发修改 client；应指定单一写入者，或在代码嵌入场景为各实例配置不同目录。

所有远端工具都接受可选的 `client` 和 `siteUrl`。`client` 可以在不改变当前激活项的情况下选用另一个已保存连接；`siteUrl` 只能修改已保存 URL 同一 origin 下的路径，不能把已保存凭据转发到其他主机。

## 工具列表

服务共暴露 31 个工具。

### Client 配置（3 个）

- `wp_client_add`：新增或覆盖一个 WordPress 连接。
- `wp_client_use`：设置当前激活的连接。
- `wp_client_list`：列出连接及当前激活名称，不返回密码。

### WordPress 资源（5 个）

- `wp_resource_list`：列出文章、页面、分类或 Jelly Catalog 产品与产品分类。
- `wp_resource_get`：按 ID 读取单个资源。
- `wp_resource_create`：创建内容或分类项。
- `wp_resource_update`：更新内容或分类项。
- `wp_resource_delete`：把内容移入回收站，或永久删除分类项。

`resource` 支持 `posts`、`pages`、`products`、`categories`、`product-categories`；其中产品相关资源专指 Jelly Catalog，不代表 WooCommerce 产品。分类和产品分类没有回收站，删除时必须显式传入 `force: true`。`perPage: -1` 会在下文资源上限内自动聚合全部分页。

### SEO、文章内容与媒体（5 个）

- `wp_seo_get`：读取 Rank Math 标题、描述和焦点关键词。
- `wp_seo_update`：更新或显式清空 Rank Math REST meta。
- `wp_post_link`：列出、新增、更新或删除可编辑文章正文中的链接。
- `wp_post_content_replace`：替换文章中的所有精确文本匹配。
- `wp_media_upload`：上传本地位图，并可设置附件元数据。

资源创建/更新支持直接传 `content` 或读取本地 `contentFile`。设置 `gutenberg: true` 后，会在上传前把解析出的 HTML 转换成 Gutenberg 区块标记。媒体扩展名仅支持 `.avif`、`.gif`、`.jpeg`、`.jpg`、`.png`、`.webp`。

### Elementor（6 个）

- `wp_elementor_init`：仅在元素树为空的页面上初始化 Elementor meta。
- `wp_elementor_export`：导出原始 Elementor 元素树。
- `wp_elementor_import`：整体替换 Elementor 元素树。
- `wp_elementor_structure`：返回精简的元素层级结构。
- `wp_elementor_get_element`：按 ID 读取单个元素及其 settings。
- `wp_elementor_find`：按元素类型、组件类型、文本或 setting 搜索。

### 插件、主题与本地打包（8 个）

- `wp_package_list`：列出已安装的插件或主题。
- `wp_package_get`：读取单个插件或主题。
- `wp_package_install`：从本地 ZIP 安装插件或主题。
- `wp_package_update`：从本地 ZIP 更新插件或主题。
- `wp_package_activate`：激活插件或切换主题。
- `wp_package_deactivate`：停用插件，不支持主题。
- `wp_package_pack_theme`：在本地创建可安装的主题 ZIP。
- `wp_package_pack_plugin`：在本地创建可安装的插件 ZIP。

### Jelly Form

- `wp_jelly_form_settings_get`：读取接收邮箱、通知、跳转及脱敏后的 SMTP 设置。
- `wp_jelly_form_settings_update`：按字段更新接收邮箱、通知、跳转或 SMTP 设置；省略 SMTP 密码时保留原密码。
- `wp_jelly_form_inquiry_list`：分页、搜索并按日期读取非垃圾询价，只读。
- `wp_jelly_form_inquiry_get`：按 ID 读取一条非垃圾询价，只读。

字段约定和操作细节见 [mcp.md](./mcp.md)。

## 安全模型

### 站点 URL 与凭据

- 站点 URL 必须使用 HTTPS。只有 `localhost`、`*.localhost`、`127.0.0.0/8`、`::1` 等回环主机允许使用 HTTP。
- 站点 URL 不能嵌入用户名/密码，也不能包含 query 或 fragment。
- 每次调用传入的 `siteUrl` 必须和已保存 URL 同源。
- 携带 WordPress 凭据的请求不会跟随重定向；应直接配置站点的规范 URL。
- 服务使用已保存的 WordPress Application Password 认证。请只授予该 WordPress 用户实际需要的能力。

### 本地路径边界

以下字段会读写本地文件：`contentFile`、媒体 `filePath`、软件包 `file`、打包 `folderPath` 和 `outputPath`。

默认情况下，这些路径必须位于 MCP 服务进程的 `cwd` 内。可以通过 `WP_API_ALLOWED_LOCAL_ROOTS` 增加可信根目录，并使用当前平台的路径分隔符：

- Windows：分号，例如 `C:\content;D:\packages`
- Linux/macOS：冒号，例如 `/srv/content:/srv/packages`

服务同时校验词法路径和解析符号链接后的真实路径，不能借助已有符号链接逃逸。配置的根目录必须已存在且确实是目录。允许列表应尽可能收窄：所有获准调用文件工具的 Agent 都能访问这些目录。

允许列表是应用层边界，不是操作系统沙箱。应确保不受信任的本地用户或进程不能在工具执行期间修改获准目录；否则从路径校验到实际文件访问之间仍存在操作系统层面的路径替换竞态。

### 默认资源上限

| 边界 | 默认值 |
| --- | ---: |
| 单次网络请求超时 | 30 秒 |
| 单个 WordPress REST 响应 | 25 MiB |
| 单个 `contentFile` | 25 MiB |
| 单个媒体文件 | 50 MiB |
| 单个插件/主题 ZIP | 100 MiB |
| 单个 Elementor 元素树 | 10 MiB JSON、10,000 个元素、100 层 |
| `perPage: -1` 聚合 | 100 页且约 50 MiB JSON |
| 本地打包源目录 | 20,000 个条目且未压缩文件共 512 MiB |

上传的软件包必须使用 `.zip` 扩展名并具有可识别的 ZIP 文件头。本地打包会拒绝符号链接和特殊文件，把源文件夹保留为 ZIP 顶层目录，并要求输出文件位于源文件夹之外。

## Jelly Core 依赖范围

以下操作要求目标站点已安装并激活 Jelly Core：

- 安装和更新插件
- 安装和更新主题
- 激活主题

执行这些变更前，服务会聚合检查全部活动插件。找不到 Jelly Core 时会在上传或修改软件包之前终止。

软件包列表/详情、插件激活/停用使用 WordPress 原生 REST 端点，不依赖 Jelly Core；主题不支持停用。Jelly Core 自定义 REST 路由必须自行校验登录用户能力：兼容用的 `X-Jelly-*` 请求头不含共享秘密，不能当作独立认证机制。

## v2 迁移

v2 是破坏性版本：移除了 `wp-api` CLI、参数解析层、stdin 命令输入以及 CLI 专属输出选项。现有集成需要改为通过 `wp-api-mcp`（或 `npm start`）启动 STDIO MCP 服务，再调用上述结构化工具。凭据从项目内 `config/config.json` 构建到 `build/config/config.json`。

## 开发

```bash
npm run build
npm test
```
