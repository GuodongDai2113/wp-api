# wp-api

A small Node.js CLI for managing remote WordPress content through the native REST API.

Current scope:

- `posts`
- `products` at the native `/wp/v2/products` endpoint
- `categories`
- local client management for multiple WordPress sites

Authentication uses native WordPress Application Passwords.

## Requirements

- Node.js 20+
- A WordPress site with REST API access
- A WordPress user with an Application Password

## Install

```bash
npm install
```

Run commands directly with Node:

```bash
node ./bin/wp-api.js client list
```

Or link it as a local CLI:

```bash
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

## Clients

Clients are stored locally in:

```text
~/.wp-api/config.json
```

Each client contains:

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

`wp-api client` without a subcommand returns the currently active client.

## Resource Commands

Supported resources:

```bash
wp-api posts ...
wp-api products ...
wp-api categories ...
```

Supported actions:

```bash
list
get <id>
create
update <id>
delete <id>
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

## Posts and Products

`posts` and `products` share the same content-style flags.

### List

```bash
wp-api posts list --search hello --page 2 --per-page 10
wp-api products list --status publish --json
```

Supported list filters:

- `--search <text>`
- `--page <number>`
- `--per-page <number>`
- `--status <status>`

### Get

```bash
wp-api posts get 42
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
wp-api products create \
  --title "Widget A" \
  --status publish \
  --categories 3,8 \
  --content-file ./product.md
```

Pipe content from stdin:

```bash
echo "Long body content" | wp-api posts create --title "Piped Post" --status draft
```

### Update

```bash
wp-api posts update 42 --title "Updated Title" --status publish
wp-api products update 9 --content-file ./new-body.md
```

Supported content flags:

- `--title <text>`
- `--slug <slug>`
- `--status <status>`
- `--excerpt <text>`
- `--content <text>`
- `--content-file <path>`
- `--categories <id,id,...>`

Content precedence:

1. `--content`
2. `--content-file`
3. stdin

### Delete

```bash
wp-api posts delete 42
wp-api posts delete 42 --force
wp-api products delete 9
```

For content resources like `posts` and `products`, delete is soft delete by default. Use `--force` when the endpoint supports permanent deletion.

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

## Output and Errors

Default output is human-readable.

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

## Development

Run tests:

```bash
npm test
```

Current test coverage includes:

- client persistence and active client switching
- Application Password auth header generation
- endpoint mapping for posts, categories, and products
- CLI parsing and CRUD flows
- stdin and file-based content input
- WordPress error rendering

## Notes and Limits

- `products` is not WooCommerce. It is the native `/wp-json/wp/v2/products` route.
- The CLI currently targets only `posts`, `products`, and `categories`.
- There is no interactive prompt mode yet.
- Configuration is stored in plain local JSON. Protect the machine and user account accordingly.
