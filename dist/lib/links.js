/** 从 WordPress 文章对象中提取可编辑正文，优先使用 raw，回退到 rendered。 */
export function extractPostContent(post) {
    if (typeof post?.content?.raw === "string") {
        return post.content.raw;
    }
    if (typeof post?.content?.rendered === "string") {
        return post.content.rendered;
    }
    return "";
}
/** 把正文中的第一处精确匹配文本替换为链接，并避免重复链接已有锚文本。 */
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
/** 判断指定字符位置是否位于现有 a 标签范围内。 */
function isInsideAnchor(content, index) {
    return findAnchorRanges(content).some(([start, end]) => index >= start && index < end);
}
/** 扫描正文中所有完整 a 标签的起止范围。 */
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
/** 转义 HTML 文本节点中的特殊字符。 */
function escapeHtmlText(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
/** 转义 HTML 属性值中的特殊字符。 */
function escapeAttribute(value) {
    return escapeHtmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
