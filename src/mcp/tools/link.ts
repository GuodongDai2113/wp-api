import {
  addLinkToContent,
  extractPostContent,
  isSafeLinkHref,
  listLinksInContent,
  removeLinkFromContent,
  updateLinkInContent,
  type PostLinkEntry
} from "../../wordpress/content/links.js";
import { WordPressClient } from "../../wordpress/client.js";
import { getResourceConfig, type PostResourceName } from "../../wordpress/resources.js";
import { assertPositiveId } from "../shared/validation.js";
import type { WordPressResourceEntity } from "./resources.js";

/** 链接工具接收的 MCP 风格输入。 */
export interface LinkInput {
  /** 要操作的文章、页面或产品资源。 */
  resource: PostResourceName;
  /** 要执行的链接动作。 */
  action: "list" | "add" | "update" | "remove";
  /** 要读取或更新的正安全整数资源 ID。 */
  id: number;
  /** 添加动作的匹配文本，或更新和移除动作的可选锚文本过滤条件。 */
  text?: string;
  /** 添加动作的目标地址，或更新和移除动作定位的现有地址。 */
  href?: string;
  /** 更新动作写入的新目标地址。 */
  newHref?: string;
  /** 更新动作写入的新锚文本。 */
  newText?: string;
}

/** 链接工具返回的稳定结构。 */
export interface LinkPayload {
  /** 文章、页面或产品 ID。 */
  id: number;
  /** 实际操作的资源名称。 */
  resource: PostResourceName;
  /** 实际执行的链接动作。 */
  action: "links.list" | "links.add" | "links.update" | "links.remove";
  /** 是否实际更新了资源正文。 */
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

/** 返回 post 类型资源的 WordPress REST route，并拒绝非 post 类型资源。 */
function getPostResourceRoute(resource: PostResourceName): string {
  const config = getResourceConfig(resource);
  if (config.type !== "post") {
    throw new Error(`Link tool supports only posts, pages, and products: ${String(resource)}.`);
  }
  return config.route;
}

/** 列出、添加、更新或移除文章、页面或产品正文中的链接。 */
export async function manageLink(
  client: WordPressClient,
  input: LinkInput
): Promise<LinkPayload> {
  assertPositiveId(input.id, "Resource id");
  const route = getPostResourceRoute(input.resource);
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

  const entity = await client.get<WordPressResourceEntity>(route, input.id, { context: "edit", _fields: "id,content" });
  const content = extractPostContent(entity);
  if (input.action === "list") {
    return {
      id: input.id,
      resource: input.resource,
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
    await client.update(route, input.id, { content: result.content }, { _fields: "id" });
  }
  return {
    id: input.id,
    resource: input.resource,
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
