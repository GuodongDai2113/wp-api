# wp-api

A pure [Model Context Protocol](https://modelcontextprotocol.io/) server for managing WordPress through native, Jelly Core, Jelly Catalog, and Jelly Form REST APIs. It runs over STDIO and exposes 32 structured tools for clients, local structure guidance, live REST schema discovery, content, SEO, Elementor, media, packages, and inquiries.

Chinese documentation: [README.zh-CN.md](./README.zh-CN.md) · Detailed MCP setup: [mcp.md](./mcp.md)

`wp-api-mcp` is the STDIO server entry point. `wp-api-config` opens a temporary loopback-only credential configuration page.

## Requirements

- Node.js 20 or later
- A WordPress site with REST API access
- A WordPress user and [Application Password](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)
- REST permissions appropriate for every operation the MCP client may request
- Rank Math meta fields exposed through REST when using the SEO tools
- Jelly Core installed and active for the package operations listed under [Jelly Core dependency](#jelly-core-dependency)

Product support targets Jelly Catalog, not WooCommerce. The target site must enable Jelly Catalog and expose products and product categories as `/wp-json/wp/v2/product` and `/wp-json/wp/v2/product_cat`. Elementor tools require the corresponding page meta to be readable and writable through REST.

## Install and build

```bash
npm install
npm run build
```

For a direct smoke test, start the compiled STDIO server with:

```bash
npm start
```

`npm start` and `wp-api-mcp` wait for an MCP host on standard input. They do not provide an interactive shell. In normal use, configure the MCP host to launch the process for you.

When the package is linked or installed globally, both executables are available:

```bash
npm link
```

## Connect an MCP host

Use an absolute path and set `cwd` deliberately. The process working directory is also the default boundary for local file tools.

### Codex

Codex reads MCP servers from `~/.codex/config.toml`, or from `.codex/config.toml` in a trusted project. The ChatGPT desktop app, Codex CLI, and Codex IDE extension share this configuration on the same host. See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/).

```toml
[mcp_servers.wp_api]
command = "node"
args = ["C:/absolute/path/to/wp-api/build/bin/wp-api-mcp.js"]
cwd = "C:/absolute/path/to/wp-api"

[mcp_servers.wp_api.env]
WP_API_ALLOWED_LOCAL_ROOTS = "C:/wordpress-content;D:/wordpress-packages"
WP_API_CONFIG_DIR = "C:/Users/your-name/.wp-api"
```

When `wp-api-mcp` is available on `PATH`, the shorter form is:

```toml
[mcp_servers.wp_api]
command = "wp-api-mcp"
cwd = "C:/absolute/path/to/allowed-workspace"
```

### Generic STDIO MCP host

Hosts using the common `mcpServers` JSON shape can use:

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

The exact settings filename is host-specific. Restart or reload the MCP host after changing its configuration.

## First-time client setup

Do not send usernames or Application Passwords through an agent. On every host that runs the MCP server, an administrator should run:

```bash
wp-api-config
```

This starts a temporary page on a random `127.0.0.1` port and opens it in the default browser. The page can add, edit, delete, and test connections. Saved passwords are never displayed again. The service exits explicitly or after 15 minutes of inactivity.

Credentials default to `~/.wp-api/`. `vault.json` contains AES-256-GCM ciphertext for usernames and passwords; `vault.key` contains a random per-host key. Set the same `WP_API_CONFIG_DIR` for `wp-api-config` and the MCP host to override that directory. Builds and npm packages contain no credentials.

The configuration page never reads legacy plaintext configuration. Re-enter connections in the page, then securely remove old `config/config.json`, `build/config/config.json`, or `*.plaintext-backup` files manually.

Vault writes use atomic replacement and a cross-process file lock. `wp_client_list` returns all saved connection names and site URLs; `wp_client_get` returns one matching connection or an error. Neither tool returns usernames, passwords, or password status.

Except for the standalone public `wp_rest_api` query, all remote tools require `client` and accept an optional `siteUrl`. For authenticated requests, `siteUrl` may change only the path on the saved URL's origin. `wp_rest_api` accepts neither field: it requires a bare `domain`, always builds an HTTPS URL, and never sends saved credentials.

## Tools

The server exposes exactly 34 tools.

### Client configuration (2)

- `wp_client_list` — list saved connection names and URLs without usernames or passwords.
- `wp_client_get` — return one saved connection's name and URL, or fail if it does not exist.

### Structure and REST schema discovery (2)

- `wp_structure_get` — query stable usage guidance for WordPress, Jelly Catalog, media, SEO, and Elementor. Request `section: "write"`, `"response"`, or `"example"` directly to receive only that fragment; the default is an overview and `"full"` is the compatibility escape hatch. The local catalog includes `product-tag` and requires no saved client.
- `wp_rest_api` — provide a bare `domain` such as `example.com`; the tool always requests `https://{domain}/...` without reading a client or sending credentials. `apiPath` defaults to `wp-json` for a compact, searchable, paginated route index. After discovering a route, pass a full REST path such as `wp-json/wp/v2/product` for its methods, argument constraints, and fields. Use `detail: "full"` only when required.

### WordPress resources (8)

- `wp_resource_count` — read filtered totals from WordPress pagination headers.
- `wp_resource_list` — return one filtered page and optionally export every match to a type-specific CSV in 100-row pages.
- `wp_resource_get` — read one resource by ID.
- `wp_resource_create` — create content or a taxonomy term.
- `wp_resource_batch_create` — create inline or CSV-imported resources through `batch/v1` in groups of 25; source IDs are not sent to WordPress.
- `wp_resource_update` — update content or a taxonomy term.
- `wp_resource_batch_update` — update inline or CSV-imported resources by ID through `batch/v1` in groups of 25.
- `wp_resource_delete` — trash content or permanently delete a taxonomy term.

Every resource tool identifies its resource with `target: { type, resource }`. `type: "post"` accepts `posts`, `pages`, and `products`; `type: "taxonomy"` accepts `categories` and `product-categories`. Mismatched combinations are rejected. Single create/update calls place writable fields under `data`; inline batch records use `{ id?, data }`, clearly separating resource selection, operation arguments, and writable data. `categories` maps automatically: posts use REST `categories`, Jelly Catalog products use REST `product_cat`, and pages reject the field. MCP does not expose the `product_tag` resource or product-tag assignments. Use `wp_rest_api` first to inspect the target site's current field definitions before writing plugin meta. Category and product-category deletion requires explicit `force: true`, because taxonomy terms have no trash. Resource list pagination is always bounded to `perPage: 1..100`.

Common Jelly Catalog product `meta` structures are:

| Field | Structure | Purpose |
| --- | --- | --- |
| `_product_sku` | `string` | Canonical product model or SKU. |
| `_product_videourl` | `string` | Absolute product video URL. |
| `product_file` | non-negative `integer` | Download attachment ID; `0` clears it. |
| `_product_image_gallery` | comma-separated attachment ID `string` | Gallery such as `"12,18,24"`; `""` clears it. |
| `_product_attributes` | `{name:string,value:string}[]` | Product specification rows. |
| `_product_faqs` | `{name:string,value:string}[]` | FAQ rows where `name` is the question and `value` is the answer. |

Product-category `meta` includes `thumbnail_id`, `banner_id`, headings, HTML marketing sections, `category_applications`, `product_cat_faqs`, and the `"0" | "1"` field `category_inherit_parent_content`. The live OPTIONS result remains authoritative because other active plugins may add fields.

### SEO, post content, and media (7)

- `wp_seo_get` — read Rank Math title, description, and focus keyword fields.
- `wp_seo_update` — update or explicitly clear Rank Math REST meta fields.
- `wp_seo_list` — return one filtered SEO page and optionally stream every matching record to a UTF-8 CSV file; with `resource: "posts"` and no filters, the CSV covers the whole site.
- `wp_seo_batch_update` — update inline SEO records or import the fixed four-column CSV format through `batch/v1` in groups of 25.
- `wp_post_link` — list, add, update, or remove links in editable raw post content.
- `wp_post_content_replace` — replace every exact text occurrence in a post.
- `wp_media_upload` — compress a local JPEG/PNG to WebP before upload, or upload GIF/AVIF/WebP unchanged, and optionally set attachment metadata.

Post resource `data` accepts inline `content` or a local `contentFile`. Large REST meta objects can be submitted through `metaFile`; `meta` and `metaFile` cannot be combined. With `gutenberg: true`, the server parses the resolved body with an HTML5 parser, filters it through explicit tag and attribute allowlists plus the [WordPress allowed protocol](https://developer.wordpress.org/reference/functions/wp_allowed_protocols/) list, and then generates Gutenberg block markup. Event attributes, inline styles, `javascript:`, `data:`, and active embedded content are removed; ordinary unknown containers are unwrapped while their safe text is preserved. Media extensions are limited to `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, and `.webp`. JPEG and PNG inputs are converted in memory to quality-85 WebP before upload; GIF, AVIF, and existing WebP files are left unchanged.

Post CSV columns are exactly `id,title,slug,status,excerpt,content,gutenberg,featuredMedia,categories,meta`; taxonomy CSV columns are exactly `id,name,slug,description,parent,meta`. The post CSV `categories` column maps to post categories or product categories according to `target.resource`. The tool selects and strictly validates the header from `target.type`. Arrays and `meta` use JSON cells. Blank cells are omitted during import, while `__EMPTY__` explicitly clears a string. `[]`, `{}`, and `0` preserve their normal clearing semantics. Batch items do not accept per-item `contentFile` or `metaFile`. Resource batches are split by both the 25-request limit and actual serialized UTF-8 JSON size: each request is at most 8 MiB and one tool call is capped at 25 MiB in total, validated before network access.

SEO requires Jelly SEO or an equivalent site plugin to register `rank_math_title`, `rank_math_description`, and `rank_math_focus_keyword` as writable string meta with `show_in_rest`. `wp_seo_list` keeps its inline response paginated (`perPage` is `1..100`), while `outputFile` exports all matches in 100-row pages. Resource and SEO exports update their stopping point from each page's latest pagination headers and use exclusive publication so a target created concurrently is never overwritten; page-number pagination still cannot provide snapshot consistency during concurrent writes. CSV columns are exactly `id,rank_math_title,rank_math_description,rank_math_focus_keyword`; empty imported SEO cells explicitly clear values. Local CSV paths remain restricted to the configured MCP local roots.

### Elementor page content (3)

- `wp_elementor_get` — pages only; returns a revision, element IDs, and editable content settings by default, accepts `searchText` to locate existing copy, and stores the complete backup tree in a local result file with `view: "data"`.
- `wp_elementor_update` — partially merge existing content settings using the latest read `revision` as `expectedRevision`; accepts inline `changes` or a local JSON `changesFile`, rejects stale or non-content changes, and refreshes the Elementor cache automatically.
- `wp_elementor_import` — read a complete Elementor tree from local `dataFile`, replace the page tree, verify persistence, and refresh the Elementor cache. The file may contain a raw element array or a stored `wp_elementor_get` data result.

The target site must expose Elementor's private `_elementor_data` page meta through the WordPress REST API (`show_in_rest`) and return it after writes. That site-side bridge should save through Elementor's document layer or invalidate Elementor's generated data and element caches. The tools fail explicitly when REST meta access is unavailable instead of treating hidden data as an empty page.

### Plugins, themes, and local packaging (8)

- `wp_package_list` — list installed plugins or themes.
- `wp_package_get` — read one plugin or theme.
- `wp_package_install` — install a plugin or theme from a local ZIP.
- `wp_package_update` — update a plugin or theme from a local ZIP.
- `wp_package_activate` — activate a plugin or switch themes.
- `wp_package_deactivate` — deactivate a plugin; themes are not supported.
- `wp_package_pack_theme` — create an installable theme ZIP locally.
- `wp_package_pack_plugin` — create an installable plugin ZIP locally.

### Jelly Form

- `wp_jelly_form_settings_get` — read the recipient, notification, redirect, and redacted SMTP settings.
- `wp_jelly_form_settings_update` — update selected recipient, notification, redirect, or SMTP fields; omitted SMTP passwords are preserved.
- `wp_jelly_form_inquiry_list` — list and filter non-spam inquiries (read-only).
- `wp_jelly_form_inquiry_get` — read one non-spam inquiry by ID (read-only).

See [mcp.md](./mcp.md) for input conventions and detailed operational notes.

## Security model

### Site URLs and credentials

- Site URLs may use HTTP or HTTPS. HTTP Basic Authentication does not encrypt credentials in transit, so use HTTPS on untrusted networks.
- A site URL cannot contain embedded credentials, a query string, or a fragment.
- Authenticated `siteUrl` overrides must have the same origin as the saved URL; `wp_rest_api` instead uses a standalone bare domain and public HTTPS requests.
- Authenticated WordPress requests do not follow redirects. Configure the canonical site URL instead.
- Except for public `wp_rest_api` requests that never read a client, authentication uses the saved WordPress Application Password; grant that account only the capabilities it needs.
- Credentials default to `~/.wp-api/` and use AES-256-GCM; protect both the key and ciphertext files as current-user-only data.
- File encryption prevents plaintext browsing, packaging, and accidental logging, but it cannot defeat malicious code with arbitrary access as the same operating-system user.

### Local file boundary

The following fields can read or write local files: `contentFile`, `metaFile`, resource and SEO `csvFile`/`outputFile`, Elementor `changesFile` and `dataFile`, media `filePath`, package `file`, pack `folderPath`, and pack `outputPath`.

By default, every such path must remain inside the MCP server process's `cwd`. Add trusted roots with `WP_API_ALLOWED_LOCAL_ROOTS`. Separate roots with the platform path delimiter:

- Windows: semicolon, for example `C:\content;D:\packages`
- Linux/macOS: colon, for example `/srv/content:/srv/packages`

Both lexical and resolved real paths are checked. Existing symlinks cannot be used to escape an allowed root. Configured roots must already exist and be directories. Keep the allowlist narrow: every permitted root becomes available to whichever agent can invoke these file tools.

When a tool's compact JSON result exceeds 8 KiB, the complete result is omitted from `structuredContent` and stored under `.wp-api-results` in the current working directory. The MCP response returns only the absolute file path, byte count, and SHA-256. Set `WP_API_RESULT_DIR` to change this directory; if a stored file will later be used as tool input, its directory must also be inside `cwd` or `WP_API_ALLOWED_LOCAL_ROOTS`. Result files may contain site content, so clean them up when no longer needed and do not commit them. The 8 KiB value is this project's conversation-inline policy, not an MCP or WordPress hard limit.

This allowlist is an application boundary, not an operating-system sandbox. Use roots that untrusted local users and processes cannot mutate while a tool is running; otherwise path replacement between validation and file access remains an operating-system race.

### Default resource limits

| Boundary | Default |
| --- | ---: |
| Network request timeout | 30 seconds |
| One WordPress REST response | 25 MiB |
| One `contentFile` | 25 MiB |
| One `metaFile` or `changesFile` | 10 MiB JSON |
| One media file | 50 MiB |
| One plugin/theme ZIP | 100 MiB |
| One Elementor tree | 10 MiB JSON, 10,000 elements, 100 levels |
| Resource CSV import | 25 MiB |
| One resource batch request | 8 MiB JSON |
| One resource batch tool call | 25 MiB cumulative JSON |
| Local package source | 20,000 entries and 512 MiB uncompressed files |

Local package uploads require a `.zip` extension and a recognized ZIP header. Local packing rejects symlinks and special files, keeps the source folder as the ZIP's top-level directory, and requires the output file to be outside the source folder.

## Jelly Core dependency

An installed and active Jelly Core plugin is required for:

- plugin install and update
- theme install and update
- theme activation

The server checks all active plugins before any of those mutations. If Jelly Core is unavailable, the operation stops before uploading or changing a package.

Package listing/details and plugin activation/deactivation use native WordPress REST endpoints and do not require Jelly Core. Theme deactivation is unsupported. Jelly Core's custom REST routes must perform their own logged-in capability checks: the compatibility `X-Jelly-*` headers are not a shared secret and must not be treated as authentication.

## Credential-storage migration

The current release removes `wp_client_add`, `wp_client_use`, active-client state, the build-time plaintext credential copy, and UI plaintext imports. Run `wp-api-config` to re-enter connections, then pass the saved `client` name explicitly to remote tools. Configure a separate vault on every host.

## Development

```bash
npm run build
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution checks, [SECURITY.md](./SECURITY.md) for private vulnerability reporting, and [CHANGELOG.md](./CHANGELOG.md) for release notes.

## License

Released under the [MIT License](./LICENSE).
