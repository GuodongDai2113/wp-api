# wp-api

A small Node.js CLI for managing remote WordPress content through the native REST API.

Chinese version: [README.zh-CN.md](./README.zh-CN.md)

Current scope:

- `posts`
- `pages`
- `products` mapped to the native `/wp/v2/product` endpoint
- `categories`
- `product-categories` mapped to the native `/wp/v2/product_cat` endpoint
- local client management for multiple WordPress sites

Authentication uses native WordPress Application Passwords.

SEO updates use the standard WordPress REST `meta` payload on the target resource endpoint. No Rank Math private REST endpoint is required.

## Requirements

- Node.js 20+
- A WordPress site with REST API access
- A WordPress user with an Application Password
- For `seo` commands, the target resource must expose `rank_math_title`, `rank_math_description`, and `rank_math_focus_keyword` through REST `meta`

## Install

```bash
npm install
npm link
wp-api client list
```

## Quick Start

Add a client:

```bash
wp-api client add prod \
  --site-url https://example.com \
  --username admin \
  --app-password xxxx\ xxxx\ xxxx\ xxxx\ xxxx\ xxxx
```

Set it as the active client:

```bash
wp-api client use prod
```

List saved clients:

```bash
wp-api client list
wp-api client list --json
```

Text output shows only the active marker and client name:

```text
Active client: prod
* prod
- staging
```

## Clients

Clients are stored locally in:

```text
~/.wp-api/config.json
```

Saved client fields:

- `name`
- `siteUrl`
- `username`
- `appPassword`

Commands:

```bash
wp-api client
wp-api client add <name> --site-url <url> --username <user> --app-password <password>
wp-api client list [--json]
wp-api client use <name>
wp-api client remove <name>
```

`wp-api client` without a subcommand returns the currently active client name in text mode, or the full client object with `--json`.

## Resource Commands

Supported resources:

```bash
wp-api posts ...
wp-api pages ...
wp-api products ...
wp-api categories ...
wp-api product-categories ...
```

Supported actions:

```bash
list
get <id>
create
update <id>
delete <id>
```

Additional command group:

```bash
seo <resource> <id>
links add <post-id>
```

Global flags can be placed before the resource command:

```bash
wp-api --client prod posts list
wp-api --site-url https://override.example.com posts list
```

Available global flags:

- `--client <name>`: use a saved client without switching the active one
- `--site-url <url>`: override the client's site URL for the current command
- `--json`: return JSON instead of human-readable output
- `--verbose`: print request information to stderr

List behavior applies to every resource command that supports `list`, including:

- `posts`
- `pages`
- `products`
- `categories`
- `product-categories`

The `seo` command supports these same resources.

## Posts, Pages, and Products

`posts`, `pages`, and `products` share the same content-style flags.

### List

```bash
wp-api posts list --search hello --page 2 --per-page 10
wp-api pages list --status publish
wp-api posts list --per-page -1
wp-api products list --status publish --json
```

Supported list filters:

- `--search <text>`
- `--page <number>`
- `--per-page <number>`
- `--status <status>`

Special `--per-page` behavior:

- `--per-page -1`: fetch all items across every page and merge them into one result

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

```bash
wp-api products create \
  --title "Widget A" \
  --status publish \
  --content-file ./product.md
```

Pipe content from stdin:

```bash
echo "Long body content" | wp-api posts create --title "Piped Post" --status draft
```

### Update

```bash
wp-api posts update 42 --title "Updated Title" --status publish
wp-api pages update 7 --title "About" --content-file ./about-v2.md
wp-api products update 9 --content-file ./new-body.md
```

Supported content flags:

- Shared content flags:
  - `--title <text>`
  - `--slug <slug>`
  - `--status <status>`
  - `--excerpt <text>`
  - `--content <text>`
  - `--content-file <path>`
- Post-oriented taxonomy flag:
  - `--categories <id,id,...>`

`products` currently use the native `product` REST endpoint, but there is no dedicated CLI flag yet for assigning `product_cat` terms directly on product create/update.

Content precedence:

1. `--content`
2. `--content-file`
3. stdin

### Delete

```bash
wp-api posts delete 42
wp-api posts delete 42 --force
wp-api pages delete 7
wp-api products delete 9
```

For content resources like `posts`, `pages`, and `products`, delete is soft delete by default. Use `--force` when the endpoint supports permanent deletion.

## Categories

Categories use taxonomy-style fields.

### List and Get

```bash
wp-api categories list
wp-api categories get 15 --json
```

### Create and Update

```bash
wp-api categories create --name News --slug news --description "Site news"
wp-api categories update 15 --name Updates --parent 3
```

Supported category flags:

- `--name <text>`
- `--slug <slug>`
- `--description <text>`
- `--parent <id>`

### Delete

```bash
wp-api categories delete 15
```

Category deletion is permanent by default because WordPress taxonomy endpoints do not support trashing.

## Product Categories

Product categories use the native `product_cat` taxonomy and share the same taxonomy-style fields as normal categories.

### List and Get

```bash
wp-api product-categories list
wp-api product-categories get 15 --json
```

### Create and Update

```bash
wp-api product-categories create --name Meters --slug meters --description "Product category"
wp-api product-categories update 15 --name "Digital Meters" --parent 3
```

Supported product category flags:

- `--name <text>`
- `--slug <slug>`
- `--description <text>`
- `--parent <id>`

### Delete

```bash
wp-api product-categories delete 15
```

Product category deletion is permanent by default because taxonomy endpoints do not support trashing.

## SEO

The `seo` command reads or updates Rank Math meta fields for an existing supported resource through the same native WordPress REST endpoint used by that resource.

Command shape:

```bash
wp-api seo <resource> <id>
```

Supported SEO fields:

- `rank_math_title`
- `rank_math_description`
- `rank_math_focus_keyword`

Supported SEO resources:

- `posts`
- `pages`
- `products`
- `categories`
- `product-categories`

REST requirements:

- `posts` and `pages` usually work once the `rank_math_*` meta keys are exposed through REST
- `products` must support `custom-fields` in its post type registration, otherwise WordPress will omit `meta` from the REST schema
- taxonomy resources such as `categories` and `product-categories` must expose the same `rank_math_*` keys through term meta REST registration
- if you use the local `jelly-seo` plugin, it can provide the REST whitelist for these keys

### Read SEO fields

If no SEO flags are provided, the command fetches the current values.

```bash
wp-api seo posts 42
wp-api seo pages 7
wp-api seo products 9
wp-api seo categories 15
wp-api seo product-categories 15 --json
```

### Update SEO fields

If one or more SEO flags are provided, the command updates only those fields.

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

Supported SEO flags:

- `--title <text>` -> `rank_math_title`
- `--description <text>` -> `rank_math_description`
- `--focus-keyword <text>` -> `rank_math_focus_keyword`

## Links

`links add` updates a single WordPress post by fetching its current content, replacing the first exact text match with an anchor tag, and writing the changed content back through the native posts endpoint.

Command format:

```bash
wp-api links add <post-id> --text <text> --href <url>
```

Examples:

```bash
wp-api links add 42 --text "OpenAI" --href "https://openai.com"
wp-api links add 42 --text "OpenAI" --href "https://openai.com" --json
```

Behavior:

- Only `posts` are supported.
- The command reads the post before updating it.
- `content.raw` is used when available; otherwise `content.rendered` is used.
- Matching is exact and case-sensitive.
- Only the first exact match is considered.
- If the first match is already inside an `<a>...</a>` element, no update is sent.
- `--href` must be non-empty but is not normalized or scheme-restricted.

## Output and Errors

Default output is human-readable.

For `list` commands, text output includes a pagination summary footer:

```text
Total 11, 6 pages, fetched 2 items, current page 2
```

When `--per-page -1` is used, the footer reports `current page all`.

Use `--json` for script-friendly output:

```bash
wp-api posts list --json
```

WordPress API failures are surfaced as:

```text
HTTP <status> <wp_error_code>: <message>
```

Example:

```text
HTTP 401 rest_forbidden: Sorry, you are not allowed to do that.
```

Network and TLS failures include request context and the underlying cause when available. Example:

```text
Request failed: GET https://example.com/wp-json/wp/v2/posts | Reason: fetch failed | Code: DEPTH_ZERO_SELF_SIGNED_CERT | Cause: self-signed certificate
```

If your local site uses a trusted local CA, you can often resolve certificate errors with:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
wp-api posts list
```

## Development

Run tests:

```bash
npm test
```

Current automated coverage includes:

- client persistence and active client switching
- Application Password auth header generation
- endpoint mapping for posts, pages, categories, product categories, and products
- automatic multi-page aggregation for `--per-page -1`
- list footer output for pagination summaries
- SEO read and update flows for post-type and taxonomy resources
- CLI parsing and CRUD flows
- stdin and file-based content input
- WordPress and network error rendering

## Notes and Limits

- `products` is not WooCommerce. It is the native `/wp-json/wp/v2/product` route.
- Product categories use the native `/wp-json/wp/v2/product_cat` taxonomy route.
- The CLI currently targets only `posts`, `pages`, `products`, `categories`, and `product-categories`, including through `seo`.
- `seo` depends on REST meta exposure. If a resource returns no `meta.rank_math_*` fields, fix the WordPress side first.
- For custom post types like `product`, enabling `custom-fields` support is required for REST `meta` schema support.
- On local HTTPS sites with a self-signed certificate, either trust the local CA and use `NODE_OPTIONS=--use-system-ca`, or temporarily use `--site-url http://...` for local verification.
- There is no interactive prompt mode yet.
- Configuration is stored in plain local JSON. Protect the machine and user account accordingly.
