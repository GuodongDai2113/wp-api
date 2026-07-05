# Add Links Command Design

## Goal

Add a CLI command that updates a single WordPress article by converting one matching text fragment in the article content into an HTML anchor tag.

The first version is intentionally narrow:

- Only WordPress posts are supported, using the native `/wp-json/wp/v2/posts/<id>` endpoint.
- Only one link rule is accepted per command invocation.
- Only the first exact text match is considered.
- Existing links are preserved by skipping matches that are already inside an `<a>...</a>` element.

## Command

```bash
wp-api links add <post-id> --text "Anchor Text" --href "https://example.com"
```

Global flags keep the existing CLI behavior:

```bash
wp-api --client prod links add 42 --text "OpenAI" --href "https://openai.com"
wp-api links add 42 --text "OpenAI" --href "https://openai.com" --json
wp-api links add 42 --text "OpenAI" --href "https://openai.com" --verbose
```

Required arguments:

- `<post-id>`: numeric WordPress post id.
- `--text <text>`: exact text to link.
- `--href <url>`: href attribute value for the generated link.

Invalid input exits with code `1` and a concise stderr message. Missing `<post-id>`, `--text`, or `--href` is invalid.

## Matching Rules

The command treats the article content as HTML text and uses conservative string matching.

- Match `--text` exactly as provided.
- Matching is case-sensitive.
- No word-boundary handling.
- No Chinese-specific handling.
- Consider only the first exact occurrence of `--text`.
- If that first occurrence is outside an existing `<a ...>...</a>` range, replace it.
- If that first occurrence is inside an existing `<a ...>...</a>` range, skip it and do not continue to later occurrences in version 1.
- If the first exact match cannot be replaced, do not send an update request.

The generated tag is:

```html
<a href="https://example.com">Anchor Text</a>
```

The first version escapes attribute-sensitive characters in `href` and escapes HTML-sensitive characters in the anchor text generated from `--text`. Because the matched source text is replaced with the escaped `--text`, callers should provide the visible text they want in the final anchor.

The first version requires `--href` to be non-empty but does not normalize URLs or restrict schemes.

## Existing Link Detection

Version 1 does not need a full HTML parser dependency. The implementation can identify `<a ...>...</a>` ranges with a targeted, case-insensitive tag scan:

1. Scan the content for opening `<a` tags and their closing `>`.
2. Find the corresponding next `</a>` closing tag.
3. Store `[start, end)` ranges covering the full anchor element.
4. After finding the first exact text match, check whether the match start is within any stored anchor range.
5. If it is outside all ranges, replace it.
6. If it is inside a range, report `skipped_existing_link` and leave content unchanged.

This keeps the behavior predictable for normal WordPress post HTML. Malformed nested anchors are not supported as a special case.

## Data Flow

1. Resolve the active or explicitly selected client using the existing client configuration flow.
2. Fetch the target post with `GET /wp-json/wp/v2/posts/<id>`.
3. Read content from `post.content.raw` when available.
4. Fall back to `post.content.rendered` when `content.raw` is unavailable.
5. Apply the link rule to produce updated content or a no-change result.
6. If content changed, update the post with `POST /wp-json/wp/v2/posts/<id>` and body:

```json
{
  "content": "<updated html>"
}
```

7. Render text or JSON output using the existing CLI output conventions.

## Output

Text output:

- Updated: `Link added to post 42: Anchor Text -> https://example.com`
- No match: `No matching text found in post 42: Anchor Text`
- Existing link skipped: `Matching text is already inside a link in post 42: Anchor Text`

JSON output returns a structured payload:

```json
{
  "id": 42,
  "resource": "posts",
  "action": "links.add",
  "updated": true,
  "status": "updated",
  "text": "Anchor Text",
  "href": "https://example.com",
  "replacements": 1
}
```

No-change statuses:

- `not_found`
- `skipped_existing_link`

For no-change results, `updated` is `false` and `replacements` is `0`.

## Extension Points

The first version reserves the `links` command group for future link operations:

- `wp-api links add <post-id> --links-file links.json`
- `wp-api links remove <post-id> --href <url>`
- `wp-api links list <post-id>`
- Batch post selection through filters such as `--search` or `--status`

These are not part of the first implementation.

## Testing

Focused tests should cover:

- `links add` requires `<post-id>`, `--text`, and `--href`.
- The command fetches the post before updating it.
- It uses `content.raw` before `content.rendered`.
- It updates `/wp-json/wp/v2/posts/<id>` with only the changed `content`.
- Matching is exact and case-sensitive.
- Only the first exact occurrence is considered.
- A match inside an existing `<a>` element is skipped without an update request.
- No match produces a no-change result without an update request.
- `--json` returns the structured result.
- Global flags such as `--client`, `--site-url`, and `--verbose` continue to work.

## Non-Goals

- Batch updating multiple posts.
- Multiple link rules in one command.
- Word-boundary, fuzzy, case-insensitive, or locale-aware matching.
- Replacing matches after the first match is skipped.
- Supporting pages, products, categories, or custom post types.
- Parsing or repairing arbitrary malformed HTML.
