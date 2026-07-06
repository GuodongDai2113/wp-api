---
name: wp-api
description: Use when an agent needs to operate the wp-api CLI to manage WordPress posts, pages, products, categories, product categories, or SEO meta through native WordPress REST endpoints.
---

# Using wp-api CLI

## Overview

`wp-api` is a local Node.js CLI for managing remote WordPress content through native WordPress REST endpoints.

Supported resources:

- `posts`
- `pages`
- `products`
- `categories`
- `product-categories`

Supported command groups:

- `client`
- resource CRUD: `list`, `get`, `create`, `update`, `delete`
- `seo`

## Before You Use It

The target WordPress site must:

- expose the native REST API
- have a user with an Application Password
- expose Rank Math fields in REST `meta` if `seo` commands are needed

Local requirements:

- Node.js 20+
- dependencies installed with `npm install`
- CLI linked or invoked from the repo

Common local setup:

```bash
npm install
npm link
wp-api client list
```

## Core Rule

This CLI uses native WordPress routes, not WooCommerce private APIs and not Rank Math private APIs.

Important route mapping:

| Resource | Native route |
| --- | --- |
| `posts` | `/wp-json/wp/v2/posts` |
| `pages` | `/wp-json/wp/v2/pages` |
| `products` | `/wp-json/wp/v2/product` |
| `categories` | `/wp-json/wp/v2/categories` |
| `product-categories` | `/wp-json/wp/v2/product_cat` |

Do not assume:

- `products` means WooCommerce products API
- `product-categories` means WooCommerce term APIs
- `seo` uses a separate plugin endpoint

## First-Time Workflow

### 1. Add a client

```bash
wp-api client add prod \
  --site-url https://example.com \
  --username admin \
  --app-password xxxx\ xxxx\ xxxx\ xxxx\ xxxx\ xxxx
```

### 2. Select the active client

```bash
wp-api client use prod
```

### 3. Confirm available clients

```bash
wp-api client list
wp-api client list --json
```

### 4. Check the active client

```bash
wp-api client
wp-api client --json
```

Clients are stored locally in:

```text
~/.wp-api/config.json
```

## Global Flags

These flags can be placed before the resource command:

- `--client <name>`: use a saved client for one command without switching active client
- `--site-url <url>`: override the client's site URL for one command
- `--json`: return JSON output
- `--verbose`: print request information to stderr

Examples:

```bash
wp-api --client prod posts list --json
wp-api --site-url https://staging.example.com pages get 12
```

## Resource Command Shape

All resource commands follow this pattern:

```bash
wp-api <resource> <action> [...]
```

Supported actions:

- `list`
- `get <id>`
- `create`
- `update <id>`
- `delete <id>`

## Listing Resources

Supported list filters:

- `--search <text>`
- `--page <number>`
- `--per-page <number>`
- `--status <status>`

Examples:

```bash
wp-api posts list
wp-api posts list --search hello --page 2 --per-page 5
wp-api pages list --status publish --json
wp-api products list --per-page -1 --json
```

Special rule:

- `--per-page -1` means fetch every page and merge all items into one result

Text output includes a pagination footer. Use `--json` for agent-friendly parsing.

## Getting One Resource

```bash
wp-api posts get 42
wp-api pages get 7 --json
wp-api product-categories get 15 --json
```

## Creating and Updating Content Resources

Content resources are:

- `posts`
- `pages`
- `products`

Shared content flags:

- `--title <text>`
- `--slug <slug>`
- `--status <status>`
- `--excerpt <text>`
- `--content <text>`
- `--content-file <path>`
- `--gutenberg`

Additional post taxonomy flag:

- `--categories <id,id,...>`

Examples:

```bash
wp-api posts create \
  --title "Hello World" \
  --status draft \
  --content "Body text"
```

```bash
wp-api pages update 7 \
  --title "About Us" \
  --content-file ./about.md
```

```bash
wp-api posts create \
  --title "HTML Article" \
  --content-file ./article.html \
  --gutenberg
```

```bash
echo "Long body content" | wp-api products create \
  --title "Widget A" \
  --status publish
```

Content precedence is fixed:

1. `--content`
2. `--content-file`
3. stdin

If multiple content sources are present, the earlier source wins.

Use `--gutenberg` only when the caller explicitly wants resolved HTML converted into WordPress Gutenberg block markup before upload. The conversion applies after content precedence is resolved, so it works with `--content`, `--content-file`, and stdin. Without `--gutenberg`, submit content unchanged.

For MCP tools, `wp_resource_create` and `wp_resource_update` expose the same behavior as `gutenberg: true`.

## Creating and Updating Taxonomy Resources

Taxonomy resources are:

- `categories`
- `product-categories`

Supported flags:

- `--name <text>`
- `--slug <slug>`
- `--description <text>`
- `--parent <id>`

Examples:

```bash
wp-api categories create \
  --name News \
  --slug news \
  --description "Site news"
```

```bash
wp-api product-categories update 15 \
  --name "Digital Meters" \
  --parent 3
```

Do not send content-style flags such as `--content` or `--title` to taxonomy resources.

## Delete Behavior

Delete behavior depends on the resource type.

Content resources:

- `posts`
- `pages`
- `products`

These use soft delete by default. Use `--force` when the endpoint supports permanent deletion.

Examples:

```bash
wp-api posts delete 42
wp-api posts delete 42 --force
wp-api pages delete 7
```

Taxonomy resources:

- `categories`
- `product-categories`

These are permanently deleted by default because WordPress taxonomy endpoints do not support trashing.

Examples:

```bash
wp-api categories delete 15
wp-api product-categories delete 22
```

## SEO Commands

Command shape:

```bash
wp-api seo <resource> <id> [...]
```

Supported SEO resources:

- `posts`
- `pages`
- `products`
- `categories`
- `product-categories`

Supported SEO flags:

- `--title <text>` -> `rank_math_title`
- `--description <text>` -> `rank_math_description`
- `--focus-keyword <text>` -> `rank_math_focus_keyword`

Read current SEO values:

```bash
wp-api seo posts 42
wp-api seo pages 7 --json
wp-api seo product-categories 15 --json
```

Update one or more SEO values:

```bash
wp-api seo posts 42 \
  --title "SEO Title" \
  --description "SEO Description" \
  --focus-keyword "focus keyword"
```

```bash
wp-api seo categories 15 \
  --description "Category SEO description"
```

Rules:

- no SEO flags means read
- any SEO flag means update
- only provided SEO fields are sent
- updates go to the same native resource endpoint with a `meta` payload

## Recommended Agent Usage

For automation, prefer `--json` whenever the result must be parsed or reused.

Recommended pattern:

1. Ensure the correct client exists
2. Use `wp-api client --json` or `wp-api client list --json` to inspect state
3. Run resource or `seo` commands with `--json`
4. Check stderr when a command fails

Examples:

```bash
wp-api client --json
wp-api --client prod posts list --json
wp-api --client prod seo posts 42 --json
```

## Common Failure Cases

### No active client

If no active client exists and no `--client` is provided, commands fail.

Fix:

```bash
wp-api client add ...
wp-api client use ...
```

### TLS or self-signed certificate errors

Typical failure text includes certificate or fetch errors.

If the local CA is trusted on the machine, try:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
wp-api posts list
```

### SEO fields missing

If `seo` returns empty or missing `rank_math_*` values, the WordPress side likely does not expose those fields in REST `meta`.

### Wrong API assumption for products

If a user expects WooCommerce semantics, clarify that this CLI uses native `wp/v2/product`, not WooCommerce product APIs.

## Quick Reference

```bash
wp-api client add <name> --site-url <url> --username <user> --app-password <password>
wp-api client use <name>
wp-api client list --json
wp-api posts list --json
wp-api posts get <id> --json
wp-api posts create --title "Title" --status draft --content "Body"
wp-api posts update <id> --title "Updated"
wp-api posts delete <id>
wp-api seo posts <id> --json
wp-api seo posts <id> --title "SEO title"
```
