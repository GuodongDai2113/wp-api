import test from "node:test";
import assert from "node:assert/strict";

import { convertHtmlToGutenberg } from "../build/lib/html-to-gutenberg.js";

test("convertHtmlToGutenberg converts common article HTML into Gutenberg blocks", () => {
  const result = convertHtmlToGutenberg("<h2>Title</h2><p>Body</p><ul><li>One</li></ul>");

  assert.match(result, /<!-- wp:heading \{"level":2\} -->/);
  assert.match(result, /<h2 class="wp-block-heading">Title<\/h2>/);
  assert.match(result, /<!-- wp:paragraph -->\n<p>Body<\/p>\n<!-- \/wp:paragraph -->/);
  assert.match(result, /<!-- wp:list -->/);
  assert.match(result, /<!-- wp:list-item --><li>One<\/li><!-- \/wp:list-item -->/);
});

test("convertHtmlToGutenberg strips full document shell and unsafe non-content blocks", () => {
  const result = convertHtmlToGutenberg(`
    <!doctype html>
    <html>
      <head><style>.x{color:red}</style><script>bad()</script></head>
      <body><p>Only body</p></body>
    </html>
  `);

  assert.equal(result, "<!-- wp:paragraph -->\n<p>Only body</p>\n<!-- /wp:paragraph -->");
});

