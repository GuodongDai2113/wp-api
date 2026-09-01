# wp-api

一个纯 [Model Context Protocol](https://modelcontextprotocol.io/) 服务，通过 WordPress 原生 REST API 以及 Jelly Core、Jelly Catalog 和 Jelly Form REST API 管理站点。服务使用 STDIO 传输，提供 34 个结构化工具，覆盖 client、本地结构指南、实时 REST 接口结构查询、内容、SEO、Elementor 页面正文、媒体、插件/主题及询价管理。

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

该命令在 `127.0.0.1` 的随机端口启动临时网页并自动打开浏览器。页面可以新增、编辑、删除和测试连接；密码保存后不再回显。服务显式关闭或空闲 15 分钟后退出。

凭据默认保存在当前用户的 `~/.wp-api/`：`vault.json` 使用 AES-256-GCM 保存包含用户名和密码的密文，`vault.key` 保存每台主机独立生成的随机密钥。可同时为 `wp-api-config` 和 MCP host 设置相同的 `WP_API_CONFIG_DIR` 来覆盖目录。构建产物和 npm 包不包含凭据。

配置页面不读取旧版明文配置。升级时请在页面中重新录入连接，并手动安全删除旧的 `config/config.json`、`build/config/config.json` 或 `*.plaintext-backup`。

凭据库写入使用原子替换和跨进程文件锁。`wp_client_list` 返回全部连接名称和站点 URL；`wp_client_get` 返回一个匹配连接，不存在时直接报错。两个工具都不会返回用户名、密码或密码状态。

除独立公开查询工具 `wp_rest_api` 外，所有远端工具都要求显式传入 `client`，并接受可选的 `siteUrl`。认证请求中的 `siteUrl` 只能修改已保存 URL 同一 origin 下的路径。`wp_rest_api` 不接受这两个字段，只接受裸 `domain`，固定拼接 HTTPS 地址且绝不发送已保存凭据。

## 工具列表

服务共暴露 34 个工具。

### Client 配置（2 个）

- `wp_client_list`：列出全部连接名称和站点 URL，不返回用户名或密码。
- `wp_client_get`：返回一个指定连接的名称和站点 URL，不存在时直接报错。

### 本地结构与 REST 接口查询（2 个）

- `wp_structure_get`：按需查询 `post`、`page`、`product`、`category`、`product-category`、`product-tag`、`media`、`seo-meta` 和 Elementor 结构。指定 `section: "write"`、`"response"` 或 `"example"` 只返回所需片段；默认返回概览，`"full"` 才返回完整定义。该工具纯本地且不要求 WordPress client。
- `wp_rest_api`：必填裸域名 `domain`，例如 `example.com`；工具固定请求 `https://{domain}/...`，不读取 client 或发送凭据。`apiPath` 默认 `wp-json`，用于读取精简、可搜索、可分页的根路由摘要；查到目标路由后传入 `wp-json/wp/v2/product` 等完整 REST 路径，读取方法、参数约束和字段摘要。仅在摘要缺少必要约束时使用 `detail: "full"`。

### WordPress 资源（8 个）

- `wp_resource_count`：从分页响应头读取筛选后的资源总数和总页数。
- `wp_resource_list`：返回一页筛选结果，并可按每页 100 条把全部匹配资源导出为对应类型的 CSV。
- `wp_resource_get`：按 ID 读取单个资源。
- `wp_resource_create`：创建内容或分类项。
- `wp_resource_batch_create`：通过 `batch/v1` 每 25 条创建内联或 CSV 导入资源，来源 ID 不发送给 WordPress。
- `wp_resource_update`：更新内容或分类项。
- `wp_resource_batch_update`：通过 `batch/v1` 每 25 条按 ID 更新内联或 CSV 导入资源。
- `wp_resource_delete`：把内容移入回收站，或永久删除分类项。

所有资源工具都使用 `target: { type, resource }` 定位资源。`type: "post"` 对应 `posts`、`pages`、`products`，`type: "taxonomy"` 对应 `categories`、`product-categories`；不匹配的组合会被拒绝。单条创建/更新把业务字段放在 `data` 中，批量内联条目使用 `{ id?, data }`，从而把资源定位、操作参数和写入数据明确分开。`categories` 根据目标自动映射：文章写入 REST `categories`，Jelly Catalog 产品写入 REST `product_cat`，页面不支持该字段。MCP 不提供 `product_tag` 资源或产品标签写入。写入插件 meta 前可先用 `wp_rest_api` 查看目标站点的实时字段定义。分类和产品分类没有回收站，删除时必须显式传入 `force: true`。资源列表始终使用 `perPage: 1..100` 的有界分页。

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

### SEO、文章内容与媒体（7 个）

- `wp_seo_get`：读取 Rank Math 标题、描述和焦点关键词。
- `wp_seo_update`：更新或显式清空 Rank Math REST meta。
- `wp_seo_list`：返回一页筛选后的 SEO 数据，并可把全部匹配项流式导出为 UTF-8 CSV；`resource: "posts"` 且无过滤条件时导出整个站点的文章。
- `wp_seo_batch_update`：通过 `batch/v1` 每 25 条更新内联 SEO 数据，或导入固定四列 CSV。
- `wp_post_link`：列出、新增、更新或删除可编辑文章正文中的链接。
- `wp_post_content_replace`：替换文章中的所有精确文本匹配。
- `wp_media_upload`：本地 JPEG/PNG 先压缩为 WebP 再上传，GIF/AVIF/WebP 原样上传，并可设置附件元数据。

post 类型资源的 `data` 支持直接传 `content` 或读取本地 `contentFile`；大型 REST meta 可通过包含完整 JSON 对象的 `metaFile` 提交，`meta` 和 `metaFile` 不能同时使用。设置 `gutenberg: true` 后，会先用 HTML5 parser 解析正文，再按明确的标签、属性和 [WordPress 允许协议](https://developer.wordpress.org/reference/functions/wp_allowed_protocols/)列表清理，最后生成 Gutenberg 区块标记。事件属性、内联样式、`javascript:`、`data:` 和活动嵌入内容会被移除；普通未知容器会展开并保留其中的安全文本。媒体扩展名仅支持 `.avif`、`.gif`、`.jpeg`、`.jpg`、`.png`、`.webp`。JPEG 和 PNG 会在内存中以质量 85 转换为 WebP 后再上传；GIF、AVIF 和已有 WebP 保持原格式。

post CSV 表头固定为 `id,title,slug,status,excerpt,content,gutenberg,featuredMedia,categories,meta`；taxonomy CSV 表头固定为 `id,name,slug,description,parent,meta`。post CSV 的 `categories` 列同样根据 `target.resource` 映射到文章分类或产品分类。工具根据 `target.type` 选择并严格校验表头。数组和 `meta` 使用 JSON 单元格；空单元格表示省略字段，`__EMPTY__` 表示显式清空字符串，`[]`、`{}`、`0` 保留原有清空语义。批量条目不支持逐项 `contentFile` 或 `metaFile`。资源 batch 在最多 25 条的基础上还会按实际 JSON UTF-8 大小分块：单次请求不超过 8 MiB，整次调用累计不超过 25 MiB，并在联网前完成校验。

SEO 要求站点安装 Jelly SEO 或等效插件，把 `rank_math_title`、`rank_math_description`、`rank_math_focus_keyword` 注册为允许认证用户 REST 读写的 string meta，并启用 `show_in_rest`。`wp_seo_list` 的内联结果保持分页（`perPage` 为 `1..100`），传入 `outputFile` 后以每页 100 条导出全部匹配项。资源和 SEO 导出都会根据每页最新的分页头继续或提前结束，并通过排他发布保证不会覆盖执行期间被其他进程创建的目标文件；页码分页仍不提供并发写入下的快照一致性。CSV 表头严格为 `id,rank_math_title,rank_math_description,rank_math_focus_keyword`，导入时空 SEO 单元格表示显式清空；本地 CSV 路径仍受 MCP 允许根目录限制。

### Elementor 页面正文（3 个）

- `wp_elementor_get`：只对 `pages` 生效；默认返回页面 `revision`、包含正文的元素 ID 与可修改 settings，可用 `searchText` 定位旧标题或文本；`view: "data"` 会把完整树保存为本地结果文件用于备份或导入。
- `wp_elementor_update`：把最新读取的 `revision` 作为 `expectedRevision`，按 `elementId` 局部合并现有正文字段，可使用内联 `changes` 或本地 JSON `changesFile`；拒绝过期或非正文修改，并在保存后自动刷新 Elementor 缓存。
- `wp_elementor_import`：从本地 `dataFile` 读取完整元素树、覆盖页面并自动刷新 Elementor 缓存；文件可包含原始元素数组或落盘后的 `wp_elementor_get` data 结果。

目标站点必须通过 WordPress REST API（`show_in_rest`）暴露 Elementor 私有页面 meta `_elementor_data`，并在写入响应中返回该值；站点侧桥接还应通过 Elementor document 层保存，或主动失效其生成数据与元素缓存。REST meta 集成缺失时工具会明确失败，不会把隐藏数据误判为空页面。

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
- 认证调用传入的 `siteUrl` 必须和已保存 URL 同源；`wp_rest_api` 改用独立裸域名并固定发起公开 HTTPS 请求。
- 携带 WordPress 凭据的请求不会跟随重定向；应直接配置站点的规范 URL。
- 除不读取 client 的 `wp_rest_api` 公开查询外，服务使用已保存的 WordPress Application Password 认证。请只授予该 WordPress 用户实际需要的能力。
- 凭据文件默认位于 `~/.wp-api/`，使用 AES-256-GCM 加密；密钥和密文文件均应仅允许当前系统用户访问。
- 文件加密可避免明文误读、打包和日志泄漏，但不能抵御拥有同一系统用户任意文件及代码执行权限的恶意程序。

### 本地路径边界

以下字段会读写本地文件：`contentFile`、`metaFile`、资源和 SEO 的 `csvFile`/`outputFile`、Elementor `changesFile` 和 `dataFile`、媒体 `filePath`、软件包 `file`、打包 `folderPath` 和 `outputPath`。

默认情况下，这些路径必须位于 MCP 服务进程的 `cwd` 内。可以通过 `WP_API_ALLOWED_LOCAL_ROOTS` 增加可信根目录，并使用当前平台的路径分隔符：

- Windows：分号，例如 `C:\content;D:\packages`
- Linux/macOS：冒号，例如 `/srv/content:/srv/packages`

服务同时校验词法路径和解析符号链接后的真实路径，不能借助已有符号链接逃逸。配置的根目录必须已存在且确实是目录。允许列表应尽可能收窄：所有获准调用文件工具的 Agent 都能访问这些目录。

MCP 工具的紧凑 JSON 结果超过 8 KiB 时，完整结果不会继续放入 `structuredContent`，而是自动保存到当前工作目录的 `.wp-api-results`，响应只返回文件绝对路径、字节数和 SHA-256。可用 `WP_API_RESULT_DIR` 更改保存目录；如果之后要把该目录中的文件作为工具输入，目录还必须位于 `cwd` 或 `WP_API_ALLOWED_LOCAL_ROOTS` 中。结果文件可能包含站点内容，应按需清理并避免提交到版本库。8 KiB 是本项目的会话内联策略，不是 MCP 或 WordPress 的硬限制。

允许列表是应用层边界，不是操作系统沙箱。应确保不受信任的本地用户或进程不能在工具执行期间修改获准目录；否则从路径校验到实际文件访问之间仍存在操作系统层面的路径替换竞态。

### 默认资源上限

| 边界 | 默认值 |
| --- | ---: |
| 单次网络请求超时 | 30 秒 |
| 单个 WordPress REST 响应 | 25 MiB |
| 单个 `contentFile` | 25 MiB |
| 单个 `metaFile` 或 `changesFile` | 10 MiB JSON |
| 单个媒体文件 | 50 MiB |
| 单个插件/主题 ZIP | 100 MiB |
| 单个 Elementor 元素树 | 10 MiB JSON、10,000 个元素、100 层 |
| 资源 CSV 导入 | 25 MiB |
| 单个资源 batch 请求 | 8 MiB JSON |
| 单次资源 batch 调用 | 25 MiB 累计 JSON |
| 本地打包源目录 | 20,000 个条目且未压缩文件共 512 MiB |

上传的软件包必须使用 `.zip` 扩展名并具有可识别的 ZIP 文件头。本地打包会拒绝符号链接和特殊文件，把源文件夹保留为 ZIP 顶层目录，并要求输出文件位于源文件夹之外。

## Jelly Core 依赖范围

以下操作要求目标站点已安装并激活 Jelly Core：

- 安装和更新插件
- 安装和更新主题
- 激活主题

执行这些变更前，服务会逐页检查活动插件。找不到 Jelly Core 时会在上传或修改软件包之前终止。

软件包列表/详情、插件激活/停用使用 WordPress 原生 REST 端点，不依赖 Jelly Core；主题不支持停用。Jelly Core 自定义 REST 路由必须自行校验登录用户能力：兼容用的 `X-Jelly-*` 请求头不含共享秘密，不能当作独立认证机制。

## 凭据存储迁移

当前版本移除了 `wp_client_add`、`wp_client_use`、当前连接状态、构建时复制明文凭据以及 UI 明文导入功能。请运行 `wp-api-config` 重新录入连接，并在远端工具中显式传入已保存的 `client` 名称。每台主机都需要单独配置自己的凭据库。

## 开发

```bash
npm run build
npm test
```

贡献与验证要求见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题私密报告方式见 [SECURITY.md](./SECURITY.md)，版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

本项目采用 [MIT License](./LICENSE)。
