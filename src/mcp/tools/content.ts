import { replaceContentText, type ReplaceContentTextResult } from "../../wordpress/content/replace.js";
import {
  addLinkToContent,
  extractPostContent,
  isSafeLinkHref,
  listLinksInContent,
  removeLinkFromContent,
  updateLinkInContent,
  type PostLinkEntry
} from "../../wordpress/content/links.js";
import {
  type UploadMediaOptions,
  WordPressClient
} from "../../wordpress/client.js";
import { assertPositiveId } from "../shared/validation.js";
import type { WordPressResourceEntity } from "./resources.js";

/** 文章链接工具接收的 MCP 风格输入。 */
export interface PostLinkInput {
  /** 要执行的链接动作。 */
  action: "list" | "add" | "update" | "remove";
  /** 要读取或更新的正安全整数文章 ID。 */
  postId: number;
  /** 添加动作的匹配文本，或更新和移除动作的可选锚文本过滤条件。 */
  text?: string;
  /** 添加动作的目标地址，或更新和移除动作定位的现有地址。 */
  href?: string;
  /** 更新动作写入的新目标地址。 */
  newHref?: string;
  /** 更新动作写入的新锚文本。 */
  newText?: string;
}

/** 文章链接工具返回的稳定结构。 */
export interface PostLinkPayload {
  /** 文章 ID。 */
  id: number;
  /** 固定资源名称。 */
  resource: "posts";
  /** 实际执行的链接动作。 */
  action: "links.list" | "links.add" | "links.update" | "links.remove";
  /** 是否实际更新了文章正文。 */
  updated: boolean;
  /** 链接操作结果状态。 */
  status: "listed" | "updated" | "not_found" | "skipped_existing_link";
  /** 被匹配的文本。 */
  text?: string;
  /** 原链接或新增链接的目标地址。 */
  href?: string;
  /** 更新后的链接目标地址。 */
  newHref?: string;
  /** 更新后的锚文本。 */
  newText?: string;
  /** 实际修改的链接数量。 */
  replacements: number;
  /** 列表动作返回的全部链接。 */
  links?: PostLinkEntry[];
}

/** 文章正文替换工具接收的 MCP 风格输入。 */
export interface PostContentReplaceInput {
  /** 要更新的正安全整数文章 ID。 */
  postId: number;
  /** 需要精确匹配的非空原文本。 */
  text: string;
  /** 替换文本，允许空字符串用于删除匹配内容。 */
  replacement: string;
}

/** 文章正文替换工具返回的稳定结构。 */
export interface PostContentReplacePayload {
  /** 文章 ID。 */
  id: number;
  /** 固定资源名称。 */
  resource: "posts";
  /** 固定动作名称。 */
  action: "content.replace";
  /** 是否实际更新了文章正文。 */
  updated: boolean;
  /** 文本替换结果状态。 */
  status: ReplaceContentTextResult["status"];
  /** 被匹配的原文本。 */
  text: string;
  /** 用于替换的新文本。 */
  replacement: string;
  /** 实际替换次数。 */
  replacements: number;
}

/** 媒体上传工具接收的 MCP 风格输入。 */
export interface MediaUploadInput {
  /** MCP 服务进程可读取的本地媒体文件路径。 */
  filePath: string;
  /** WordPress 媒体标题。 */
  title?: string;
  /** WordPress 媒体替代文本。 */
  altText?: string;
  /** WordPress 媒体说明文字。 */
  caption?: string;
  /** WordPress 媒体描述。 */
  description?: string;
}

/** WordPress 媒体附件返回的最小稳定结构。 */
export interface MediaUploadPayload {
  /** WordPress 媒体附件 ID。 */
  id?: number;
  /** WordPress 媒体附件源文件 URL。 */
  source_url?: string;
  /** WordPress 媒体附件标题。 */
  title?: {
    /** 已渲染的标题文本。 */
    rendered?: string;
  };
  /** WordPress 媒体附件 slug。 */
  slug?: string;
  /** 允许保留 WordPress 返回的其他媒体字段。 */
  [key: string]: unknown;
}

/** 列出、添加、更新或移除文章正文中的链接。 */
export async function managePostLink(
  client: WordPressClient,
  input: PostLinkInput
): Promise<PostLinkPayload> {
  assertPositiveId(input.postId, "Post id");
  if (input.action === "add" && (!input.text || !input.href)) {
    throw new Error("Link add requires text and href.");
  }
  if ((input.action === "update" || input.action === "remove") && !input.href) {
    throw new Error(`Link ${input.action} requires href.`);
  }
  if (input.action === "update" && input.newHref === undefined && input.newText === undefined) {
    throw new Error("Link update requires newHref or newText.");
  }

  for (const href of [input.href, input.newHref].filter((value): value is string => value !== undefined)) {
    if (!isSafeLinkHref(href)) {
      throw new Error("Link href must be an HTTP(S) URL or a relative URL without control characters.");
    }
  }

  const entity = await client.get<WordPressResourceEntity>("posts", input.postId, { context: "edit" });
  const content = extractPostContent(entity);
  if (input.action === "list") {
    return {
      id: input.postId,
      resource: "posts",
      action: "links.list",
      updated: false,
      status: "listed",
      replacements: 0,
      links: listLinksInContent(content)
    };
  }

  const result = input.action === "add"
    ? addLinkToContent(content, { text: input.text as string, href: input.href as string })
    : input.action === "update"
      ? updateLinkInContent(content, {
        href: input.href as string,
        text: input.text,
        newHref: input.newHref,
        newText: input.newText
      })
      : removeLinkFromContent(content, { href: input.href as string, text: input.text });

  if (result.updated) {
    await client.update("posts", input.postId, { content: result.content });
  }
  return {
    id: input.postId,
    resource: "posts",
    action: `links.${input.action}`,
    updated: result.updated,
    status: result.status,
    text: input.text,
    href: input.href,
    newHref: input.newHref,
    newText: input.newText,
    replacements: result.replacements
  };
}

/** 精确替换文章正文中的全部匹配文本，并仅在内容变化时写回。 */
export async function replacePostContent(
  client: WordPressClient,
  input: PostContentReplaceInput
): Promise<PostContentReplacePayload> {
  assertPositiveId(input.postId, "Post id");
  if (!input.text) {
    throw new Error("Replacement text to find must not be empty.");
  }
  if (typeof input.replacement !== "string") {
    throw new Error("Replacement must be a string.");
  }

  const entity = await client.get<WordPressResourceEntity>("posts", input.postId, { context: "edit" });
  const result = replaceContentText(extractPostContent(entity), {
    text: input.text,
    replacement: input.replacement
  });
  if (result.updated) {
    await client.update("posts", input.postId, { content: result.content });
  }
  return {
    id: input.postId,
    resource: "posts",
    action: "content.replace",
    updated: result.updated,
    status: result.status,
    text: input.text,
    replacement: input.replacement,
    replacements: result.replacements
  };
}

/** 从本地文件上传媒体，并把 MCP camelCase 元数据映射为 WordPress client 选项。 */
export async function uploadMedia(
  client: WordPressClient,
  input: MediaUploadInput
): Promise<MediaUploadPayload> {
  if (!input.filePath) {
    throw new Error("Media filePath is required.");
  }
  const options = Object.fromEntries(Object.entries({
    title: input.title,
    altText: input.altText,
    caption: input.caption,
    description: input.description
  }).filter(([, value]) => value !== undefined && value !== "")) as UploadMediaOptions;
  return client.uploadMediaFromFile<MediaUploadPayload>(input.filePath, options);
}
