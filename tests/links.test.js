import test from "node:test";
import assert from "node:assert/strict";

import {
  addLinkToContent,
  extractPostContent,
  isSafeLinkHref,
  listLinksInContent,
  removeLinkFromContent,
  updateLinkInContent
} from "../build/lib/links.js";

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

test("extractPostContent rejects rendered content when editable raw content is unavailable", () => {
  assert.throws(
    () => extractPostContent({
      content: {
        rendered: "<p>Rendered body</p>"
      }
    }),
    /Editable raw post content is unavailable/
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

test("addLinkToContent skips an existing link and uses the next eligible match", () => {
  const content = '<p><a href="/old">Beta</a> Beta</p>';
  const result = addLinkToContent(content, {
    text: "Beta",
    href: "https://example.com/beta"
  });

  assert.deepEqual(result, {
    updated: true,
    status: "updated",
    replacements: 1,
    content: '<p><a href="/old">Beta</a> <a href="https://example.com/beta">Beta</a></p>'
  });
});

test("addLinkToContent reports an existing link when no eligible match remains", () => {
  const content = '<p><a href="/old"><strong>Beta</strong></a></p>';
  assert.deepEqual(addLinkToContent(content, { text: "Beta", href: "/new" }), {
    updated: false,
    status: "skipped_existing_link",
    replacements: 0,
    content
  });
});

test("addLinkToContent ignores matches in attributes, comments, scripts, and styles", () => {
  const content = '<p title="Beta">Other</p><!-- Beta --><script>Beta</script><style>Beta</style><p>Beta</p>';
  const result = addLinkToContent(content, { text: "Beta", href: "/new" });
  assert.equal(
    result.content,
    '<p title="Beta">Other</p><!-- Beta --><script>Beta</script><style>Beta</style><p><a href="/new">Beta</a></p>'
  );
  assert.equal(result.replacements, 1);
});

test("isSafeLinkHref accepts HTTP(S) and relative links but rejects active protocols", () => {
  assert.equal(isSafeLinkHref("https://example.com/path"), true);
  assert.equal(isSafeLinkHref("/internal/path"), true);
  assert.equal(isSafeLinkHref("relative/path"), true);
  assert.equal(isSafeLinkHref("javascript:alert(1)"), false);
  assert.equal(isSafeLinkHref("data:text/html,unsafe"), false);
  assert.equal(isSafeLinkHref(" /space"), false);
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

test("listLinksInContent lists links in order and ignores comments and scripts", () => {
  const content = '<!-- <a href="/ignored">Ignored</a> --><a href="/one">One <strong>Link</strong></a><script><a href="/bad">Bad</a></script><a href="/two?a=1&amp;b=2">Two</a>';
  assert.deepEqual(listLinksInContent(content), [
    { index: 0, href: "/one", text: "One Link" },
    { index: 1, href: "/two?a=1&b=2", text: "Two" }
  ]);
});

test("updateLinkInContent updates href and optional anchor text while preserving surrounding content", () => {
  const content = '<p>Before <a class="cta" href="/old"><strong>Old</strong> Link</a> after.</p>';
  assert.deepEqual(updateLinkInContent(content, {
    href: "/old",
    text: "Old Link",
    newHref: "/new",
    newText: "New Link"
  }), {
    updated: true,
    status: "updated",
    replacements: 1,
    content: '<p>Before <a class="cta" href="/new">New Link</a> after.</p>',
    link: { index: 0, href: "/old", text: "Old Link" }
  });
});

test("removeLinkFromContent removes only the anchor wrapper and preserves inner markup", () => {
  const content = '<p><a href="/old"><strong>Keep</strong> this</a></p>';
  assert.deepEqual(removeLinkFromContent(content, { href: "/old", text: "Keep this" }), {
    updated: true,
    status: "updated",
    replacements: 1,
    content: "<p><strong>Keep</strong> this</p>",
    link: { index: 0, href: "/old", text: "Keep this" }
  });
});

test("updateLinkInContent and removeLinkFromContent do not mutate absent links", () => {
  const content = '<p><a href="/other">Other</a></p>';
  for (const result of [
    updateLinkInContent(content, { href: "/missing", newHref: "/new" }),
    removeLinkFromContent(content, { href: "/missing" })
  ]) {
    assert.deepEqual(result, { updated: false, status: "not_found", replacements: 0, content });
  }
});

