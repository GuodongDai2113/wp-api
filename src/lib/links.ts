/** WordPress 文章正文对象中当前会读取的字段。 */
export interface WordPressPostContentEntity {
  /** WordPress REST 返回的正文对象。 */
  content?: {
    /** 未渲染的原始正文。 */
    raw?: string;
    /** 已渲染的 HTML 正文。 */
    rendered?: string;
  };
}

/** 添加链接时需要的匹配文本和目标地址。 */
export interface AddLinkOptions {
  /** 需要被替换为链接的精确文本。 */
  text: string;
  /** 链接目标地址。 */
  href: string;
}

/** 添加链接后的结果状态。 */
export interface AddLinkResult {
  /** 是否实际修改了正文。 */
  updated: boolean;
  /** 本次链接操作的状态。 */
  status: "updated" | "not_found" | "skipped_existing_link";
  /** 实际完成的替换次数。 */
  replacements: number;
  /** 修改后或原样返回的正文内容。 */
  content: string;
}

/** 从文章正文中提取出的单个链接。 */
export interface PostLinkEntry {
  /** 链接在正文中的顺序索引。 */
  index: number;
  /** 链接目标地址。 */
  href: string;
  /** 去除内部 HTML 后的可见锚文本。 */
  text: string;
}

/** 更新或移除现有链接时使用的定位和修改参数。 */
export interface ExistingLinkOptions {
  /** 用于定位现有链接的目标地址。 */
  href: string;
  /** 可选锚文本，用于在相同地址存在多次时进一步限定。 */
  text?: string;
  /** 更新操作写入的新目标地址。 */
  newHref?: string;
  /** 更新操作写入的新锚文本。 */
  newText?: string;
}

/** 更新或移除现有链接后的结果。 */
export interface ExistingLinkResult {
  /** 是否实际修改了正文。 */
  updated: boolean;
  /** 操作结果状态。 */
  status: "updated" | "not_found";
  /** 实际修改的链接数量。 */
  replacements: number;
  /** 修改后或保持原样的完整正文。 */
  content: string;
  /** 被修改的原链接，未找到时省略。 */
  link?: PostLinkEntry;
}

/** 内部扫描器记录的完整锚标签范围。 */
interface AnchorRange extends PostLinkEntry {
  /** 开始标签的起始位置。 */
  start: number;
  /** 开始标签的结束位置。 */
  openEnd: number;
  /** 结束标签的起始位置。 */
  closeStart: number;
  /** 结束标签的结束位置。 */
  end: number;
  /** 开始标签原始文本。 */
  openTag: string;
  /** 锚标签内部原始 HTML。 */
  innerHtml: string;
}

/** 从 WordPress 文章对象中提取可编辑原始正文，缺失时拒绝使用渲染结果代替。 */
export function extractPostContent(post: WordPressPostContentEntity): string {
  if (typeof post?.content?.raw === "string") {
    return post.content.raw;
  }

  throw new Error("Editable raw post content is unavailable; rendered content will not be written back.");
}

/** 判断链接地址是否为不含控制字符的 HTTP(S) 或相对地址。 */
export function isSafeLinkHref(href: string): boolean {
  if (href.trim() !== href || /[\u0000-\u001f\u007f]/.test(href)) {
    return false;
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  return !schemeMatch || schemeMatch[1].toLowerCase() === "http" || schemeMatch[1].toLowerCase() === "https";
}

/** 把正文中第一处合格的可见文本精确匹配替换为链接，并跳过已有链接和非文本区域。 */
export function addLinkToContent(content: string, { text, href }: AddLinkOptions): AddLinkResult {
  const anchor = `<a href="${escapeAttribute(href)}">${escapeHtmlText(text)}</a>`;
  let position = 0;
  let anchorDepth = 0;
  let excludedDepth = 0;
  let foundInsideLink = false;

  while (position < content.length) {
    if (content.startsWith("<!--", position)) {
      const commentEnd = content.indexOf("-->", position + 4);
      position = commentEnd === -1 ? content.length : commentEnd + 3;
      continue;
    }

    if (content[position] === "<") {
      const tagEnd = findTagEnd(content, position);
      if (tagEnd === -1) {
        break;
      }
      const tag = content.slice(position, tagEnd + 1);
      const tagMatch = /^<\s*(\/?)\s*([a-zA-Z0-9:-]+)/.exec(tag);
      if (tagMatch) {
        const closing = tagMatch[1] === "/";
        const name = tagMatch[2].toLowerCase();
        if (name === "a") {
          anchorDepth = Math.max(0, anchorDepth + (closing ? -1 : 1));
        } else if (name === "script" || name === "style") {
          excludedDepth = Math.max(0, excludedDepth + (closing ? -1 : 1));
        }
      }
      position = tagEnd + 1;
      continue;
    }

    const textEnd = content.indexOf("<", position);
    const segmentEnd = textEnd === -1 ? content.length : textEnd;
    const segment = content.slice(position, segmentEnd);
    const localMatch = segment.indexOf(text);
    if (localMatch !== -1) {
      if (anchorDepth > 0) {
        foundInsideLink = true;
      } else if (excludedDepth === 0) {
        const matchIndex = position + localMatch;
        return {
          updated: true,
          status: "updated",
          replacements: 1,
          content: `${content.slice(0, matchIndex)}${anchor}${content.slice(matchIndex + text.length)}`
        };
      }
    }
    position = segmentEnd;
  }

  return {
    updated: false,
    status: foundInsideLink ? "skipped_existing_link" : "not_found",
    replacements: 0,
    content
  };
}

/** 列出正文中全部有效锚标签及其地址和可见文本。 */
export function listLinksInContent(content: string): PostLinkEntry[] {
  return findAnchorRanges(content).map(({ index, href, text }) => ({ index, href, text }));
}

/** 更新正文中第一条符合地址和可选锚文本条件的链接。 */
export function updateLinkInContent(content: string, options: ExistingLinkOptions): ExistingLinkResult {
  const anchor = findMatchingAnchor(content, options);
  if (!anchor) {
    return { updated: false, status: "not_found", replacements: 0, content };
  }

  const openTag = options.newHref === undefined
    ? anchor.openTag
    : replaceHrefAttribute(anchor.openTag, options.newHref);
  const innerHtml = options.newText === undefined ? anchor.innerHtml : escapeHtmlText(options.newText);
  return {
    updated: true,
    status: "updated",
    replacements: 1,
    content: `${content.slice(0, anchor.start)}${openTag}${innerHtml}</a>${content.slice(anchor.end)}`,
    link: { index: anchor.index, href: anchor.href, text: anchor.text }
  };
}

/** 移除正文中第一条匹配链接的锚标签外壳，并保留其内部 HTML。 */
export function removeLinkFromContent(content: string, options: ExistingLinkOptions): ExistingLinkResult {
  const anchor = findMatchingAnchor(content, options);
  if (!anchor) {
    return { updated: false, status: "not_found", replacements: 0, content };
  }

  return {
    updated: true,
    status: "updated",
    replacements: 1,
    content: `${content.slice(0, anchor.start)}${anchor.innerHtml}${content.slice(anchor.end)}`,
    link: { index: anchor.index, href: anchor.href, text: anchor.text }
  };
}

/** 按地址和可选锚文本查找第一条符合条件的链接。 */
function findMatchingAnchor(content: string, options: ExistingLinkOptions): AnchorRange | undefined {
  return findAnchorRanges(content).find((link) => (
    link.href === options.href && (options.text === undefined || link.text === options.text)
  ));
}

/** 扫描正文中位于正常 HTML 区域的完整锚标签。 */
function findAnchorRanges(content: string): AnchorRange[] {
  const anchors: AnchorRange[] = [];
  const openAnchors: Array<{ start: number; openEnd: number; openTag: string; href: string }> = [];
  let position = 0;
  let excludedDepth = 0;

  while (position < content.length) {
    if (content.startsWith("<!--", position)) {
      const commentEnd = content.indexOf("-->", position + 4);
      position = commentEnd === -1 ? content.length : commentEnd + 3;
      continue;
    }
    if (content[position] !== "<") {
      position += 1;
      continue;
    }

    const tagEnd = findTagEnd(content, position);
    if (tagEnd === -1) {
      break;
    }
    const tag = content.slice(position, tagEnd + 1);
    const tagMatch = /^<\s*(\/?)\s*([a-zA-Z0-9:-]+)/.exec(tag);
    if (tagMatch) {
      const closing = tagMatch[1] === "/";
      const name = tagMatch[2].toLowerCase();
      if (name === "script" || name === "style") {
        excludedDepth = Math.max(0, excludedDepth + (closing ? -1 : 1));
      } else if (name === "a" && excludedDepth === 0) {
        if (!closing) {
          const href = readHrefAttribute(tag);
          if (href !== undefined) {
            openAnchors.push({ start: position, openEnd: tagEnd + 1, openTag: tag, href });
          }
        } else {
          const opening = openAnchors.pop();
          if (opening) {
            const innerHtml = content.slice(opening.openEnd, position);
            anchors.push({
              index: anchors.length,
              href: opening.href,
              text: htmlToPlainText(innerHtml),
              start: opening.start,
              openEnd: opening.openEnd,
              closeStart: position,
              end: tagEnd + 1,
              openTag: opening.openTag,
              innerHtml
            });
          }
        }
      }
    }
    position = tagEnd + 1;
  }

  return anchors.sort((left, right) => left.start - right.start).map((anchor, index) => ({ ...anchor, index }));
}

/** 从锚标签开始标签中读取并解码 href 属性。 */
function readHrefAttribute(tag: string): string | undefined {
  const match = /\bhref\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i.exec(tag);
  const value = match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeHtmlEntities(value);
}

/** 在保留其他属性的前提下替换锚标签的 href 属性值。 */
function replaceHrefAttribute(tag: string, href: string): string {
  const escaped = escapeAttribute(href);
  return tag.replace(/\bhref\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i, `href="${escaped}"`);
}

/** 将锚标签内部 HTML 转换为用于定位和展示的纯文本。 */
function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(html.replace(/<!--[^]*?-->/g, "").replace(/<[^>]*>/g, ""));
}

/** 解码链接地址和锚文本中常见的 HTML 实体。 */
function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** 查找 HTML 标签结束位置，并忽略引号内出现的大于号的情况。 */
function findTagEnd(content: string, start: number): number {
  let quote: "\"" | "'" | null = null;
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

/** 转义 HTML 文本节点中的特殊字符。 */
function escapeHtmlText(value: string): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** 转义 HTML 属性值中的特殊字符。 */
function escapeAttribute(value: string): string {
  return escapeHtmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
