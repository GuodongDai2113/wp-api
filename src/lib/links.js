export function extractPostContent(post) {
  if (typeof post?.content?.raw === "string") {
    return post.content.raw;
  }

  if (typeof post?.content?.rendered === "string") {
    return post.content.rendered;
  }

  return "";
}

export function addLinkToContent(content, { text, href }) {
  const matchIndex = content.indexOf(text);

  if (matchIndex === -1) {
    return {
      updated: false,
      status: "not_found",
      replacements: 0,
      content
    };
  }

  if (isInsideAnchor(content, matchIndex)) {
    return {
      updated: false,
      status: "skipped_existing_link",
      replacements: 0,
      content
    };
  }

  const anchor = `<a href="${escapeAttribute(href)}">${escapeHtmlText(text)}</a>`;

  return {
    updated: true,
    status: "updated",
    replacements: 1,
    content: `${content.slice(0, matchIndex)}${anchor}${content.slice(matchIndex + text.length)}`
  };
}

function isInsideAnchor(content, index) {
  return findAnchorRanges(content).some(([start, end]) => index >= start && index < end);
}

function findAnchorRanges(content) {
  const ranges = [];
  const anchorPattern = /<a(?:\s|>)[\s\S]*?>/gi;
  let match;

  while ((match = anchorPattern.exec(content)) !== null) {
    const start = match.index;
    const closePattern = /<\/a\s*>/gi;
    closePattern.lastIndex = anchorPattern.lastIndex;
    const closeMatch = closePattern.exec(content);

    if (!closeMatch) {
      continue;
    }

    ranges.push([start, closeMatch.index + closeMatch[0].length]);
    anchorPattern.lastIndex = closeMatch.index + closeMatch[0].length;
  }

  return ranges;
}

function escapeHtmlText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
