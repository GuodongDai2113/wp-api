# wp-api

一个纯 [Model Context Protocol](https://modelcontextprotocol.io/) 服务，通过 WordPress 原生 REST API 以及 Jelly Core、Jelly Catalog 和 Jelly Form REST API 管理站点。服务使用 STDIO 传输，提供 32 个结构化工具，覆盖 client、本地结构指南、实时 REST 接口结构查询、内容、SEO、Elementor、媒体、插件/主题及询价管理。

English documentation: [README.md](./README.md) · MCP 详细配置：[mcp.md](./mcp.md)

`wp-api-mcp` 是 STDIO 服务入口，`wp-api-config` 是只监听本机回环地址的一次性凭据配置页面。

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

通过 `npm link` 或全局安装后，可以直接使用两个可执行入口：

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
WP_API_CONFIG_DIR = "C:/Users/your-name/.wp-api"
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

不要把用户名或 Application Password 发送给 Agent。请在每台运行 MCP 的主机上由管理员执行：

```bash
wp-api-config
```

该命令在 `127.0.0.1` 的随机端口启动临时网页并自动打开浏览器。页面可以新增、编辑、删除、测试连接和选择默认连接；密码保存后不再回显。服务显式关闭或空闲 15 分钟后退出。

凭据默认保存在当前用户的 `~/.wp-api/`：`vault.json` 使用 AES-256-GCM 保存包含用户名和密码的密文，`vault.key` 保存每台主机独立生成的随机密钥。可同时为 `wp-api-config` 和 MCP host 设置相同的 `WP_API_CONFIG_DIR` 来覆盖目录。构建产物和 npm 包不包含凭据。

配置页面不读取旧版明文配置。升级时请在页面中重新录入连接，并手动安全删除旧的 `config/config.json`、`build/config/config.json` 或 `*.plaintext-backup`。

凭据库写入使用原子替换和跨进程文件锁。`wp_client_list` 只返回连接名称、站点 URL 和默认连接名称；用户名、密码及密码状态都不会通过 MCP 返回。

所有远端工具都接受可选的 `client` 和 `siteUrl`。`client` 可以在不改变当前激活项的情况下选用另一个已保存连接；`siteUrl` 只能修改已保存 URL 同一 origin 下的路径，不能把已保存凭据转发到其他主机。

## 工具列表

服务共暴露 32 个工具。

### Client 配置（2 个）

- `wp_client_use`：设置当前激活的连接。
- `wp_client_list`：列出连接及当前激活名称，不返回用户名或密码。

### 本地结构与 REST 接口查询（2 个）

- `wp_structure_get`：查询 `post`、`page`、`product`、`category`、`product-category`、`media`、`seo-meta`、`elementor-page`、`elementor-element` 的稳定使用结构；省略 `structure` 时列出目录。该本地工具不要求已保存 WordPress client。
- `wp_api_schema`：省略 `apiPath` 时读取精简、可搜索、可分页的 `/wp-json/` 路由摘要，默认返回 50 条并支持 `search`、`offset`、`limit`；传入 `wp/v2/product` 等相对路径时读取实时 `OPTIONS` schema。仅在确实需要 WordPress 原始完整响应时使用 `detail: "full"`。

### WordPress 资源（5 个）

- `wp_resource_list`：列出文章、页面、分类或 Jelly Catalog 产品、产品分类与产品标签。
- `wp_resource_get`：按 ID 读取单个资源。
- `wp_resource_create`：创建内容或分类项。
- `wp_resource_update`：更新内容或分类项。
- `wp_resource_delete`：把内容移入回收站，或永久删除分类项。

`resource` 支持 `posts`、`pages`、`products`、`categories`、`product-categories`、`product-tags`；其中产品相关资源专指 Jelly Catalog，不代表 WooCommerce 产品。产品写入支持 `productCategories`、`productTags` 和已注册的 `meta` 字段，写入前可先用 `wp_api_schema` 查看目标站点的实时字段定义。分类、产品分类和产品标签没有回收站，删除时必须显式传入 `force: true`。`perPage: -1` 会在下文资源上限内自动聚合全部分页。

常用 Jelly Catalog 产品 `meta` 结构：

| 字段 | 结构 | 用途 |
| --- | --- | --- |
| `_product_sku` | `string` | 规范的产品型号或 SKU。 |
| `_product_videourl` | `string` | 产品视频绝对 URL。 |
| `product_file` | 非负 `integer` | 下载附件 ID，`0` 表示清空。 |
| `_product_image_gallery` | 逗号分隔附件 ID `string` | 例如 `"12,18,24"`，`""` 表示清空。 |
| `_product_attributes` | `{name:string,value:string}[]` | 产品规格属性行。 |
| `_product_faqs` | `{name:string,value:string}[]` | FAQ 行，`name` 是问题，`value` 是答案。 |

产品分类 `meta` 还包括 `thumbnail_id`、`banner_id`、标题字段、HTML 营销内容、`category_applications`、`product_cat_faqs`，以及取值为 `"0" | "1"` 的 `category_inherit_parent_content`。其他插件仍可能追加字段，因此应以目标站点实时返回的 OPTIONS 结果为准。

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

- 站点 URL 可以使用 HTTP 或 HTTPS。HTTP Basic Authentication 不提供传输加密，非可信网络应优先使用 HTTPS。
- 站点 URL 不能嵌入用户名/密码，也不能包含 query 或 fragment。
- 每次调用传入的 `siteUrl` 必须和已保存 URL 同源。
- 携带 WordPress 凭据的请求不会跟随重定向；应直接配置站点的规范 URL。
- 服务使用已保存的 WordPress Application Password 认证。请只授予该 WordPress 用户实际需要的能力。
- 凭据文件默认位于 `~/.wp-api/`，使用 AES-256-GCM 加密；密钥和密文文件均应仅允许当前系统用户访问。
- 文件加密可避免明文误读、打包和日志泄漏，但不能抵御拥有同一系统用户任意文件及代码执行权限的恶意程序。

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

## 凭据存储迁移

当前版本移除了 `wp_client_add`、构建时复制明文凭据以及 UI 明文导入功能。请运行 `wp-api-config` 重新录入连接，再让 MCP host 使用 `wp_client_use` 或页面设置的默认连接。每台主机都需要单独配置自己的凭据库。

## 开发

```bash
npm run build
npm test
```

贡献与验证要求见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题私密报告方式见 [SECURITY.md](./SECURITY.md)，版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

本项目采用 [MIT License](./LICENSE)。
