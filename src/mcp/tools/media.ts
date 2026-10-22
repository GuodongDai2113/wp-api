import { type UploadMediaOptions, type ListResult, WordPressClient } from "../../wordpress/client.js";
import { assertPositiveId, assertPerPage, assertUniquePositiveIds } from "../shared/validation.js";

/** 媒体批量导入输入，每个条目使用与单文件上传相同的字段。 */
export interface MediaBatchImportInput {
  /** 按输入顺序导入的 1 至 100 个本地媒体文件及其元数据。 */
  items: MediaUploadInput[];
}

/** 单个媒体导入结果，失败不代表远端一定没有创建附件。 */
export interface MediaImportItemResult {
  /** 对应输入数组的零基索引。 */
  index: number;
  /** 对应的本地文件路径。 */
  filePath: string;
  /** 是否确认上传及所请求元数据设置成功。 */
  success: boolean;
  /** 确认成功时返回的附件 ID。 */
  id?: number;
  /** 成功附件的文件地址。 */
  source_url?: string;
  /** 失败原因的有界摘要。 */
  error?: string;
}

/** 批量导入汇总与逐项回执，不重复返回完整附件实体。 */
export interface MediaBatchImportResult {
  /** 输入文件总数。 */
  total: number;
  /** 确认成功的数量。 */
  succeeded: number;
  /** 未确认成功的数量。 */
  failed: number;
  /** 与输入顺序一致的逐项结果。 */
  items: MediaImportItemResult[];
  /** 发生失败时的恢复提示，避免未知写入状态造成重复附件。 */
  next?: string;
}

/** 在任何上传前校验全部条目的字段，避免后续输入错误导致部分导入。 */
export function validateMediaBatchImport(input: MediaBatchImportInput): void {
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
    throw new TypeError("Media import items must contain 1 to 100 entries.");
  }
  for (const item of input.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || typeof item.filePath !== "string" || !item.filePath.trim()) {
      throw new TypeError("Each media import item requires a non-blank filePath.");
    }
    for (const [key, value] of Object.entries(item)) {
      if (!["filePath", "title", "altText", "caption", "description", "categories", "post"].includes(key)) {
        throw new TypeError(`Unsupported media import field: ${key}.`);
      }
      if (key !== "categories" && key !== "post" && value !== undefined && typeof value !== "string") {
        throw new TypeError(`Media import ${key} must be a string.`);
      }
    }
    assertUniquePositiveIds(item.categories, "Media categories");
    if (item.post !== undefined) assertMediaParent(item.post);
  }
}

/** 顺序导入媒体，复用单文件上传与失败清理；单项失败后继续，不自动重试写入。 */
export async function batchImportMedia(client: WordPressClient, input: MediaBatchImportInput): Promise<MediaBatchImportResult> {
  validateMediaBatchImport(input);
  const items: MediaImportItemResult[] = [];
  for (const [index, item] of input.items.entries()) {
    try {
      const media = await uploadMedia(client, item);
      assertPositiveId(media.id, "Uploaded media id");
      items.push({ index, filePath: item.filePath, success: true, id: media.id, source_url: media.source_url });
    } catch (error) {
      items.push({ index, filePath: item.filePath, success: false,
        error: (error instanceof Error ? error.message : "Media import failed.").slice(0, 1000) });
    }
  }
  const succeeded = items.filter((item) => item.success).length;
  const failed = items.length - succeeded;
  return { total: items.length, succeeded, failed, items,
    ...(failed ? { next: "Check failed items against the media library before retrying: timeouts or cleanup failures may leave attachments. Do not re-import successful items." } : {}) };
}

/** Jelly Editor 媒体分类的分页查询条件。 */
export interface MediaCategoryListInput {
  /** 页码，从 1 开始。 */
  page?: number;
  /** 每页条数，默认 20，最大 100。 */
  perPage?: number;
  /** 分类名称搜索文本。 */
  search?: string;
  /** 父分类 ID；0 仅查询顶级分类。 */
  parent?: number;
  /** 是否隐藏未分配附件的分类；默认 false。 */
  hideEmpty?: boolean;
}

/** 媒体分类的可写字段。 */
export interface MediaCategoryData {
  /** 分类名称；创建必填，更新时不得为空。 */
  name?: string;
  /** 分类别名。 */
  slug?: string;
  /** 分类描述；空字符串清空。 */
  description?: string;
  /** 父分类 ID；0 设置为顶级分类。 */
  parent?: number;
}

/** 创建媒体分类的输入。 */
export interface MediaCategoryCreateInput {
  /** 创建字段，必须包含非空 name。 */
  data: MediaCategoryData;
}

/** 读取媒体分类的输入。 */
export interface MediaCategoryGetInput {
  /** 正安全整数分类 ID。 */
  categoryId: number;
}

/** 更新媒体分类的输入。 */
export interface MediaCategoryUpdateInput extends MediaCategoryGetInput {
  /** 仅包含需要修改的分类字段。 */
  data: MediaCategoryData;
}

/** 删除媒体分类的输入；不会删除附件文件。 */
export interface MediaCategoryDeleteInput extends MediaCategoryGetInput {
  /** 分类不支持回收站，必须显式确认永久删除。 */
  force: true;
}

/** 校验分类写入字段并保留清空描述和设置顶级分类的语义。 */
function buildMediaCategoryData(data: MediaCategoryData, creating = false): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("Category data must be an object.");
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!["name", "slug", "description", "parent"].includes(key)) throw new TypeError(`Unsupported category field: ${key}.`);
    if (value === undefined) continue;
    if (key === "parent") assertMediaParent(value);
    else if (typeof value !== "string" || key === "name" && value.trim() === "") throw new TypeError(`Invalid category ${key}.`);
    body[key] = value;
  }
  if (creating && !body.name) throw new TypeError("Category name is required.");
  if (!Object.keys(body).length) throw new TypeError("Category update requires at least one field.");
  return body;
}

/** 分页读取媒体分类，包括尚未分配附件的空分类。 */
export async function listMediaCategories(client: WordPressClient, input: MediaCategoryListInput): Promise<ListResult> {
  if (input.page !== undefined) assertPositiveId(input.page, "Category page");
  assertPerPage(input.perPage);
  if (input.parent !== undefined) assertMediaParent(input.parent);
  if (input.search !== undefined && typeof input.search !== "string") throw new TypeError("Category search must be a string.");
  if (input.hideEmpty !== undefined && typeof input.hideEmpty !== "boolean") throw new TypeError("Category hideEmpty must be a boolean.");
  return client.list("media_category", {
    page: input.page ?? 1, per_page: input.perPage ?? 20, search: input.search,
    parent: input.parent, hide_empty: input.hideEmpty ?? false
  });
}

/** 按 ID 读取媒体分类；缺失插件或权限错误由远端明确返回。 */
export async function getMediaCategory(client: WordPressClient, input: MediaCategoryGetInput): Promise<unknown> {
  assertPositiveId(input.categoryId, "Category id");
  return client.get("media_category", input.categoryId);
}

/** 创建媒体分类，名称必填，支持父子层级。 */
export async function createMediaCategory(client: WordPressClient, input: MediaCategoryCreateInput): Promise<unknown> {
  return client.create("media_category", buildMediaCategoryData(input.data, true));
}

/** 更新指定媒体分类的名称、描述、别名或父分类。 */
export async function updateMediaCategory(client: WordPressClient, input: MediaCategoryUpdateInput): Promise<unknown> {
  assertPositiveId(input.categoryId, "Category id");
  if (input.data?.parent === input.categoryId) throw new TypeError("A category cannot be its own parent.");
  return client.update("media_category", input.categoryId, buildMediaCategoryData(input.data));
}

/** 永久删除媒体分类及其关联关系，不删除原媒体附件或文件。 */
export async function deleteMediaCategory(client: WordPressClient, input: MediaCategoryDeleteInput): Promise<unknown> {
  assertPositiveId(input.categoryId, "Category id");
  if (input.force !== true) throw new TypeError("Category deletion requires force: true.");
  return client.delete("media_category", input.categoryId, { force: true });
}

/** 媒体列表的分页与筛选条件。 */
export interface MediaListInput {
  /** 页码，从 1 开始。 */
  page?: number;
  /** 每页数量，范围 1 至 100，默认 20。 */
  perPage?: number;
  /** 标题或正文搜索文本。 */
  search?: string;
  /** 限定返回的附件 ID 列表。 */
  include?: number[];
  /** 排除的附件 ID 列表。 */
  exclude?: number[];
  /** 所属文章 ID；0 表示未附加到文章。 */
  parent?: number;
  /** 媒体大类，例如 image、video、audio 或 application。 */
  mediaType?: "image" | "video" | "audio" | "application" | "text";
  /** 精确 MIME 类型，例如 image/webp。 */
  mimeType?: string;
  /** 按 Jelly Editor 媒体分类 ID 筛选，匹配任一分类。 */
  categories?: number[];
}

/** 单个媒体附件的读取输入。 */
export interface MediaGetInput {
  /** 需要读取的正安全整数附件 ID。 */
  mediaId: number;
  /** view 返回展示内容；edit 返回可编辑原始字段并要求编辑权限。 */
  context?: "view" | "edit";
}

/** 媒体附件允许更新的元数据；不替换原始文件。 */
export interface MediaDataInput {
  /** 媒体标题，空字符串清空。 */
  title?: string;
  /** 替代文本，空字符串清空。 */
  altText?: string;
  /** 媒体说明文字，空字符串清空。 */
  caption?: string;
  /** 媒体描述，空字符串清空。 */
  description?: string;
  /** 媒体别名，由 WordPress 规范化。 */
  slug?: string;
  /** 所属文章 ID，0 解除附件与文章的关联。 */
  post?: number;
  /** 替换附件的全部媒体分类；空数组清空，省略保持不变。 */
  categories?: number[];
}

/** 更新现有媒体元数据的输入。 */
export interface MediaUpdateInput {
  /** 要修改的附件 ID。 */
  mediaId: number;
  /** 仅包含本次需要修改的字段。 */
  data: MediaDataInput;
}

/** 永久删除媒体附件的输入。 */
export interface MediaDeleteInput {
  /** 要删除的附件 ID。 */
  mediaId: number;
  /** 必须显式传 true；附件及其文件将永久删除。 */
  force: true;
}

/** 校验文章关联 ID，允许用 0 表示没有关联文章。 */
function assertMediaParent(value: unknown): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Media parent/post must be a non-negative safe integer.");
  }
}

/** 分页读取媒体库，保留 WordPress 返回的实体及分页信息。 */
export async function listMedia(client: WordPressClient, input: MediaListInput): Promise<ListResult<MediaUploadPayload>> {
  if (input.page !== undefined) assertPositiveId(input.page, "Media page");
  assertPerPage(input.perPage);
  assertUniquePositiveIds(input.include, "Media include");
  assertUniquePositiveIds(input.exclude, "Media exclude");
  assertUniquePositiveIds(input.categories, "Media categories");
  if (input.parent !== undefined) assertMediaParent(input.parent);
  if (input.mediaType !== undefined && !["image", "video", "audio", "application", "text"].includes(input.mediaType)) {
    throw new TypeError("Unsupported mediaType.");
  }
  for (const value of [input.search, input.mimeType]) {
    if (value !== undefined && typeof value !== "string") throw new TypeError("Media search and mimeType must be strings.");
  }
  return client.list<MediaUploadPayload>("media", {
    page: input.page ?? 1,
    per_page: input.perPage ?? 20,
    search: input.search,
    include: input.include?.join(","),
    exclude: input.exclude?.join(","),
    parent: input.parent,
    media_type: input.mediaType,
    mime_type: input.mimeType,
    ...(input.categories !== undefined ? { media_category: input.categories.join(",") } : {})
  });
}

/** 按附件 ID 读取媒体；仅显式 edit 时请求可编辑原始字段。 */
export async function getMedia(client: WordPressClient, input: MediaGetInput): Promise<MediaUploadPayload> {
  assertPositiveId(input.mediaId, "Media id");
  if (input.context !== undefined && input.context !== "view" && input.context !== "edit") {
    throw new TypeError("Media context must be view or edit.");
  }
  return client.get<MediaUploadPayload>("media", input.mediaId, { context: input.context ?? "view" });
}

/** 更新附件元数据，保留显式清空值，拒绝空更新及无法识别的字段。 */
export async function updateMedia(client: WordPressClient, input: MediaUpdateInput): Promise<MediaUploadPayload> {
  assertPositiveId(input.mediaId, "Media id");
  if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) {
    throw new TypeError("Media data must be an object.");
  }
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.data)) {
    if (!["title", "altText", "caption", "description", "slug", "post", "categories"].includes(key)) {
      throw new TypeError(`Unsupported media data field: ${key}.`);
    }
    if (value === undefined) continue;
    if (key === "categories") assertUniquePositiveIds(value as number[], "Media categories");
    else if (key === "post") assertMediaParent(value);
    else if (typeof value !== "string") throw new TypeError(`Media ${key} must be a string.`);
    body[key === "altText" ? "alt_text" : key === "categories" ? "media_category" : key] = value;
  }
  if (Object.keys(body).length === 0) throw new TypeError("Media update requires at least one data field.");
  return client.update<MediaUploadPayload>("media", input.mediaId, body);
}

/** 永久删除附件及关联文件，不把未显式确认的请求升级为强制删除。 */
export async function deleteMedia(client: WordPressClient, input: MediaDeleteInput): Promise<unknown> {
  assertPositiveId(input.mediaId, "Media id");
  if (input.force !== true) throw new TypeError("Media deletion requires force: true and permanently deletes the attachment and files.");
  return client.delete("media", input.mediaId, { force: true });
}

/** 媒体上传工具接收的 MCP 风格输入。 */
export interface MediaUploadInput {
  /** 创建附件时关联的文章 ID；0 表示不关联，省略保持默认行为。 */
  post?: number;
  /** 上传完成时设置的 Jelly Editor 媒体分类 ID 列表。 */
  categories?: number[];
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

/** 媒体替代文本更新工具接收的 MCP 风格输入。 */
export interface MediaAltUpdateInput {
  /** 要更新的正安全整数媒体附件 ID。 */
  mediaId: number;
  /** 要写入的媒体替代文本，允许空字符串用于清除现有内容。 */
  altText: string;
}

/** 媒体替代文本更新后返回的 WordPress 附件实体。 */
export interface MediaAltUpdatePayload extends MediaUploadPayload {
  /** 已更新的 WordPress 媒体附件 ID。 */
  id: number;
  /** WordPress 返回的最新媒体替代文本。 */
  alt_text?: string;
}

/** 从本地文件上传媒体，并把 MCP camelCase 元数据映射为 WordPress client 选项。 */
export async function uploadMedia(
  client: WordPressClient,
  input: MediaUploadInput
): Promise<MediaUploadPayload> {
  if (!input.filePath) {
    throw new Error("Media filePath is required.");
  }
  assertUniquePositiveIds(input.categories, "Media categories");
  const options = Object.fromEntries(Object.entries({
    post: input.post,
    title: input.title,
    altText: input.altText,
    caption: input.caption,
    description: input.description,
    categories: input.categories
  }).filter(([, value]) => value !== undefined && value !== "")) as UploadMediaOptions;
  if (input.post !== undefined) assertMediaParent(input.post);
  return client.uploadMediaFromFile<MediaUploadPayload>(input.filePath, options);
}

/** 按附件 ID 更新 WordPress 媒体替代文本，空字符串会清除现有内容。 */
export async function updateMediaAlt(
  client: WordPressClient,
  input: MediaAltUpdateInput
): Promise<MediaAltUpdatePayload> {
  assertPositiveId(input.mediaId, "Media id");
  if (typeof input.altText !== "string") {
    throw new Error("Media altText must be a string.");
  }
  return client.update<MediaAltUpdatePayload>("media", input.mediaId, {
    alt_text: input.altText
  });
}

