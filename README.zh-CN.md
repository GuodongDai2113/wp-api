# wp-api

一个基于 Node.js 的小型 CLI，用来通过原生 WordPress REST API 管理远程站点内容。

English version: [README.md](./README.md)

当前支持：

- `posts`
- `pages`
- `products`，映射到原生 `/wp/v2/product`
- `categories`
- `product-categories`，映射到原生 `/wp/v2/product_cat`
- 多站点本地 client 管理

认证方式使用原生 WordPress Application Password。

`seo` 更新通过目标资源自己的 WordPress REST `meta` 完成，不依赖 Rank Math 私有 REST 端点。

## 环境要求

- Node.js 20+
- 开启 REST API 的 WordPress 站点
- 具有 Application Password 的 WordPress 用户
- 如果要使用 `seo` 命令，目标资源必须在 REST `meta` 中暴露：
  - `rank_math_title`
  - `rank_math_description`
  - `rank_math_focus_keyword`

## 安装

```bash
npm install
npm link
wp-api client list
```

## 快速开始

添加 client：

```bash
wp-api client add prod \
  --site-url https://example.com \
  --username admin \
  --app-password xxxx\ xxxx\ xxxx\ xxxx\ xxxx\ xxxx
```

切换当前 client：

```bash
wp-api client use prod
```

查看已保存的 client：

```bash
wp-api client list
wp-api client list --json
```

文本输出只显示激活标记和 client 名称：

```text
Active client: prod
* prod
- staging
```

## Client

配置默认保存在：

```text
~/.wp-api/config.json
```

常用命令：

```bash
wp-api client
wp-api client add <name> --site-url <url> --username <user> --app-password <password>
wp-api client list [--json]
wp-api client use <name>
wp-api client remove <name>
```

`wp-api client` 不带子命令时，文本模式只返回当前激活的 client 名称；加 `--json` 时返回完整 client 对象。

## 资源命令

支持的资源：

```bash
wp-api posts ...
wp-api pages ...
wp-api products ...
wp-api categories ...
wp-api product-categories ...
```

支持的动作：

```bash
list
get <id>
create
update <id>
delete <id>
```

额外支持：

```bash
seo <resource> <id>
links add <post-id>
```

全局参数可以写在资源命令前面：

```bash
wp-api --client prod posts list
wp-api --site-url https://override.example.com posts list
```

全局参数：

- `--client <name>`：临时使用某个已保存 client
- `--site-url <url>`：本次命令临时覆盖站点地址
- `--json`：输出 JSON
- `--verbose`：将请求信息输出到 stderr

支持 `list` 的资源都适用相同的分页行为，包括：

- `posts`
- `pages`
- `products`
- `categories`
- `product-categories`

`seo` 也支持同样这一组资源。

## Posts、Pages、Products

这三类资源共用内容型参数。

### List

```bash
wp-api posts list --search hello --page 2 --per-page 10
wp-api pages list --status publish
wp-api posts list --per-page -1
wp-api products list --status publish --json
```

支持的筛选参数：

- `--search <text>`
- `--page <number>`
- `--per-page <number>`
- `--status <status>`

特殊行为：

- `--per-page -1`：自动抓取所有分页并合并返回

### Get

```bash
wp-api posts get 42
wp-api pages get 7
wp-api products get 9 --json
```

### Create

```bash
wp-api posts create \
  --title "Hello World" \
  --status draft \
  --slug hello-world \
  --excerpt "Short summary"
```

```bash
wp-api pages create \
  --title "About Us" \
  --status draft \
  --content-file ./about.md
```

从本地 HTML 文件创建，并在上传前转换为古腾堡区块：

```bash
wp-api posts create \
  --title "HTML Article" \
  --content-file ./article.html \
  --gutenberg
```

```bash
wp-api products create \
  --title "Widget A" \
  --status publish \
  --content-file ./product.md
```

从 stdin 管道读取正文：

```bash
echo "Long body content" | wp-api posts create --title "Piped Post" --status draft
```

### Update

```bash
wp-api posts update 42 --title "Updated Title" --status publish
wp-api pages update 7 --title "About" --content-file ./about-v2.md
wp-api products update 9 --content-file ./new-body.md
```

支持的内容参数：

- 通用内容参数：
  - `--title <text>`
  - `--slug <slug>`
  - `--status <status>`
  - `--excerpt <text>`
  - `--content <text>`
  - `--content-file <path>`
  - `--gutenberg`
- 面向文章分类的参数：
  - `--categories <id,id,...>`

`products` 当前使用原生 `product` REST 端点，但 CLI 还没有单独提供为产品直接指定 `product_cat` 的参数。

正文优先级：

1. `--content`
2. `--content-file`
3. stdin

`--gutenberg` 是显式开启参数。传入后，会把最终解析出的正文从 HTML 转换为 WordPress Gutenberg 区块标记，再发送 create 或 update 请求；它对 `--content`、`--content-file` 和 stdin 都生效。不传 `--gutenberg` 时，正文保持原样提交。

MCP 的 `wp_resource_create` 和 `wp_resource_update` 可通过 `gutenberg: true` 启用同样行为。

### Delete

```bash
wp-api posts delete 42
wp-api posts delete 42 --force
wp-api pages delete 7
wp-api products delete 9
```

`posts`、`pages`、`products` 默认软删除；如果接口支持永久删除，可加 `--force`。

## Categories

分类使用 taxonomy 风格参数。

### List / Get

```bash
wp-api categories list
wp-api categories get 15 --json
```

### Create / Update

```bash
wp-api categories create --name News --slug news --description "Site news"
wp-api categories update 15 --name Updates --parent 3
```

支持参数：

- `--name <text>`
- `--slug <slug>`
- `--description <text>`
- `--parent <id>`

### Delete

```bash
wp-api categories delete 15
```

taxonomy 默认永久删除，因为 WordPress taxonomy 端点不支持回收站。

## Product Categories

产品分类使用原生 `product_cat` taxonomy，参数与普通分类一致。

### List / Get

```bash
wp-api product-categories list
wp-api product-categories get 15 --json
```

### Create / Update

```bash
wp-api product-categories create --name Meters --slug meters --description "Product category"
wp-api product-categories update 15 --name "Digital Meters" --parent 3
```

### Delete

```bash
wp-api product-categories delete 15
```

支持参数：

- `--name <text>`
- `--slug <slug>`
- `--description <text>`
- `--parent <id>`

taxonomy 默认永久删除，因为 WordPress taxonomy 端点不支持回收站。

## SEO

`seo` 命令通过对应资源自己的 WordPress REST 端点读写 Rank Math meta，不再依赖 Rank Math 私有 REST 端点。

命令格式：

```bash
wp-api seo <resource> <id>
```

支持的资源：

- `posts`
- `pages`
- `products`
- `categories`
- `product-categories`

支持字段：

- `rank_math_title`
- `rank_math_description`
- `rank_math_focus_keyword`

### 读取 SEO

不带 SEO 参数时，读取当前值：

```bash
wp-api seo posts 42
wp-api seo pages 7
wp-api seo products 9
wp-api seo categories 15
wp-api seo product-categories 15 --json
```

### 更新 SEO

```bash
wp-api seo posts 42 \
  --title "SEO Title" \
  --description "SEO Description" \
  --focus-keyword "focus keyword"
```

```bash
wp-api seo products 9 \
  --title "Product SEO Title" \
  --description "Product SEO Description" \
  --focus-keyword "product keyword"
```

```bash
wp-api seo categories 15 --description "Category SEO description"
wp-api seo product-categories 15 --description "Product category SEO description"
```

支持参数：

- `--title <text>` -> `rank_math_title`
- `--description <text>` -> `rank_math_description`
- `--focus-keyword <text>` -> `rank_math_focus_keyword`

### SEO 的 REST 前提

- `posts`、`pages`：需要在 REST `meta` 中暴露 `rank_math_*`
- `products`：自定义 post type 必须支持 `custom-fields`，否则 REST schema 不会包含 `meta`
- `categories`、`product-categories`：需要对 term meta 做 REST 注册
- 如果你使用本地 `jelly-seo` 插件，它可以提供这组字段的 REST 白名单

## Links

`links add` 用于更新单篇 WordPress 文章。命令会先读取文章当前正文，把第一处精确匹配的文本替换成 `a` 标签，然后通过原生 posts 端点写回正文。

命令格式：

```bash
wp-api links add <post-id> --text <text> --href <url>
```

示例：

```bash
wp-api links add 42 --text "OpenAI" --href "https://openai.com"
wp-api links add 42 --text "OpenAI" --href "https://openai.com" --json
```

行为：

- 只支持 `posts`。
- 必定先读取文章，再更新文章。
- 优先使用 `content.raw`；没有时使用 `content.rendered`。
- 匹配按用户输入原样执行，区分大小写。
- 只考虑第一处精确匹配。
- 如果第一处匹配已经在 `<a>...</a>` 内，不发送更新请求。
- `--href` 必须非空，但第一版不做 URL 规范化或协议限制。

## 输出与错误

默认输出为可读文本。

`list` 命令的文本输出会带分页摘要：

```text
Total 11, 6 pages, fetched 2 items, current page 2
```

使用 `--per-page -1` 时，`current page` 会显示为 `all`。

脚本场景建议使用：

```bash
wp-api posts list --json
```

WordPress API 错误格式：

```text
HTTP <status> <wp_error_code>: <message>
```

例如：

```text
HTTP 401 rest_forbidden: Sorry, you are not allowed to do that.
```

网络或 TLS 错误会带上请求上下文和底层错误原因。

例如：

```text
Request failed: GET https://example.com/wp-json/wp/v2/posts | Reason: fetch failed | Code: DEPTH_ZERO_SELF_SIGNED_CERT | Cause: self-signed certificate
```

如果本地站点使用受信任的本地 CA，通常可以这样处理证书问题：

```powershell
$env:NODE_OPTIONS='--use-system-ca'
wp-api posts list
```

## 开发

运行测试：

```bash
npm test
```

构建运行时 JavaScript 文件：

```bash
npm run build
```

源码位于 `src/**/*.ts`。运行入口 `build/bin/` 与库代码一同从 TypeScript 编译而来。

当前测试覆盖包括：

- client 持久化与切换
- Application Password 认证头
- posts / pages / products / categories / product-categories 的端点映射
- `--per-page -1` 的自动分页聚合
- 分页摘要文本输出
- post type 与 taxonomy 的 SEO 读写流程
- CLI 解析与 CRUD 流程
- stdin / 文件输入
- 对解析后正文显式开启的古腾堡转换
- WordPress 与网络错误输出

## 说明与限制

- `products` 不是 WooCommerce 端点，而是原生 `/wp-json/wp/v2/product`
- `product-categories` 使用原生 `/wp-json/wp/v2/product_cat`
- CLI 当前只支持 `posts`、`pages`、`products`、`categories`、`product-categories`，`seo` 也只支持这些资源
- `seo` 是否可用，取决于目标资源是否正确暴露 REST `meta`
- 对 `product` 这类自定义 post type，必须启用 `custom-fields` 支持
- 如果本地 HTTPS 使用自签名证书，可以信任本地 CA 后配合 `NODE_OPTIONS=--use-system-ca`，或者本地验证时临时改用 `--site-url http://...`
- 当前没有交互式提示模式
- 本地配置是明文 JSON，机器和用户账户本身需要做好保护
