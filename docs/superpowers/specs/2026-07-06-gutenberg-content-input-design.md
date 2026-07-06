# Gutenberg Content Input Migration Design

## Scope

Migrate two content-related capabilities from `J:\project\article-server` into `wp-api`:

- Convert resolved HTML content into WordPress Gutenberg block markup when the caller explicitly enables the conversion.
- Accept local HTML files directly through the existing content file input path.

This change does not add new CRUD operations and does not migrate the old upload endpoint or upload-directory filename policy.

## Interface

CLI content resources (`posts`, `pages`, and `products`) gain one boolean option for `create` and `update`:

```bash
wp-api posts create --content-file ./article.html --gutenberg
wp-api posts create --content "<h2>Hello</h2><p>Body</p>" --gutenberg
wp-api posts update 42 --content-file ./article.html --gutenberg
```

MCP tools `wp_resource_create` and `wp_resource_update` gain a matching input field:

```json
{
  "resource": "posts",
  "title": "Article",
  "contentFile": "./article.html",
  "gutenberg": true
}
```

When `gutenberg` is absent or false, content is submitted exactly as it is resolved today.

## Data Flow

Content resolution remains centralized:

1. `--content`, `--content-file`, or stdin is resolved by `resolveContentInput()`.
2. The resolved content string is passed through a new Gutenberg transformation only when the boolean option is enabled.
3. `buildResourceBody()` places the final string in the WordPress REST `content` field.
4. The existing WordPress REST create/update calls submit the body unchanged from there.

The conversion applies to all content sources, not only local files.

## Components

Add `src/lib/html-to-gutenberg.ts` containing a TypeScript migration of the old converter's core logic:

- `convertHtmlToGutenberg(html: string): string`
- HTML document shell stripping.
- Top-level node parsing.
- Block generation for paragraphs, headings, lists, images, figures, quotes, code, separators, tables, and groups.

Do not migrate these old server-only helpers:

- upload-directory filename resolution.
- Multer upload validation.
- upload storage naming.

Update `src/lib/resources.ts` so content resources can receive a content transform option without duplicating source-specific logic.

Update `src/cli.ts` so `--gutenberg` is parsed as a boolean option and passed into resource body construction for `create` and `update`.

Update MCP files:

- `src/mcp/server.ts`: add `gutenberg` to create/update resource input schema.
- `src/mcp/wp-api-tools.ts`: map `gutenberg: true` to `--gutenberg`.

## Error Handling

Local file reading keeps the current behavior from `resolveContentInput()`: invalid or missing paths surface as file read errors through the existing CLI error path.

The converter treats non-string or blank HTML as an empty string, matching the old converter. It does not validate that the input is a complete HTML document; fragments such as `<p>Body</p>` are valid.

## Testing

Follow test-first implementation with focused `node:test` coverage:

- Gutenberg conversion converts representative HTML fragments into WordPress block comments.
- `posts create --content ... --gutenberg` sends converted content.
- `posts create --content-file ... --gutenberg` sends converted file content.
- Existing content behavior stays unchanged when `--gutenberg` is absent.
- MCP `wp_resource_create` maps `gutenberg: true` to `--gutenberg`.

Run `npm test` after implementation.
