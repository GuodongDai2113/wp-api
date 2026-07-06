/** HTML void 元素集合，用于识别不需要闭合标签的节点。 */
const VOID_TAGS = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "source",
    "track",
    "wbr"
]);
/** 可直接映射为 Gutenberg 块的顶层 HTML 标签集合。 */
const BLOCK_TAGS = new Set([
    "blockquote",
    "div",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "img",
    "ol",
    "p",
    "pre",
    "table",
    "ul"
]);
/** 将普通文章 HTML 字符串转换为 WordPress Gutenberg 区块标记。 */
export function convertHtmlToGutenberg(html) {
    if (typeof html !== "string" || !html.trim()) {
        return "";
    }
    const bodyHtml = stripDocumentShell(html);
    const nodes = readTopLevelNodes(bodyHtml);
    return nodes
        .map(convertNodeToBlock)
        .filter(Boolean)
        .join("\n\n");
}
/** 移除完整 HTML 文档外壳，只保留可转换的正文片段。 */
function stripDocumentShell(html) {
    let result = html
        .replace(/<!doctype[^>]*>/gi, "")
        .replace(/<head\b[\s\S]*?<\/head>/gi, "")
        .replace(/<script\b[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[\s\S]*?<\/style>/gi, "");
    const bodyMatch = result.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch?.[1]) {
        result = bodyMatch[1];
    }
    return result
        .replace(/<\/?html\b[^>]*>/gi, "")
        .replace(/<\/?body\b[^>]*>/gi, "")
        .trim();
}
/** 读取 HTML 片段中的顶层节点，避免把块级结构错误包进段落。 */
function readTopLevelNodes(html) {
    const nodes = [];
    let index = 0;
    while (index < html.length) {
        const whitespace = html.slice(index).match(/^\s+/);
        if (whitespace?.[0]) {
            index += whitespace[0].length;
            continue;
        }
        if (html.startsWith("<!--", index)) {
            const end = html.indexOf("-->", index + 4);
            index = end === -1 ? html.length : end + 3;
            continue;
        }
        if (html[index] !== "<") {
            const nextTag = html.indexOf("<", index);
            const end = nextTag === -1 ? html.length : nextTag;
            const raw = html.slice(index, end).trim();
            if (raw) {
                nodes.push({ tag: "", raw, text: true });
            }
            index = end;
            continue;
        }
        const openMatch = html.slice(index).match(/^<([a-zA-Z][\w:-]*)([^>]*)>/);
        if (!openMatch?.[0] || !openMatch[1]) {
            index += 1;
            continue;
        }
        const tag = openMatch[1].toLowerCase();
        const openTagLength = openMatch[0].length;
        if (VOID_TAGS.has(tag) || /\/\s*>$/.test(openMatch[0])) {
            nodes.push({ tag, raw: openMatch[0], text: false });
            index += openTagLength;
            continue;
        }
        const closeEnd = findClosingTagEnd(html, tag, index + openTagLength);
        if (closeEnd === -1) {
            nodes.push({ tag, raw: openMatch[0], text: false });
            index += openTagLength;
            continue;
        }
        nodes.push({ tag, raw: html.slice(index, closeEnd), text: false });
        index = closeEnd;
    }
    return mergeInlineTextNodes(nodes);
}
/** 查找指定开始标签对应的闭合标签结束位置。 */
function findClosingTagEnd(html, tag, fromIndex) {
    const pattern = new RegExp(`<\\/?${escapeRegExp(tag)}\\b[^>]*>`, "gi");
    pattern.lastIndex = fromIndex;
    let depth = 1;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        const token = match[0];
        if (/^<\//.test(token)) {
            depth -= 1;
            if (depth === 0) {
                return pattern.lastIndex;
            }
        }
        else if (!/\/\s*>$/.test(token)) {
            depth += 1;
        }
    }
    return -1;
}
/** 将连续的顶层行内内容合并成一个文本节点，便于转换为段落。 */
function mergeInlineTextNodes(nodes) {
    const merged = [];
    let inlineBuffer = [];
    for (const node of nodes) {
        if (node.text || (node.tag && !BLOCK_TAGS.has(node.tag))) {
            inlineBuffer.push(node.raw);
            continue;
        }
        if (inlineBuffer.length) {
            merged.push({ tag: "", raw: inlineBuffer.join(" ").trim(), text: true });
            inlineBuffer = [];
        }
        merged.push(node);
    }
    if (inlineBuffer.length) {
        merged.push({ tag: "", raw: inlineBuffer.join(" ").trim(), text: true });
    }
    return merged;
}
/** 将单个顶层 HTML 节点转换为对应的 Gutenberg 区块。 */
function convertNodeToBlock(node) {
    if (node.text) {
        return paragraphBlock(`<p>${node.raw}</p>`);
    }
    if (/^h[1-6]$/.test(node.tag)) {
        return headingBlock(node.raw, node.tag);
    }
    if (node.tag === "p") {
        return convertParagraph(node.raw);
    }
    if (node.tag === "ul" || node.tag === "ol") {
        return listBlock(node.raw);
    }
    if (node.tag === "img") {
        return imageBlock(node.raw);
    }
    if (node.tag === "figure") {
        return figureBlock(node.raw);
    }
    if (node.tag === "blockquote") {
        return quoteBlock(node.raw);
    }
    if (node.tag === "pre") {
        return codeBlock(node.raw);
    }
    if (node.tag === "hr") {
        return separatorBlock();
    }
    if (node.tag === "table") {
        return tableBlock(node.raw);
    }
    if (node.tag === "div") {
        return groupBlock(node.raw);
    }
    return paragraphBlock(`<p>${node.raw}</p>`);
}
/** 将段落 HTML 转换为 Gutenberg 段落区块，纯分隔线段落会转为 separator。 */
function convertParagraph(raw) {
    const plain = stripTags(raw).replace(/\s+/g, "").trim();
    if (/^-{3,}$/.test(plain)) {
        return separatorBlock();
    }
    return paragraphBlock(raw);
}
/** 生成 Gutenberg 段落区块。 */
function paragraphBlock(paragraphHtml) {
    return `<!-- wp:paragraph -->\n${paragraphHtml.trim()}\n<!-- /wp:paragraph -->`;
}
/** 生成 Gutenberg 标题区块，并确保标题标签包含 WordPress 标题类名。 */
function headingBlock(raw, tag) {
    const level = Number(tag.slice(1));
    const html = ensureClass(raw, tag, "wp-block-heading");
    return `<!-- wp:heading {"level":${level}} -->\n${html.trim()}\n<!-- /wp:heading -->`;
}
/** 生成 Gutenberg 列表区块，并为每个顶层 li 添加 list-item 注释。 */
function listBlock(raw) {
    const match = raw.match(/^<(ul|ol)\b([^>]*)>([\s\S]*)<\/\1>$/i);
    if (!match?.[1]) {
        return `<!-- wp:list -->\n${raw.trim()}\n<!-- /wp:list -->`;
    }
    const tag = match[1].toLowerCase();
    const attrs = match[2] ?? "";
    const inner = match[3] ?? "";
    const blockAttrs = buildListBlockAttributes(tag, attrs);
    const blockAttrText = Object.keys(blockAttrs).length ? ` ${JSON.stringify(blockAttrs)}` : "";
    const listAttrs = appendClassAttribute(attrs, "wp-block-list");
    const listItems = convertListItems(inner);
    return `<!-- wp:list${blockAttrText} -->\n<${tag}${listAttrs}>${listItems}</${tag}>\n<!-- /wp:list -->`;
}
/** 根据列表标签和 HTML 属性生成 Gutenberg list 区块属性。 */
function buildListBlockAttributes(tag, attrs) {
    const blockAttrs = {};
    if (tag === "ol") {
        blockAttrs.ordered = true;
    }
    const start = getAttributeValue(attrs, "start");
    if (start && Number.isInteger(Number(start))) {
        blockAttrs.start = Number(start);
    }
    const type = getAttributeValue(attrs, "type");
    if (type) {
        blockAttrs.type = type;
    }
    if (hasBooleanAttribute(attrs, "reversed")) {
        blockAttrs.reversed = true;
    }
    return blockAttrs;
}
/** 将列表内部的顶层 li 转换为 Gutenberg list-item 区块。 */
function convertListItems(inner) {
    const items = readTopLevelListItems(inner);
    if (!items.length) {
        return inner.trim();
    }
    return items
        .map((item) => `<!-- wp:list-item -->${convertListItem(item)}<!-- /wp:list-item -->`)
        .join("");
}
/** 读取列表内部的顶层 li 节点。 */
function readTopLevelListItems(inner) {
    const items = [];
    let index = 0;
    while (index < inner.length) {
        const whitespace = inner.slice(index).match(/^\s+/);
        if (whitespace?.[0]) {
            index += whitespace[0].length;
            continue;
        }
        const openMatch = inner.slice(index).match(/^<li\b[^>]*>/i);
        if (!openMatch?.[0]) {
            const nextItem = inner.slice(index + 1).search(/<li\b/i);
            if (nextItem === -1) {
                break;
            }
            index += nextItem + 1;
            continue;
        }
        const closeEnd = findClosingTagEnd(inner, "li", index + openMatch[0].length);
        if (closeEnd === -1) {
            break;
        }
        items.push(inner.slice(index, closeEnd).trim());
        index = closeEnd;
    }
    return items;
}
/** 转换单个 li 内部的嵌套列表，并保留 li 自身属性。 */
function convertListItem(itemHtml) {
    const match = itemHtml.match(/^<li\b([^>]*)>([\s\S]*)<\/li>$/i);
    if (!match) {
        return itemHtml.trim();
    }
    const attrs = match[1] ?? "";
    const inner = convertNestedListsInListItem(match[2] ?? "");
    return `<li${attrs}>${inner}</li>`;
}
/** 将 li 内部出现的直接嵌套 ul 或 ol 转换为 Gutenberg list 区块。 */
function convertNestedListsInListItem(inner) {
    const nodes = readTopLevelNodes(inner);
    if (!nodes.length) {
        return inner.trim();
    }
    return nodes
        .map((node) => {
        if (node.tag === "ul" || node.tag === "ol") {
            return listBlock(node.raw);
        }
        return node.raw.trim();
    })
        .join("");
}
/** 生成 Gutenberg 图片区块。 */
function imageBlock(raw) {
    const imageHtml = normalizeVoidElement(raw, "img");
    return [
        '<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->',
        `<figure class="wp-block-image size-large">${imageHtml}</figure>`,
        "<!-- /wp:image -->"
    ].join("\n");
}
/** 将 figure 转换为图片区块；没有图片时退回为 group 区块。 */
function figureBlock(raw) {
    if (/<img\b/i.test(raw)) {
        const figureHtml = ensureClass(raw, "figure", "wp-block-image size-large");
        return `<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->\n${figureHtml.trim()}\n<!-- /wp:image -->`;
    }
    return groupBlock(raw);
}
/** 生成 Gutenberg 引用区块。 */
function quoteBlock(raw) {
    const html = ensureClass(raw, "blockquote", "wp-block-quote");
    return `<!-- wp:quote -->\n${html.trim()}\n<!-- /wp:quote -->`;
}
/** 生成 Gutenberg 代码区块。 */
function codeBlock(raw) {
    const inner = extractInnerHtml(raw, "pre");
    const codeHtml = /^<code\b/i.test(inner.trim()) ? inner.trim() : `<code>${inner.trim()}</code>`;
    return `<!-- wp:code -->\n<pre class="wp-block-code">${codeHtml}</pre>\n<!-- /wp:code -->`;
}
/** 生成 Gutenberg 分隔线区块。 */
function separatorBlock() {
    return '<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->';
}
/** 生成 Gutenberg 表格区块。 */
function tableBlock(raw) {
    const tableHtml = ensureClass(raw, "table", "has-fixed-layout");
    return `<!-- wp:table -->\n<figure class="wp-block-table">${tableHtml.trim()}</figure>\n<!-- /wp:table -->`;
}
/** 生成 Gutenberg group 区块，并递归转换 div 内部内容。 */
function groupBlock(raw) {
    const inner = extractInnerHtml(raw, "div");
    const convertedInner = convertHtmlToGutenberg(inner);
    const content = convertedInner || inner.trim();
    return `<!-- wp:group -->\n<div class="wp-block-group">${content}</div>\n<!-- /wp:group -->`;
}
/** 给指定标签追加类名，保留标签上已有的其它属性。 */
function ensureClass(raw, tag, className) {
    const openTag = new RegExp(`^<${escapeRegExp(tag)}\\b([^>]*)>`, "i");
    return raw.replace(openTag, (match, attrs) => {
        const classMatch = attrs.match(/\sclass=(["'])(.*?)\1/i);
        if (classMatch?.[0] && classMatch[2] !== undefined) {
            const classes = classMatch[2].split(/\s+/).filter(Boolean);
            for (const singleClass of className.split(/\s+/).filter(Boolean).reverse()) {
                if (!classes.includes(singleClass)) {
                    classes.unshift(singleClass);
                }
            }
            return match.replace(classMatch[0], ` class="${classes.join(" ")}"`);
        }
        return `<${tag} class="${className}"${attrs}>`;
    });
}
/** 给标签属性字符串追加 class，保留已有 class 与其它属性。 */
function appendClassAttribute(attrs, className) {
    const source = attrs || "";
    const classMatch = source.match(/\sclass=(["'])(.*?)\1/i);
    if (!classMatch?.[0] || classMatch[2] === undefined) {
        const trimmed = source.trim();
        return trimmed ? ` class="${className}" ${trimmed}` : ` class="${className}"`;
    }
    const classes = classMatch[2].split(/\s+/).filter(Boolean);
    if (!classes.includes(className)) {
        classes.unshift(className);
    }
    return source.replace(classMatch[0], ` class="${classes.join(" ")}"`).trimStart();
}
/** 从标签属性字符串中读取指定属性值。 */
function getAttributeValue(attrs, name) {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}=(["'])(.*?)\\1`, "i");
    const match = (attrs || "").match(pattern);
    return match?.[2] ?? "";
}
/** 判断标签属性字符串中是否包含布尔属性。 */
function hasBooleanAttribute(attrs, name) {
    return new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:\\s|$|=)`, "i").test(attrs || "");
}
/** 提取成对标签内部的 HTML。 */
function extractInnerHtml(raw, tag) {
    const pattern = new RegExp(`^<${escapeRegExp(tag)}\\b[^>]*>([\\s\\S]*)<\\/${escapeRegExp(tag)}>$`, "i");
    const match = raw.match(pattern);
    return match?.[1] ?? "";
}
/** 将 void 元素规范化为自闭合 HTML，避免输出裸露的未闭合标签。 */
function normalizeVoidElement(raw, tag) {
    const match = raw.match(new RegExp(`^<${escapeRegExp(tag)}\\b([^>]*)\\/?\\s*>$`, "i"));
    if (!match) {
        return raw.trim();
    }
    const attrs = (match[1] ?? "").replace(/\s+\/$/, "").trim();
    return attrs ? `<${tag} ${attrs}/>` : `<${tag}/>`;
}
/** 移除 HTML 标签，用于识别特殊纯文本段落。 */
function stripTags(html) {
    return html.replace(/<[^>]+>/g, "");
}
/** 转义字符串中的正则特殊字符。 */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
