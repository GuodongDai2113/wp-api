import test from "node:test";
import assert from "node:assert/strict";
import { parse as parseWordPressBlocks } from "@wordpress/block-serialization-default-parser";

import { convertHtmlToGutenberg } from "../build/wordpress/content/gutenberg.js";

/** 验证常用文章元素会生成与 WordPress 块分隔符约定一致的 Gutenberg 标记。 */
test("convertHtmlToGutenberg converts common article HTML into Gutenberg blocks", () => {
  const result = convertHtmlToGutenberg("<h2>Title</h2><p>Body</p><ul><li>One</li></ul>");

  assert.match(result, /<!-- wp:heading \{"level":2\} -->/);
  assert.match(result, /<h2 class="wp-block-heading">Title<\/h2>/);
  assert.match(result, /<!-- wp:paragraph -->\n<p>Body<\/p>\n<!-- \/wp:paragraph -->/);
  assert.match(result, /<!-- wp:list -->/);
  assert.match(result, /<!-- wp:list-item --><li>One<\/li><!-- \/wp:list-item -->/);

  const parsedBlocks = parseWordPressBlocks(result).filter((block) => block.blockName !== null);
  assert.deepEqual(parsedBlocks.map((block) => block.blockName), ["core/heading", "core/paragraph", "core/list"]);
  assert.equal(parsedBlocks[2].innerBlocks[0].blockName, "core/list-item");
});

/** 验证完整文档外壳和不应进入文章正文的活动内容会被删除。 */
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

/** 验证事件属性、内联样式和 WordPress 未允许的活动 URL 协议不会进入块内容。 */
test("convertHtmlToGutenberg removes active attributes and disallowed URL protocols", () => {
  const result = convertHtmlToGutenberg(`
    <p style="color:red" onclick="alert(1)">
      <img src="data:image/svg+xml,bad" srcset="javascript:bad 1x, https://example.com/good.png 2x" onerror="alert(2)" alt="Safe alt">
      <a href="javascript:alert(3)" onmouseover="alert(4)">Unsafe link</a>
      <a href="https://example.com/docs" target="_blank" rel="noopener">Safe link</a>
    </p>
  `);

  assert.doesNotMatch(result, /\bon[a-z]+\s*=/i);
  assert.doesNotMatch(result, /\bstyle\s*=/i);
  assert.doesNotMatch(result, /(?:javascript|data):/i);
  assert.doesNotMatch(result, /\bsrcset\s*=/i);
  assert.match(result, /<img alt="Safe alt">/);
  assert.match(result, /<a>Unsafe link<\/a>/);
  assert.match(result, /<a href="https:\/\/example\.com\/docs" target="_blank" rel="noopener">Safe link<\/a>/);
});

/** 验证实体编码和控制字符无法绕过 URL 协议检查，同时相对地址与 WordPress 允许协议仍可使用。 */
test("convertHtmlToGutenberg validates decoded URL protocols", () => {
  const result = convertHtmlToGutenberg(`
    <p>
      <a href="java&#x73;cript:alert(1)">Entity bypass</a>
      <a href="java&#10;script:alert(2)">Control bypass</a>
      <a href="/relative/path">Relative</a>
      <a href="#section">Anchor</a>
      <a href="mailto:editor@example.com">Email</a>
      <a href="tel:+10000000000">Phone</a>
    </p>
  `);

  assert.doesNotMatch(result, /javascript:/i);
  assert.match(result, /<a>Entity bypass<\/a>/);
  assert.match(result, /<a>Control bypass<\/a>/);
  assert.match(result, /href="\/relative\/path"/);
  assert.match(result, /href="#section"/);
  assert.match(result, /href="mailto:editor@example\.com"/);
  assert.match(result, /href="tel:\+10000000000"/);
});

/** 验证允许列表保留 Gutenberg 常用语义属性，并展开普通未知容器而不丢失其文本。 */
test("convertHtmlToGutenberg preserves allowed semantic attributes and unwraps unknown tags", () => {
  const result = convertHtmlToGutenberg(`
    <section>
      <h2 id="intro" class="lead" aria-label="Introduction" data-track="unsafe-hook" style="color:red">Title</h2>
      <p title="1 > 0">Keep <custom-element title="wrapper">nested text</custom-element></p>
    </section>
    <iframe><p>Embedded content</p></iframe>
  `);

  assert.match(result, /<h2\b[^>]*\bid="intro"[^>]*>Title<\/h2>/);
  assert.match(result, /<h2\b[^>]*\bclass="wp-block-heading lead"[^>]*>/);
  assert.match(result, /<h2\b[^>]*\baria-label="Introduction"[^>]*>/);
  assert.match(result, /<p title="1 > 0">Keep nested text<\/p>/);
  assert.doesNotMatch(result, /data-track|style=|custom-element|iframe|Embedded content/i);
});

