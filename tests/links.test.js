import test from "node:test";
import assert from "node:assert/strict";

import { addLinkToContent, extractPostContent } from "../dist/lib/links.js";

test("extractPostContent prefers raw content over rendered content", () => {
  assert.equal(
    extractPostContent({
      content: {
        raw: "Raw body",
        rendered: "<p>Rendered body</p>"
      }
    }),
    "Raw body"
  );
});

test("extractPostContent falls back to rendered content", () => {
  assert.equal(
    extractPostContent({
      content: {
        rendered: "<p>Rendered body</p>"
      }
    }),
    "<p>Rendered body</p>"
  );
});

test("addLinkToContent replaces the first exact match only", () => {
  const result = addLinkToContent("Alpha Beta Beta", {
    text: "Beta",
    href: "https://example.com/beta"
  });

  assert.deepEqual(result, {
    updated: true,
    status: "updated",
    replacements: 1,
    content: 'Alpha <a href="https://example.com/beta">Beta</a> Beta'
  });
});

test("addLinkToContent is case-sensitive", () => {
  const result = addLinkToContent("Alpha beta", {
    text: "Beta",
    href: "https://example.com/beta"
  });

  assert.deepEqual(result, {
    updated: false,
    status: "not_found",
    replacements: 0,
    content: "Alpha beta"
  });
});

test("addLinkToContent skips when the first match is inside an existing link", () => {
  const content = '<p><a href="/old">Beta</a> Beta</p>';
  const result = addLinkToContent(content, {
    text: "Beta",
    href: "https://example.com/beta"
  });

  assert.deepEqual(result, {
    updated: false,
    status: "skipped_existing_link",
    replacements: 0,
    content
  });
});

test("addLinkToContent escapes href and anchor text", () => {
  const result = addLinkToContent("Use A&B", {
    text: "A&B",
    href: 'https://example.com/?q="A&B"'
  });

  assert.deepEqual(result, {
    updated: true,
    status: "updated",
    replacements: 1,
    content: 'Use <a href="https://example.com/?q=&quot;A&amp;B&quot;">A&amp;B</a>'
  });
});
