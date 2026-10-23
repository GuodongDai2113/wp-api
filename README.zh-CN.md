# wp-api

一个纯 [Model Context Protocol](https://modelcontextprotocol.io/) 服务，通过 WordPress 原生 REST API 以及 Jelly Core、Jelly Catalog 和 Inquiry REST API 管理站点。服务使用 STDIO 传输，提供 55 个结构化工具，覆盖 client、本地结构指南、实时 REST 接口结构查询、内容、导航菜单、SEO、Elementor 页面、媒体、插件/主题及询价管理。

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

除独立公开查询工具 `wp_api_route` 外，所有远端工具都要求显式传入 `client`，并接受可选的 `siteUrl`。认证请求中的 `siteUrl` 只能修改已保存 URL 同一 origin 下的路径。`wp_api_route` 不接受这两个字段，只接受裸 `domain`，固定拼接 HTTPS 地址且绝不发送已保存凭据。

## 工具列表

服务共暴露 55 个工具。

### Client 配置（2 个）

- `wp_client_list`：列出全部连接名称和站点 URL，不返回用户名或密码。
- `wp_client_get`：返回一个指定连接的名称和站点 URL，不存在时直接报错。

### 本地结构与 REST 接口查询（2 个）

- `wp_structure_get`：按需查询 `post`、`page`、`product`、`category`、`product-category`、`menu`、`media`、`seo-meta` 和 Elementor 结构。指定 `section: "write"`、`"response"` 或 `"example"` 只返回所需片段；默认返回概览，`"full"` 才返回完整定义。该工具纯本地且不要求 WordPress client。
- `wp_api_route`：必填裸域名 `domain`，固定使用公开 HTTPS，不读取已保存凭据。默认 `detail: "overview"` 只返回命名空间和路由数量；已知 `apiPath` 时只返回方法及参数、字段数量。用 `search` 或 `section: "routes"` 查找路由；指定路径后，用 `section: "arguments"`（可加 `httpMethod: "POST"`）或 `section: "fields"` 获取分页名称目录，再加 `names: ["meta"]` 和 `detail: "full"` 仅获取所需完整定义。已知路径和名称可直接读取，无需逐级调用。目录默认每页 20 条，支持 `search/offset/limit`。迁移：显式 `detail: "summary"` 且不指定 section 保留旧版摘要（根目录默认 50 条）；`detail: "full"` 且不指定 section 保留原始响应。分页减少上下文输出，不减少上游下载。

### WordPress 资源（8 个）

- `wp_resource_count`：从分页响应头读取筛选后的资源总数和总页数。
- `wp_resource_list`：返回一页筛选结果，并可按每页 100 条把全部匹配资源导出为对应类型的 CSV。
- `wp_resource_get`：按 ID 读取单个资源。
- `wp_resource_create`：创建内容或分类项。
- `wp_resource_batch_create`：通过 `batch/v1` 每 25 条创建内联或 CSV 导入资源，来源 ID 不发送给 WordPress。
- `wp_resource_update`：更新内容或分类项。
- `wp_resource_batch_update`：通过 `batch/v1` 每 25 条按 ID 更新内联或 CSV 导入资源。
- `wp_resource_delete`：把内容移入回收站，或永久删除分类项。

所有资源工具都使用 `target: { type, resource }` 定位资源。`type: "post"` 对应 `posts`、`pages`、`products`，`type: "taxonomy"` 对应 `categories`、`product-categories`；不匹配的组合会被拒绝。单条创建/更新把业务字段放在 `data` 中，批量内联条目使用 `{ id?, data }`，从而把资源定位、操作参数和写入数据明确分开。`categories` 根据目标自动映射：文章写入 REST `categories`，Jelly Catalog 产品写入 REST `product_cat`，页面不支持该字段。MCP 不提供 `product_tag` 资源或产品标签写入。需要字段约束时用 `wp_api_route` 查询对应 REST 接口。分类和产品分类没有回收站，删除时必须显式传入 `force: true`。资源列表始终使用 `perPage: 1..100` 的有界分页。

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

### 经典导航菜单（8 个）

- `wp_menu_list`：列出菜单，并同时返回当前主题注册的菜单位置及其分配状态。
- `wp_menu_get`：读取一个菜单及其全部有序、可编辑菜单项。
- `wp_menu_create`、`wp_menu_update`、`wp_menu_delete`：管理菜单和主题位置分配；删除菜单必须传 `force: true`。
- `wp_menu_item_create`、`wp_menu_item_update`、`wp_menu_item_delete`：管理自定义链接、文章、分类和文章类型归档菜单项，包括层级与顺序。

分配 `locations` 前先调用 `wp_menu_list`，因为更新会替换该菜单的全部位置分配。调整 `parent` 或 `menuOrder` 前先调用 `wp_menu_get`。菜单项默认进入回收站，传 `force: true` 才永久删除。

### SEO、链接与媒体（8 个）

- `wp_seo_get`：读取 Rank Math 标题、描述和焦点关键词。
- `wp_seo_update`：更新或显式清空 Rank Math REST meta。
- `wp_seo_list`：返回一页筛选后的 SEO 数据，并可把全部匹配项流式导出为 UTF-8 CSV；`resource: "posts"` 且无过滤条件时导出整个站点的文章。
- `wp_seo_batch_update`：通过 `batch/v1` 每 25 条更新内联 SEO 数据，或导入固定四列 CSV。
- `wp_link`：列出、新增、更新或删除文章、页面和产品可编辑正文中的链接。
- `wp_media_upload`：本地 JPEG/PNG 先压缩为 WebP 再上传，GIF/AVIF/WebP 原样上传，并可设置附件元数据。
- `wp_media_alt_update`：按附件 ID 更新媒体库中已有图片的替代文本，传入空字符串可清除。
- `wp_media_upload` 及批量导入的每个条目支持 `post: 文章ID`，在首次上传时关联父文章，不增加关联请求；`post: 0` 表示不关联。目标文章及编辑权限由 WordPress 校验。
- `wp_media_batch_import`：传入 `items` 数组（1～100 项），每项使用单文件上传字段 `filePath/title/altText/caption/description/categories`。全部参数和路径先校验，再顺序上传；单项上传失败后继续，返回总数、成功数、失败数和逐项回执。不会自动重试，失败项重试前需核对媒体库，避免重复附件。
- `wp_media_list` / `wp_media_get`：分页筛选媒体库或通过 `mediaId` 读取单个附件；单条读取支持 `context: "edit"` 获取可编辑原始字段。
- `wp_media_update`：传入 `mediaId` 和非空 `data`，支持 `title/altText/caption/description/slug/post`；空字符串清空文本，`post: 0` 解除文章关联，不替换原始文件。
- `wp_media_delete`：传入 `mediaId` 和显式 `force: true`，永久删除附件及文件。
- `wp_media_category_list/get/create/update/delete`：管理 Jelly Editor 媒体分类，接口为 `wp/v2/media_category`；创建/更新使用 `data: { name?, slug?, description?, parent? }`，创建必填名称；单条操作使用 `categoryId`，删除必须 `force: true`，不删除媒体文件。
- 上传可直接传 `categories: [分类ID]`，同一次工具调用完成上传和分类设置；更新传 `data.categories` 替换全部分类，`[]` 清空；列表传 `categories` 按任一分类筛选。需要启用支持 REST 分类的 Jelly Editor 和 Jelly Core；分类管理需要 `manage_categories`，分配需要 `upload_files`。分类列表默认包含空分类。

post 类型资源的 `data` 支持直接传 `content` 或读取本地 `contentFile`；大型 REST meta 可通过包含完整 JSON 对象的 `metaFile` 提交，`meta` 和 `metaFile` 不能同时使用。设置 `gutenberg: true` 后，会先用 HTML5 parser 解析正文，再按明确的标签、属性和 [WordPress 允许协议](https://developer.wordpress.org/reference/functions/wp_allowed_protocols/)列表清理，最后生成 Gutenberg 区块标记。事件属性、内联样式、`javascript:`、`data:` 和活动嵌入内容会被移除；普通未知容器会展开并保留其中的安全文本。媒体扩展名仅支持 `.avif`、`.gif`、`.jpeg`、`.jpg`、`.png`、`.webp`。JPEG 和 PNG 会在内存中以质量 85 转换为 WebP 后再上传；GIF、AVIF 和已有 WebP 保持原格式。

post CSV 表头固定为 `id,title,slug,status,excerpt,content,gutenberg,featuredMedia,categories,meta`；taxonomy CSV 表头固定为 `id,name,slug,description,parent,meta`。post CSV 的 `categories` 列同样根据 `target.resource` 映射到文章分类或产品分类。工具根据 `target.type` 选择并严格校验表头。数组和 `meta` 使用 JSON 单元格；空单元格表示省略字段，`__EMPTY__` 表示显式清空字符串，`[]`、`{}`、`0` 保留原有清空语义。批量条目不支持逐项 `contentFile` 或 `metaFile`。资源 batch 在最多 25 条的基础上还会按实际 JSON UTF-8 大小分块：单次请求不超过 8 MiB，整次调用累计不超过 25 MiB，并在联网前完成校验。

SEO 要求站点安装 Jelly SEO 或等效插件，把 `rank_math_title`、`rank_math_description`、`rank_math_focus_keyword` 注册为允许认证用户 REST 读写的 string meta，并启用 `show_in_rest`。`wp_seo_list` 的内联结果保持分页（`perPage` 为 `1..100`），传入 `outputFile` 后以每页 100 条导出全部匹配项。资源和 SEO 导出都会根据每页最新的分页头继续或提前结束，并通过排他发布保证不会覆盖执行期间被其他进程创建的目标文件；页码分页仍不提供并发写入下的快照一致性。CSV 表头严格为 `id,rank_math_title,rank_math_description,rank_math_focus_keyword`，导入时空 SEO 单元格表示显式清空；本地 CSV 路径仍受 MCP 允许根目录限制。

### Elementor 页面文件工作流（4 个）

- `wp_elementor_pull`：按 `postId` 拉取完整 Elementor data，写入带站点、页面和基线 revision 的版本化本地 JSON；可指定 `outputFile` 和 `overwrite`，否则在结果目录生成唯一文件。
- `wp_elementor_inspect`：纯本地检查文件摘要、JSON Pointer 或按元素 ID、widget 类型和文本筛选的有界结果，不要求 WordPress client。
- `wp_elementor_edit`：通过最新文件 SHA-256 保护本地并发，按顺序原子执行 settings 更新、元素替换、插入、删除和移动；支持内联 `operations` 或 `operationsFile`。
- `wp_elementor_push`：读取 pull 生成的 `dataFile`，校验来源和远端 revision 后上传完整 `data`，回读验证、刷新缓存并原子更新同一文件的基线。

推荐按 `pull → inspect → edit（可重复）→ push` 操作。inspect 和 edit 只访问本地文件；每次 edit 都必须使用 pull、inspect 或上一次 edit 返回的最新文件 SHA-256。工具保留完整布局、样式和插件扩展字段；远端页面已变化时拒绝覆盖。目标站点必须通过 WordPress REST API（`show_in_rest`）暴露 Elementor 私有页面 meta `_elementor_data`，并在写入响应中返回该值。

### 插件、主题与本地打包（8 个）

- `wp_package_list`：列出已安装的插件或主题。
- `wp_package_get`：读取单个插件或主题。
- `wp_package_install`：从本地 ZIP 安装插件或主题。
- `wp_package_update`：从本地 ZIP 更新插件或主题。
- `wp_package_activate`：激活插件或切换主题。
- `wp_package_deactivate`：停用插件，不支持主题。
- `wp_package_pack_theme`：在本地创建可安装的主题 ZIP。
- `wp_package_pack_plugin`：在本地创建可安装的插件 ZIP。

### Inquiry

- `wp_inquiry_settings_get`：读取接收邮箱、通知、跳转及脱敏后的 SMTP 设置。
- `wp_inquiry_settings_update`：按字段更新接收邮箱、通知、跳转或 SMTP 设置；省略 SMTP 密码时保留原密码。
- `wp_inquiry_list`：分页、搜索并按日期读取非垃圾询价，只读。
- `wp_inquiry_get`：按 ID 读取一条非垃圾询价，只读。

字段约定和操作细节见 [mcp.md](./mcp.md)。

## 安全模型

### 站点 URL 与凭据

- 站点 URL 可以使用 HTTP 或 HTTPS。HTTP Basic Authentication 不提供传输加密，非可信网络应优先使用 HTTPS。
- 站点 URL 不能嵌入用户名/密码，也不能包含 query 或 fragment。
- 认证调用传入的 `siteUrl` 必须和已保存 URL 同源；`wp_api_route` 改用独立裸域名并固定发起公开 HTTPS 请求。
- 携带 WordPress 凭据的请求不会跟随重定向；应直接配置站点的规范 URL。
- 除不读取 client 的 `wp_api_route` 公开查询外，服务使用已保存的 WordPress Application Password 认证。请只授予该 WordPress 用户实际需要的能力。
- 凭据文件默认位于 `~/.wp-api/`，使用 AES-256-GCM 加密；密钥和密文文件均应仅允许当前系统用户访问。
- 文件加密可避免明文误读、打包和日志泄漏，但不能抵御拥有同一系统用户任意文件及代码执行权限的恶意程序。

### 本地路径边界

以下字段会读写本地文件：`contentFile`、`metaFile`、资源和 SEO 的 `csvFile`/`outputFile`、Elementor `outputFile`、`dataFile` 和 `operationsFile`、媒体 `filePath`、软件包 `file`、打包 `folderPath` 和 `outputPath`。

默认情况下，这些路径必须位于 MCP 服务进程的 `cwd` 内。可以通过 `WP_API_ALLOWED_LOCAL_ROOTS` 增加可信根目录，并使用当前平台的路径分隔符：

- Windows：分号，例如 `C:\content;D:\packages`
- Linux/macOS：冒号，例如 `/srv/content:/srv/packages`

服务同时校验词法路径和解析符号链接后的真实路径，不能借助已有符号链接逃逸。配置的根目录必须已存在且确实是目录。允许列表应尽可能收窄：所有获准调用文件工具的 Agent 都能访问这些目录。

MCP 工具的紧凑 JSON 结果超过 8 KiB 时，完整结果不会继续放入 `structuredContent`，而是自动保存到当前工作目录的 `.wp-api-results`，响应只返回文件绝对路径、字节数和 SHA-256。可用 `WP_API_RESULT_DIR` 更改保存目录；该目录会自动作为可信结果文件根目录。结果文件可能包含站点内容，应按需清理并避免提交到版本库。8 KiB 是本项目的会话内联策略，不是 MCP 或 WordPress 的硬限制。

允许列表是应用层边界，不是操作系统沙箱。应确保不受信任的本地用户或进程不能在工具执行期间修改获准目录；否则从路径校验到实际文件访问之间仍存在操作系统层面的路径替换竞态。

### 默认资源上限

| 边界 | 默认值 |
| --- | ---: |
| 单次网络请求超时 | 30 秒 |
| 单个 WordPress REST 响应 | 25 MiB |
| 单个 `contentFile` | 25 MiB |
| 单个 `metaFile` | 10 MiB JSON |
| 单个媒体文件 | 50 MiB |
| 单个插件/主题 ZIP | 100 MiB |
| 单个 Elementor data | 100 MiB JSON、100,000 个元素、100 层；可由 `WP_API_MAX_ELEMENTOR_DATA_BYTES` 调整 |
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

软件包列表/详情、插件激活/停用使用 WordPress 原生 REST 端点，不依赖 Jelly Core；主题不支持停用。Jelly Core 1.4.0 的变更路由同时要求具备对应能力的 WordPress 应用密码用户和协议内置固定 HMAC 密钥。MCP 自动使用该固定密钥，对请求方法、REST 路由、Unix 时间戳、随机 Nonce 和原始请求体 SHA-256 进行签名；服务端仅接受 5 分钟时间窗内且未使用过的 Nonce，无需额外配置密钥。

## 凭据存储迁移

当前版本移除了 `wp_client_add`、`wp_client_use`、当前连接状态、构建时复制明文凭据以及 UI 明文导入功能。请运行 `wp-api-config` 重新录入连接，并在远端工具中显式传入已保存的 `client` 名称。每台主机都需要单独配置自己的凭据库。

## 开发

落盘结果新增 `wp_result_read`，凭当前服务签发的 resultId 按 JSON Pointer、字段及数组区间读取；使用 nextOffset 续读，不接受任意路径。默认一小时 TTL、128 MiB **当前会话容量**、单文件 25 MiB，惰性清理只作用于本会话登记文件，重启遗留文件不会自动删除。详见 [结果读取与生命周期](./RESULT_READING.md)。可运行 `npm run benchmark:result-read -- cost-result-read.json` 回放完整任务。

写入契约迁移：资源 create/update/delete 默认返回基于远端证据的回执，`detail:"full"` 恢复完整实体。资源/SEO 批次区分确认成功/失败与 unknown/not_executed（后两者 success=null），部分失败返回 MCP isError=true 并保留执行汇总，不能据此重跑整批创建。落盘引用新增有界摘要；结果交付失败独立于远端执行状态。详见 [恢复契约与测量报告](./COST_P1_RECOVERY.md)。


在源码仓库运行 `npm run benchmark:cost -- cost-baseline.json`，可通过固定合成数据测量工具发现、完整 JSON-RPC 响应、上游请求和落盘补读成本，不访问真实 WordPress。报告及统计口径见 [COST_BASELINE.md](./COST_BASELINE.md)。当前只报告字节，不估算 token，也未假定宿主能看到 structuredContent。

给 MCP 服务进程设置 `WP_API_DIAGNOSTICS=1` 可启用每次调用的数值诊断，仅输出 stderr，默认关闭。不记录凭据、URL、输入、正文或错误消息；运行时结果大小不含 SDK 的 JSON-RPC 信封。现有工具返回值和错误语义保持不变。

```bash
npm run build
npm test
```

贡献与验证要求见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题私密报告方式见 [SECURITY.md](./SECURITY.md)，版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

本项目采用 [MIT License](./LICENSE)。
