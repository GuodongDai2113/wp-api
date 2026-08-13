# wp-api

A pure [Model Context Protocol](https://modelcontextprotocol.io/) server for managing WordPress through native and Jelly Core REST APIs. It runs over STDIO and exposes 27 structured tools for clients, content, SEO, Elementor, media, and package management.

Chinese documentation: [README.zh-CN.md](./README.zh-CN.md) · Detailed MCP setup: [mcp.md](./mcp.md)

Version 2 is MCP-only. The only executable is `wp-api-mcp`; there is no standalone `wp-api` command interface.

## Requirements

- Node.js 20 or later
- A WordPress site with REST API access
- A WordPress user and [Application Password](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)
- REST permissions appropriate for every operation the MCP client may request
- Rank Math meta fields exposed through REST when using the SEO tools
- Jelly Core installed and active for the package operations listed under [Jelly Core dependency](#jelly-core-dependency)

Products and product categories must be exposed by the target site as `/wp-json/wp/v2/product` and `/wp-json/wp/v2/product_cat`. Elementor tools require the corresponding page meta to be readable and writable through REST.

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

If the package is linked or installed globally, `wp-api-mcp` is the only package executable:

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

Connections are configured through MCP tools, not through a separate command. In your MCP host, call these three tools in order:

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

`wp_client_list` confirms the active client and never returns Application Passwords. The project-local `config/config.json` is the credential build source; `npm run build` copies it to the runtime file `build/config/config.json`. The source is ignored by Git, but `build` is included in the npm package. Treat every resulting package as a plaintext credential artifact: never publish it to a public registry or share it outside the trusted environment.

Configuration writes are serialized inside one server process, but the file does not use a cross-process lock. If several MCP hosts share the same account and config file, avoid changing clients concurrently; use one writer or separate configuration directories in an embedded deployment.

All remote tools accept optional `client` and `siteUrl` fields. `client` selects a saved connection without changing the active one. `siteUrl` may change only the path on the saved URL's origin; it cannot redirect saved credentials to another host.

## Tools

The server exposes exactly 27 tools.

### Client configuration (3)

- `wp_client_add` — add or replace a saved WordPress connection.
- `wp_client_use` — set the active saved connection.
- `wp_client_list` — list saved connections and the active name without passwords.

### WordPress resources (5)

- `wp_resource_list` — list posts, pages, products, categories, or product categories.
- `wp_resource_get` — read one resource by ID.
- `wp_resource_create` — create content or a taxonomy term.
- `wp_resource_update` — update content or a taxonomy term.
- `wp_resource_delete` — trash content or permanently delete a taxonomy term.

Supported `resource` values are `posts`, `pages`, `products`, `categories`, and `product-categories`. Category and product-category deletion requires explicit `force: true`, because those resources have no trash. `perPage: -1` aggregates all pages within the documented limits.

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

See [mcp.md](./mcp.md) for input conventions and detailed operational notes.

## Security model

### Site URLs and credentials

- Site URLs must use HTTPS. HTTP is accepted only for loopback hosts such as `localhost`, `*.localhost`, `127.0.0.0/8`, and `::1`.
- A site URL cannot contain embedded credentials, a query string, or a fragment.
- Per-call `siteUrl` overrides must have the same origin as the saved URL.
- Authenticated WordPress requests do not follow redirects. Configure the canonical site URL instead.
- Authentication uses the saved WordPress Application Password; grant that WordPress account only the capabilities it needs.

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

## Version 2 migration

Version 2 is a breaking release that removes the `wp-api` CLI, its argument parser, stdin command mode, and CLI-only output options. Update integrations to launch `wp-api-mcp` (or `npm start`) as a STDIO MCP server and invoke the structured tools above. Credentials are built from project-local `config/config.json` into `build/config/config.json`.

## Development

```bash
npm run build
npm test
```
