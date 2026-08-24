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

This starts a temporary page on a random `127.0.0.1` port and opens it in the default browser. The page can add, edit, delete, test, and activate connections. Saved passwords are never displayed again. The service exits explicitly or after 15 minutes of inactivity.

Credentials default to `~/.wp-api/`. `vault.json` contains AES-256-GCM ciphertext for usernames and passwords; `vault.key` contains a random per-host key. Set the same `WP_API_CONFIG_DIR` for `wp-api-config` and the MCP host to override that directory. Builds and npm packages contain no credentials.

The configuration page never reads legacy plaintext configuration. Re-enter connections in the page, then securely remove old `config/config.json`, `build/config/config.json`, or `*.plaintext-backup` files manually.

Vault writes use atomic replacement and a cross-process file lock. `wp_client_list` returns only connection names, site URLs, and the active connection name; it never returns usernames, passwords, or password status.

All remote tools accept optional `client` and `siteUrl` fields. `client` selects a saved connection without changing the active one. `siteUrl` may change only the path on the saved URL's origin; it cannot redirect saved credentials to another host.

## Tools

The server exposes exactly 32 tools.

### Client configuration (2)

- `wp_client_use` — set the active saved connection.
- `wp_client_list` — list saved connection names and URLs without usernames or passwords.

### Structure and REST schema discovery (2)

- `wp_structure_get` — query stable usage structures for `post`, `page`, `product`, `category`, `product-category`, `media`, `seo-meta`, `elementor-page`, or `elementor-element`; omit `structure` to list the catalog. This local tool does not require a saved WordPress client.
- `wp_api_schema` — omit `apiPath` to inspect the target site's `/wp-json/` route index, or pass a relative path such as `wp/v2/product` to read its live `OPTIONS` schema before constructing a request.

### WordPress resources (5)

- `wp_resource_list` — list posts, pages, categories, or Jelly Catalog products, product categories, and product tags.
- `wp_resource_get` — read one resource by ID.
- `wp_resource_create` — create content or a taxonomy term.
- `wp_resource_update` — update content or a taxonomy term.
- `wp_resource_delete` — trash content or permanently delete a taxonomy term.

Supported `resource` values are `posts`, `pages`, `products`, `categories`, `product-categories`, and `product-tags`; product resources specifically refer to Jelly Catalog and do not represent WooCommerce products. Product writes accept `productCategories`, `productTags`, and registered `meta` fields. Use `wp_api_schema` first to inspect the target site's current field definitions. Category, product-category, and product-tag deletion requires explicit `force: true`, because taxonomy terms have no trash. `perPage: -1` aggregates all pages within the documented limits.

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

### SEO, post content, and media (5)

- `wp_seo_get` — read Rank Math title, description, and focus keyword fields.
- `wp_seo_update` — update or explicitly clear Rank Math REST meta fields.
- `wp_post_link` — list, add, update, or remove links in editable raw post content.
- `wp_post_content_replace` — replace every exact text occurrence in a post.
- `wp_media_upload` — upload a local bitmap and optionally set attachment metadata.

Resource create/update accepts inline `content` or a local `contentFile`. Set `gutenberg: true` to convert resolved HTML into Gutenberg block markup before upload. Media extensions are limited to `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, and `.webp`.

### Elementor (6)

- `wp_elementor_init` — initialize Elementor metadata only on a page whose element tree is empty.
- `wp_elementor_export` — export the raw Elementor element tree.
- `wp_elementor_import` — replace the Elementor element tree.
- `wp_elementor_structure` — return a lightweight element hierarchy.
- `wp_elementor_get_element` — read one element and its settings by ID.
- `wp_elementor_find` — search by element type, widget type, text, or setting.

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
- Per-call `siteUrl` overrides must have the same origin as the saved URL.
- Authenticated WordPress requests do not follow redirects. Configure the canonical site URL instead.
- Authentication uses the saved WordPress Application Password; grant that WordPress account only the capabilities it needs.
- Credentials default to `~/.wp-api/` and use AES-256-GCM; protect both the key and ciphertext files as current-user-only data.
- File encryption prevents plaintext browsing, packaging, and accidental logging, but it cannot defeat malicious code with arbitrary access as the same operating-system user.

### Local file boundary

The following fields can read or write local files: `contentFile`, media `filePath`, package `file`, pack `folderPath`, and pack `outputPath`.

By default, every such path must remain inside the MCP server process's `cwd`. Add trusted roots with `WP_API_ALLOWED_LOCAL_ROOTS`. Separate roots with the platform path delimiter:

- Windows: semicolon, for example `C:\content;D:\packages`
- Linux/macOS: colon, for example `/srv/content:/srv/packages`

Both lexical and resolved real paths are checked. Existing symlinks cannot be used to escape an allowed root. Configured roots must already exist and be directories. Keep the allowlist narrow: every permitted root becomes available to whichever agent can invoke these file tools.

This allowlist is an application boundary, not an operating-system sandbox. Use roots that untrusted local users and processes cannot mutate while a tool is running; otherwise path replacement between validation and file access remains an operating-system race.

### Default resource limits

| Boundary | Default |
| --- | ---: |
| Network request timeout | 30 seconds |
| One WordPress REST response | 25 MiB |
| One `contentFile` | 25 MiB |
| One media file | 50 MiB |
| One plugin/theme ZIP | 100 MiB |
| One Elementor tree | 10 MiB JSON, 10,000 elements, 100 levels |
| `perPage: -1` aggregation | 100 pages and approximately 50 MiB JSON |
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

The current release removes `wp_client_add`, the build-time plaintext credential copy, and UI plaintext imports. Run `wp-api-config` to re-enter connections, then let the MCP host use `wp_client_use` or the default selected in the page. Configure a separate vault on every host.

## Development

```bash
npm run build
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution checks, [SECURITY.md](./SECURITY.md) for private vulnerability reporting, and [CHANGELOG.md](./CHANGELOG.md) for release notes.

## License

Released under the [MIT License](./LICENSE).
