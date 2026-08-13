import { resolveContentInput } from "../../lib/content-input.js";
import { replaceContentText, type ReplaceContentTextResult } from "../../lib/content-replace.js";
import { convertHtmlToGutenberg } from "../../lib/html-to-gutenberg.js";
import {
  addLinkToContent,
  extractPostContent,
  isSafeLinkHref,
  listLinksInContent,
  removeLinkFromContent,
  updateLinkInContent,
  type PostLinkEntry
} from "../../lib/links.js";
import { getResourceConfig } from "../../lib/resources.js";
import {
  type ListResult,
  type QueryParams,
  type UploadMediaOptions,
  WordPressClient
} from "../../lib/wp-client.js";

/** 纯 MCP 内容工具支持的 WordPress 资源名称。 */
export type ContentResourceName = "posts" | "pages" | "products" | "categories" | "product-categories";

/** WordPress REST 内容实体中业务逻辑会读取的最小字段集合。 */
export interface WordPressResourceEntity {
  /** 实体 ID。 */
  id?: number;
  /** WordPress 渲染标题对象。 */
  title?: {
    /** 已渲染的标题文本。 */
    rendered?: string;
  };
  /** taxonomy 实体名称。 */
  name?: string;
  /** 实体 slug。 */
  slug?: string;
  /** WordPress REST meta 字段。 */
  meta?: Record<string, unknown>;
  /** WordPress 文章正文对象。 */
  content?: {
    /** 可安全写回的未渲染正文。 */
    raw?: string;
    /** 仅用于展示的已渲染正文。 */
    rendered?: string;
  };
  /** 允许保留 WordPress 或插件返回的其他字段。 */
  [key: string]: unknown;
}

/** 资源列表工具接收的 MCP 风格输入。 */
export interface ResourceListInput {
  /** 要列出的资源类型。 */
  resource: ContentResourceName;
  /** 可选全文搜索文本。 */
  search?: string;
  /** 可选页码，必须为正安全整数。 */
  page?: number;
  /** 每页条目数，允许 -1 表示读取全部分页。 */
  perPage?: number;
  /** 可选资源状态过滤条件。 */
  status?: string;
}

/** 单个资源读取工具接收的 MCP 风格输入。 */
export interface ResourceGetInput {
  /** 要读取的资源类型。 */
  resource: ContentResourceName;
  /** 要读取的正安全整数资源 ID。 */
  id: number;
}

/** 资源创建和更新工具共享的 MCP 风格字段。 */
export interface ResourceBodyInput {
  /** 文章、页面或产品标题。 */
  title?: string;
  /** 资源 slug。 */
  slug?: string;
  /** 文章、页面或产品状态。 */
  status?: string;
  /** 文章、页面或产品摘要。 */
  excerpt?: string;
  /** 直接传入的正文内容，优先级高于 contentFile。 */
  content?: string;
  /** 保存正文内容的本地文件路径。 */
  contentFile?: string;
  /** 是否把解析后的 HTML 正文转换为 Gutenberg 区块标记。 */
  gutenberg?: boolean;
  /** 特色媒体附件 ID，0 表示清空。 */
  featuredMedia?: number;
  /** 文章分类 ID 数组，空数组表示清空。 */
  categories?: number[];
  /** taxonomy 资源名称。 */
  name?: string;
  /** taxonomy 资源描述。 */
  description?: string;
  /** taxonomy 父级 ID，0 表示移除父级。 */
  parent?: number;
}

/** 资源创建工具接收的 MCP 风格输入。 */
export interface ResourceCreateInput extends ResourceBodyInput {
  /** 要创建的资源类型。 */
  resource: ContentResourceName;
}

/** 资源更新工具接收的 MCP 风格输入。 */
export interface ResourceUpdateInput extends ResourceBodyInput {
  /** 要更新的资源类型。 */
  resource: ContentResourceName;
  /** 要更新的正安全整数资源 ID。 */
  id: number;
}

/** 资源删除工具接收的 MCP 风格输入。 */
export interface ResourceDeleteInput extends ResourceGetInput {
  /** 是否执行永久删除；taxonomy 资源必须显式设为 true。 */
  force?: boolean;
}

/** Rank Math SEO 读取工具接收的 MCP 风格输入。 */
export type ResourceSeoGetInput = ResourceGetInput;

/** Rank Math SEO 更新工具接收的 MCP 风格输入。 */
export interface ResourceSeoUpdateInput extends ResourceGetInput {
  /** Rank Math SEO 标题，空字符串表示清空。 */
  title?: string;
  /** Rank Math SEO 描述，空字符串表示清空。 */
  description?: string;
  /** Rank Math 焦点关键词，空字符串表示清空。 */
  focusKeyword?: string;
}

/** Rank Math SEO 工具返回的稳定结构。 */
export interface ResourceSeoPayload {
  /** 实际返回或请求的资源 ID。 */
  id: number;
  /** 对应的资源类型。 */
  resource: ContentResourceName;
  /** Rank Math SEO 标题。 */
  rank_math_title: string;
  /** Rank Math SEO 描述。 */
  rank_math_description: string;
  /** Rank Math 焦点关键词。 */
  rank_math_focus_keyword: string;
}

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

/** 仅移除未提供的字段，并保留空字符串、0 和空数组的显式清空语义。 */
function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/** 校验 ID 是可安全传给 WordPress REST API 的正整数。 */
function assertPositiveId(id: number, label: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

/** 校验可清空的 WordPress ID 字段是非负安全整数。 */
function assertOptionalNonNegativeId(id: number | undefined, label: string): void {
  if (id !== undefined && (!Number.isSafeInteger(id) || id < 0)) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

/** 校验分类数组仅包含正安全整数，同时允许空数组清空分类。 */
function assertCategories(categories: number[] | undefined): void {
  if (categories !== undefined && (
    !Array.isArray(categories)
    || categories.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )) {
    throw new Error("Categories must contain only positive integers.");
  }
}

/** 返回输入中所有已经显式提供的字段名称。 */
function findProvidedFields(input: ResourceBodyInput, fields: readonly (keyof ResourceBodyInput)[]): string[] {
  return fields.filter((field) => input[field] !== undefined);
}

/**
 * 校验资源写入字段与内容或 taxonomy 类型一致。
 * 明确拒绝不适用字段，避免调用方误以为已保存但服务实际静默丢弃。
 */
function assertResourceBodyFields(resource: ContentResourceName, input: ResourceBodyInput): void {
  const config = getResourceConfig(resource);
  const unsupportedFields = config.kind === "taxonomy"
    ? findProvidedFields(input, [
      "title",
      "status",
      "excerpt",
      "content",
      "contentFile",
      "gutenberg",
      "featuredMedia",
      "categories"
    ])
    : findProvidedFields(input, ["name", "description", "parent"]);

  if (unsupportedFields.length > 0) {
    throw new Error(
      `Fields are not supported for ${resource}: ${unsupportedFields.join(", ")}.`
    );
  }
}

/** 把 MCP 资源写入输入转换为 WordPress REST 请求体。 */
async function buildResourceBody(resource: ContentResourceName, input: ResourceBodyInput): Promise<Record<string, unknown>> {
  assertResourceBodyFields(resource, input);
  const config = getResourceConfig(resource);
  if (config.kind === "taxonomy") {
    assertOptionalNonNegativeId(input.parent, "Parent");
    return compactObject({
      name: input.name,
      slug: input.slug,
      description: input.description,
      parent: input.parent
    });
  }

  assertOptionalNonNegativeId(input.featuredMedia, "Featured media");
  assertCategories(input.categories);
  const resolvedContent = await resolveContentInput({
    content: input.content,
    contentFile: input.contentFile
  });
  const content = resolvedContent === undefined
    ? undefined
    : input.gutenberg
      ? convertHtmlToGutenberg(resolvedContent)
      : resolvedContent;

  return compactObject({
    title: input.title,
    slug: input.slug,
    status: input.status,
    excerpt: input.excerpt,
    content,
    featured_media: input.featuredMedia,
    categories: input.categories
  });
}

/** 从 WordPress 实体中提取稳定的 Rank Math SEO 返回结构。 */
function extractResourceSeo(
  resource: ContentResourceName,
  entity: WordPressResourceEntity,
  requestedId: number
): ResourceSeoPayload {
  const meta = entity.meta ?? {};
  return {
    id: typeof entity.id === "number" ? entity.id : requestedId,
    resource,
    rank_math_title: String(meta.rank_math_title ?? ""),
    rank_math_description: String(meta.rank_math_description ?? ""),
    rank_math_focus_keyword: String(meta.rank_math_focus_keyword ?? "")
  };
}

/** 列出指定 WordPress 内容或 taxonomy 资源。 */
export async function listResource(
  client: WordPressClient,
  input: ResourceListInput
): Promise<ListResult<WordPressResourceEntity>> {
  if (input.page !== undefined) {
    assertPositiveId(input.page, "Page");
  }
  if (input.perPage !== undefined && (
    !Number.isSafeInteger(input.perPage)
    || (input.perPage !== -1 && (input.perPage < 1 || input.perPage > 100))
  )) {
    throw new Error("Items per page must be -1 or between 1 and 100.");
  }

  const config = getResourceConfig(input.resource);
  const query = compactObject({
    search: input.search,
    page: input.page,
    per_page: input.perPage,
    status: input.status
  }) as QueryParams;
  return client.list<WordPressResourceEntity>(config.route, query);
}

/** 按 ID 读取单个 WordPress 内容或 taxonomy 资源。 */
export async function getResource(
  client: WordPressClient,
  input: ResourceGetInput
): Promise<WordPressResourceEntity> {
  assertPositiveId(input.id, "Resource id");
  const config = getResourceConfig(input.resource);
  return client.get<WordPressResourceEntity>(config.route, input.id);
}

/** 创建单个 WordPress 内容或 taxonomy 资源。 */
export async function createResource(
  client: WordPressClient,
  input: ResourceCreateInput
): Promise<WordPressResourceEntity> {
  const config = getResourceConfig(input.resource);
  const body = await buildResourceBody(input.resource, input);
  if (Object.keys(body).length === 0) {
    throw new Error("At least one applicable resource field is required to create a resource.");
  }
  return client.create<WordPressResourceEntity>(config.route, body);
}

/** 更新单个 WordPress 内容或 taxonomy 资源，并拒绝无字段更新。 */
export async function updateResource(
  client: WordPressClient,
  input: ResourceUpdateInput
): Promise<WordPressResourceEntity> {
  assertPositiveId(input.id, "Resource id");
  const config = getResourceConfig(input.resource);
  const body = await buildResourceBody(input.resource, input);
  if (Object.keys(body).length === 0) {
    throw new Error("No update fields were provided.");
  }
  return client.update<WordPressResourceEntity>(config.route, input.id, body);
}

/** 删除单个 WordPress 资源，并要求 taxonomy 永久删除得到显式确认。 */
export async function deleteResource(
  client: WordPressClient,
  input: ResourceDeleteInput
): Promise<WordPressResourceEntity> {
  assertPositiveId(input.id, "Resource id");
  const config = getResourceConfig(input.resource);
  if (config.deleteMode === "force" && input.force !== true) {
    throw new Error("Taxonomy terms do not support trash; set force to true to confirm permanent deletion.");
  }
  return client.delete<WordPressResourceEntity>(config.route, input.id, {
    force: config.deleteMode === "force" ? true : input.force === true
  });
}

/** 读取指定资源的 Rank Math SEO 字段。 */
export async function getResourceSeo(
  client: WordPressClient,
  input: ResourceSeoGetInput
): Promise<ResourceSeoPayload> {
  const entity = await getResource(client, input);
  return extractResourceSeo(input.resource, entity, input.id);
}

/** 更新指定资源的 Rank Math SEO 字段，并保留空字符串清空语义。 */
export async function updateResourceSeo(
  client: WordPressClient,
  input: ResourceSeoUpdateInput
): Promise<ResourceSeoPayload> {
  assertPositiveId(input.id, "Resource id");
  if (input.title === undefined && input.description === undefined && input.focusKeyword === undefined) {
    throw new Error("wp_seo_update requires at least one SEO field to update.");
  }

  const config = getResourceConfig(input.resource);
  const meta = compactObject({
    rank_math_title: input.title,
    rank_math_description: input.description,
    rank_math_focus_keyword: input.focusKeyword
  });
  const entity = await client.update<WordPressResourceEntity>(config.route, input.id, { meta });
  return extractResourceSeo(input.resource, entity, input.id);
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
