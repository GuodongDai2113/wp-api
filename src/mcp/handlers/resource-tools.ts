import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  assertExportTargetAbsent,
  encodeCsvField,
  forEachDynamicPage,
  parseCsvRows,
  publishFileExclusive,
  readBoundedCsvFile
} from "../../lib/csv.js";
import { resolveContentInput } from "../../lib/content-input.js";
import { convertHtmlToGutenberg } from "../../lib/html-to-gutenberg.js";
import { readBoundedJsonFile } from "../../lib/json-file.js";
import {
  getResourceTargetConfig,
  type PostResourceTarget,
  type ResourceTarget,
  type TaxonomyResourceTarget
} from "../../lib/resources.js";
import { type Pagination, type QueryParams, WordPressApiError, WordPressClient } from "../../lib/wp-client.js";

/** Post 类型资源 CSV 固定列名。 */
export const POST_RESOURCE_CSV_HEADERS = [
  "id",
  "title",
  "slug",
  "status",
  "excerpt",
  "content",
  "gutenberg",
  "featuredMedia",
  "categories",
  "meta"
] as const;

/** Taxonomy 类型资源 CSV 固定列名。 */
export const TAXONOMY_RESOURCE_CSV_HEADERS = [
  "id",
  "name",
  "slug",
  "description",
  "parent",
  "meta"
] as const;

/** 资源 CSV 中表示显式清空字符串的保留值。 */
const EMPTY_STRING_MARKER = "__EMPTY__";

/** 单个资源 CSV 导入文件允许占用的最大字节数。 */
const MAX_RESOURCE_CSV_BYTES = 25 * 1024 * 1024;

/** WordPress batch v1 默认支持的单批最大请求数。 */
const RESOURCE_BATCH_SIZE = 25;

/** 单次发送到 WordPress batch/v1 的 JSON 请求体最大字节数。 */
export const MAX_RESOURCE_BATCH_REQUEST_BYTES = 8 * 1024 * 1024;

/** 单次资源批量工具调用准备的全部子请求累计最大字节数。 */
export const MAX_RESOURCE_BATCH_TOTAL_BYTES = 25 * 1024 * 1024;

/** WordPress REST 资源实体中资源工具会读取的字段集合。 */
export interface WordPressResourceEntity {
  /** 实体 ID。 */
  id?: number;
  /** 内容资源标题对象。 */
  title?: { raw?: string; rendered?: string };
  /** 资源 slug。 */
  slug?: string;
  /** 内容资源状态。 */
  status?: string;
  /** 内容资源摘要对象。 */
  excerpt?: { raw?: string; rendered?: string };
  /** 内容资源正文对象。 */
  content?: { raw?: string; rendered?: string };
  /** 特色媒体附件 ID。 */
  featured_media?: number;
  /** 文章分类 ID。 */
  categories?: number[];
  /** Jelly Catalog 产品分类 ID。 */
  product_cat?: number[];
  /** 已通过 REST 暴露的 meta。 */
  meta?: Record<string, unknown>;
  /** taxonomy 名称。 */
  name?: string;
  /** taxonomy 描述。 */
  description?: string;
  /** taxonomy 父级 ID。 */
  parent?: number;
  /** 允许保留 WordPress 或插件返回的其他字段。 */
  [key: string]: unknown;
}

/** 资源集合查询共享字段。 */
export interface ResourceQueryInput {
  /** 要查询的判别资源目标。 */
  target: ResourceTarget;
  /** 可选全文搜索文本。 */
  search?: string;
  /** 可选资源状态。 */
  status?: string;
  /** 可选资源 ID 白名单。 */
  include?: number[];
}

/** 资源计数工具输入。 */
export interface ResourceCountInput extends ResourceQueryInput {
  /** 用于计算总页数的每页条目数，默认 100。 */
  perPage?: number;
}

/** 资源列表工具输入。 */
export interface ResourceListInput extends ResourceQueryInput {
  /** 当前内联结果页码。 */
  page?: number;
  /** 当前内联结果每页条目数。 */
  perPage?: number;
  /** 可选全量 CSV 输出路径。 */
  outputFile?: string;
}

/** 单个资源读取工具输入。 */
export interface ResourceGetInput {
  /** 要读取的判别资源目标。 */
  target: ResourceTarget;
  /** 要读取的正安全整数资源 ID。 */
  id: number;
}

/** Post 类型资源创建和更新共享的写入字段。 */
export interface PostResourceBodyInput {
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
  /** 分类 ID 数组；文章映射到 categories，产品映射到 product_cat，空数组表示清空。 */
  categories?: number[];
  /** 目标 REST 资源已经注册并允许写入的 meta 字段。 */
  meta?: Record<string, unknown>;
  /** 保存完整 WordPress REST meta 对象的本地 JSON 文件路径。 */
  metaFile?: string;
}

/** Taxonomy 类型资源创建和更新共享的写入字段。 */
export interface TaxonomyResourceBodyInput {
  /** taxonomy 资源名称。 */
  name?: string;
  /** 资源 slug。 */
  slug?: string;
  /** taxonomy 资源描述。 */
  description?: string;
  /** taxonomy 父级 ID，0 表示移除父级。 */
  parent?: number;
  /** 目标 REST taxonomy 已经注册并允许写入的 meta 字段。 */
  meta?: Record<string, unknown>;
  /** 保存完整 WordPress REST meta 对象的本地 JSON 文件路径。 */
  metaFile?: string;
}

/** 资源写入工具能够处理的两类数据联合。 */
export type ResourceBodyInput = PostResourceBodyInput | TaxonomyResourceBodyInput;

/** 单条资源创建工具输入。 */
export type ResourceCreateInput =
  | { target: PostResourceTarget; data: PostResourceBodyInput }
  | { target: TaxonomyResourceTarget; data: TaxonomyResourceBodyInput };

/** 单条资源更新工具输入。 */
export type ResourceUpdateInput =
  | { target: PostResourceTarget; id: number; data: PostResourceBodyInput }
  | { target: TaxonomyResourceTarget; id: number; data: TaxonomyResourceBodyInput };

/** 单条资源删除工具输入。 */
export interface ResourceDeleteInput extends ResourceGetInput {
  /** 是否执行永久删除；taxonomy 资源必须显式设为 true。 */
  force?: boolean;
}

/** 批量工具允许直接提供的 Post 字段，不支持逐项本地文件。 */
export type PostResourceBatchBodyInput = Omit<PostResourceBodyInput, "contentFile" | "metaFile">;

/** 批量工具允许直接提供的 taxonomy 字段，不支持逐项本地文件。 */
export type TaxonomyResourceBatchBodyInput = Omit<TaxonomyResourceBodyInput, "metaFile">;

/** 批量工具允许直接提供的两类资源数据。 */
export type ResourceBatchBodyInput = PostResourceBatchBodyInput | TaxonomyResourceBatchBodyInput;

/** 批量创建中的单条输入。 */
export interface ResourceBatchCreateItem<TData extends ResourceBatchBodyInput = ResourceBatchBodyInput> {
  /** 可选来源 ID，仅用于关联导出数据与新建结果，不发送给 WordPress。 */
  id?: number;
  /** 当前记录要写入的直接资源字段。 */
  data: TData;
}

/** 批量更新中的单条输入。 */
export interface ResourceBatchUpdateItem<TData extends ResourceBatchBodyInput = ResourceBatchBodyInput> {
  /** 要更新的资源 ID。 */
  id: number;
  /** 当前记录要写入的直接资源字段。 */
  data: TData;
}

/** 批量创建工具输入。 */
export type ResourceBatchCreateInput =
  | { target: PostResourceTarget; items?: ResourceBatchCreateItem<PostResourceBatchBodyInput>[]; csvFile?: string }
  | { target: TaxonomyResourceTarget; items?: ResourceBatchCreateItem<TaxonomyResourceBatchBodyInput>[]; csvFile?: string };

/** 批量更新工具输入。 */
export type ResourceBatchUpdateInput =
  | { target: PostResourceTarget; items?: ResourceBatchUpdateItem<PostResourceBatchBodyInput>[]; csvFile?: string }
  | { target: TaxonomyResourceTarget; items?: ResourceBatchUpdateItem<TaxonomyResourceBatchBodyInput>[]; csvFile?: string };

/** 资源计数工具返回结构。 */
export interface ResourceCountResult {
  /** 对应的判别资源目标。 */
  target: ResourceTarget;
  /** 匹配查询的资源总数。 */
  total: number;
  /** 按 perPage 计算的总页数。 */
  totalPages: number;
  /** 实际用于计算分页的每页条目数。 */
  perPage: number;
}

/** 资源 CSV 导出结果。 */
export interface ResourceExportResult {
  /** CSV 文件绝对路径。 */
  file_path: string;
  /** 实际导出的数据行数。 */
  rows: number;
  /** 实际成功读取并写入的分页数。 */
  totalPages: number;
}

/** 资源列表工具返回结构。 */
export interface ResourceListResult {
  /** 当前分页资源。 */
  items: WordPressResourceEntity[];
  /** WordPress 分页信息。 */
  pagination: Pagination;
  /** 提供 outputFile 时生成的全量 CSV 信息。 */
  export?: ResourceExportResult;
}

/** batch v1 单条子响应。 */
interface WordPressBatchSubresponse {
  /** 子请求 HTTP 状态码。 */
  status?: number;
  /** 子请求返回体。 */
  body?: unknown;
}

/** batch v1 顶层响应。 */
interface WordPressBatchResponse {
  /** 与请求顺序一致的子响应。 */
  responses?: WordPressBatchSubresponse[];
}

/** 发送给 WordPress batch/v1 的单个子请求。 */
interface WordPressBatchRequest {
  /** 子请求固定使用 POST。 */
  method: "POST";
  /** wp-json 根路径下的子请求路径。 */
  path: string;
  /** 已完成字段映射和校验的 REST 请求体。 */
  body: Record<string, unknown>;
}

/** 已校验大小的批量条目共用字段。 */
interface PreparedBatchEntry {
  /** 原始输入中的稳定顺序索引。 */
  index: number;
  /** 已准备好的 WordPress 子请求。 */
  request: WordPressBatchRequest;
  /** 子请求自身序列化后的 UTF-8 字节数。 */
  requestBytes: number;
}

/** 已准备好的批量创建条目。 */
interface PreparedBatchCreateEntry extends PreparedBatchEntry {
  /** 可选来源 ID，仅用于结果关联。 */
  sourceId?: number;
}

/** 已准备好的批量更新条目。 */
interface PreparedBatchUpdateEntry extends PreparedBatchEntry {
  /** 要更新的 WordPress 资源 ID。 */
  id: number;
}

/** 空 batch/v1 请求包装的序列化字节数，用于精确累计实际请求大小。 */
const EMPTY_BATCH_PAYLOAD_BYTES = Buffer.byteLength(JSON.stringify({ validation: "normal", requests: [] }), "utf8");

/** 资源批量操作的规范化错误。 */
export interface ResourceBatchError {
  /** WordPress 错误码。 */
  code: string;
  /** 可展示的错误消息。 */
  message: string;
  /** 子请求 HTTP 状态码。 */
  status: number;
}

/** 资源批量操作单项结果。 */
export interface ResourceBatchItemResult {
  /** 从零开始的输入顺序索引。 */
  index: number;
  /** 批量创建时可选的原始来源 ID。 */
  sourceId?: number;
  /** 创建后或更新目标的 WordPress ID。 */
  id?: number;
  /** 当前记录是否成功。 */
  success: boolean;
  /** 失败后的规范化错误。 */
  error?: ResourceBatchError;
}

/** 资源批量操作汇总结果。 */
export interface ResourceBatchResult {
  /** 本次操作使用的判别资源目标。 */
  target: ResourceTarget;
  /** 输入记录总数。 */
  total: number;
  /** 成功记录数。 */
  succeeded: number;
  /** 失败记录数。 */
  failed: number;
  /** 与输入顺序一致的逐项结果。 */
  items: ResourceBatchItemResult[];
}

/** 仅移除未提供字段，并保留空字符串、0 和空数组的清空语义。 */
function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/** 校验 ID 是可安全传给 WordPress REST API 的正整数。 */
function assertPositiveId(id: number, label: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

/** 校验分页大小符合 WordPress REST 的 1 到 100 边界。 */
function assertPerPage(perPage: number | undefined): void {
  if (perPage !== undefined && (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100)) {
    throw new Error("Items per page must be between 1 and 100.");
  }
}

/** 校验可清空 ID 是非负安全整数。 */
function assertOptionalNonNegativeId(id: number | undefined, label: string): void {
  if (id !== undefined && (!Number.isSafeInteger(id) || id < 0)) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

/** 校验 taxonomy ID 数组仅包含正安全整数，并允许空数组清空关联。 */
function assertTaxonomyIds(ids: number[] | undefined, label: string): void {
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))) {
    throw new Error(`${label} must contain only positive integers.`);
  }
}

/** 判断未知值是否为普通 JSON 对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验查询 ID 白名单。 */
function assertInclude(include: number[] | undefined): void {
  if (include === undefined) {
    return;
  }
  assertTaxonomyIds(include, "Include");
  if (new Set(include).size !== include.length) {
    throw new Error("Include must not contain duplicate IDs.");
  }
}

/** Handler 内部用于统一读取两类可选字段的宽松资源数据。 */
type AnyResourceBodyInput = Partial<PostResourceBodyInput & TaxonomyResourceBodyInput>;

/** 解析内联或文件形式的 WordPress REST meta。 */
async function resolveResourceMeta(input: AnyResourceBodyInput): Promise<Record<string, unknown> | undefined> {
  if (input.meta !== undefined && input.metaFile !== undefined) {
    throw new Error("Provide either meta or metaFile, not both.");
  }
  if (input.meta !== undefined) {
    if (!isRecord(input.meta)) {
      throw new Error("meta must be a JSON object.");
    }
    return input.meta;
  }
  if (input.metaFile === undefined) {
    return undefined;
  }
  const parsed = await readBoundedJsonFile(input.metaFile, { label: "Meta file" });
  if (!isRecord(parsed)) {
    throw new Error("Meta file must contain a JSON object.");
  }
  return parsed;
}

/** 返回输入中所有显式提供的字段名称。 */
function findProvidedFields(input: AnyResourceBodyInput, fields: readonly (keyof AnyResourceBodyInput)[]): string[] {
  return fields.filter((field) => input[field] !== undefined);
}

/** 校验资源写入字段与内容或 taxonomy 类型一致。 */
function assertResourceBodyFields(target: ResourceTarget, input: AnyResourceBodyInput): void {
  const config = getResourceTargetConfig(target);
  const unsupportedFields = config.type === "taxonomy"
    ? findProvidedFields(input, ["title", "status", "excerpt", "content", "contentFile", "gutenberg", "featuredMedia", "categories"])
    : findProvidedFields(input, ["name", "description", "parent"]);

  if (config.type === "post") {
    if (target.resource === "pages" && input.categories !== undefined) {
      unsupportedFields.push("categories");
    }
  }
  if (unsupportedFields.length > 0) {
    throw new Error(`Fields are not supported for ${target.resource}: ${unsupportedFields.join(", ")}.`);
  }
}

/** 把 MCP 资源写入字段转换为 WordPress REST 请求体。 */
async function buildResourceBody(target: ResourceTarget, input: ResourceBodyInput): Promise<Record<string, unknown>> {
  const bodyInput = input as AnyResourceBodyInput;
  assertResourceBodyFields(target, bodyInput);
  const config = getResourceTargetConfig(target);
  const meta = await resolveResourceMeta(bodyInput);
  if (config.type === "taxonomy") {
    assertOptionalNonNegativeId(bodyInput.parent, "Parent");
    return compactObject({ name: bodyInput.name, slug: bodyInput.slug, description: bodyInput.description, parent: bodyInput.parent, meta });
  }

  assertOptionalNonNegativeId(bodyInput.featuredMedia, "Featured media");
  assertTaxonomyIds(bodyInput.categories, "Categories");
  const resolvedContent = await resolveContentInput({ content: bodyInput.content, contentFile: bodyInput.contentFile });
  const content = resolvedContent === undefined
    ? undefined
    : bodyInput.gutenberg ? convertHtmlToGutenberg(resolvedContent) : resolvedContent;
  const categoryFields = target.resource === "products"
    ? { product_cat: bodyInput.categories }
    : { categories: bodyInput.categories };
  return compactObject({
    title: bodyInput.title,
    slug: bodyInput.slug,
    status: bodyInput.status,
    excerpt: bodyInput.excerpt,
    content,
    featured_media: bodyInput.featuredMedia,
    ...categoryFields,
    meta
  });
}

/** 构造资源集合查询，并可覆盖分页窗口和编辑上下文。 */
function buildResourceQuery(
  input: ResourceQueryInput,
  pagination?: { page: number; perPage: number },
  editContext = false
): QueryParams {
  return compactObject({
    search: input.search,
    status: input.status,
    include: input.include?.join(","),
    page: pagination?.page,
    per_page: pagination?.perPage,
    context: editContext ? "edit" : undefined
  }) as QueryParams;
}

/** 从 WordPress 可编辑字段中提取原始文本，并在必要时回退到渲染文本。 */
function extractEditableText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.raw === "string") return value.raw;
  return typeof value.rendered === "string" ? value.rendered : undefined;
}

/** 编码可选字符串；空字符串使用显式清空标记。 */
function encodeOptionalString(value: unknown): string {
  return typeof value === "string" ? (value === "" ? EMPTY_STRING_MARKER : value) : "";
}

/** 将 Post 资源实体编码为可直接回导的一行 CSV。 */
function encodePostResourceCsvRow(entity: WordPressResourceEntity, target: PostResourceTarget): string {
  const values: Array<string | number> = [
    typeof entity.id === "number" ? entity.id : "",
    encodeOptionalString(extractEditableText(entity.title)),
    encodeOptionalString(entity.slug),
    encodeOptionalString(entity.status),
    encodeOptionalString(extractEditableText(entity.excerpt)),
    encodeOptionalString(extractEditableText(entity.content)),
    "",
    typeof entity.featured_media === "number" ? entity.featured_media : "",
    Array.isArray(target.resource === "products" ? entity.product_cat : entity.categories)
      ? JSON.stringify(target.resource === "products" ? entity.product_cat : entity.categories)
      : "",
    isRecord(entity.meta) ? JSON.stringify(entity.meta) : ""
  ];
  return values.map(encodeCsvField).join(",");
}

/** 将 taxonomy 资源实体编码为可直接回导的一行 CSV。 */
function encodeTaxonomyResourceCsvRow(entity: WordPressResourceEntity): string {
  return [
    typeof entity.id === "number" ? entity.id : "",
    encodeOptionalString(entity.name),
    encodeOptionalString(entity.slug),
    encodeOptionalString(entity.description),
    typeof entity.parent === "number" ? entity.parent : "",
    isRecord(entity.meta) ? JSON.stringify(entity.meta) : ""
  ].map(encodeCsvField).join(",");
}

/** 将 CSV 字符串单元格转换为可选写入值。 */
function parseStringCell(value: string): string | undefined {
  if (value === "") return undefined;
  return value === EMPTY_STRING_MARKER ? "" : value;
}

/** 解析 CSV 中的可选非负整数。 */
function parseNonNegativeIntegerCell(value: string, rowNumber: number, field: string): number | undefined {
  if (value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`Resource CSV row ${rowNumber} contains an invalid ${field}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Resource CSV row ${rowNumber} contains an invalid ${field}.`);
  return parsed;
}

/** 解析 CSV 中的可选布尔值。 */
function parseBooleanCell(value: string, rowNumber: number): boolean | undefined {
  if (value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Resource CSV row ${rowNumber} gutenberg must be true or false.`);
}

/** 解析 CSV 中的可选 JSON 字段，并校验期望形状。 */
function parseJsonCell(value: string, rowNumber: number, field: string): unknown {
  if (value === "") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Resource CSV row ${rowNumber} ${field} must contain valid JSON.`);
  }
}

/** 将一行 Post CSV 转换为批量资源字段。 */
function parsePostResourceCsvRow(row: string[], rowNumber: number): ResourceBatchCreateItem<PostResourceBatchBodyInput> {
  if (row.length !== POST_RESOURCE_CSV_HEADERS.length) {
    throw new Error(`Post resource CSV row ${rowNumber} must contain exactly ${POST_RESOURCE_CSV_HEADERS.length} columns.`);
  }
  const categories = parseJsonCell(row[8], rowNumber, "categories");
  const meta = parseJsonCell(row[9], rowNumber, "meta");
  if (categories !== undefined && !Array.isArray(categories)) throw new Error(`Resource CSV row ${rowNumber} categories must be a JSON array.`);
  if (meta !== undefined && !isRecord(meta)) throw new Error(`Resource CSV row ${rowNumber} meta must be a JSON object.`);
  return {
    id: parseNonNegativeIntegerCell(row[0], rowNumber, "id"),
    data: compactObject({
      title: parseStringCell(row[1]),
      slug: parseStringCell(row[2]),
      status: parseStringCell(row[3]),
      excerpt: parseStringCell(row[4]),
      content: parseStringCell(row[5]),
      gutenberg: parseBooleanCell(row[6], rowNumber),
      featuredMedia: parseNonNegativeIntegerCell(row[7], rowNumber, "featuredMedia"),
      categories: categories as number[] | undefined,
      meta: meta as Record<string, unknown> | undefined
    }) as PostResourceBatchBodyInput
  };
}

/** 将一行 taxonomy CSV 转换为批量资源字段。 */
function parseTaxonomyResourceCsvRow(row: string[], rowNumber: number): ResourceBatchCreateItem<TaxonomyResourceBatchBodyInput> {
  if (row.length !== TAXONOMY_RESOURCE_CSV_HEADERS.length) {
    throw new Error(`Taxonomy resource CSV row ${rowNumber} must contain exactly ${TAXONOMY_RESOURCE_CSV_HEADERS.length} columns.`);
  }
  const meta = parseJsonCell(row[5], rowNumber, "meta");
  if (meta !== undefined && !isRecord(meta)) throw new Error(`Resource CSV row ${rowNumber} meta must be a JSON object.`);
  return {
    id: parseNonNegativeIntegerCell(row[0], rowNumber, "id"),
    data: compactObject({
      name: parseStringCell(row[1]),
      slug: parseStringCell(row[2]),
      description: parseStringCell(row[3]),
      parent: parseNonNegativeIntegerCell(row[4], rowNumber, "parent"),
      meta: meta as Record<string, unknown> | undefined
    }) as TaxonomyResourceBatchBodyInput
  };
}

/** 从有界 CSV 文件读取与目标 type 匹配的资源批量记录。 */
async function readResourceCsvItems(filePath: string, target: ResourceTarget): Promise<ResourceBatchCreateItem[]> {
  const csvText = await readBoundedCsvFile(filePath, { label: "Resource CSV", maxBytes: MAX_RESOURCE_CSV_BYTES });
  const rows = parseCsvRows(csvText, "Resource CSV");
  const headers = target.type === "post" ? POST_RESOURCE_CSV_HEADERS : TAXONOMY_RESOURCE_CSV_HEADERS;
  if (rows.length === 0 || rows[0].join("\u0000") !== headers.join("\u0000")) {
    throw new Error(`${target.type === "post" ? "Post" : "Taxonomy"} resource CSV header must be exactly: ${headers.join(",")}.`);
  }
  const dataRows = rows.slice(1).filter((row) => !(row.length === 1 && row[0] === ""));
  if (dataRows.length === 0) throw new Error("Resource CSV must contain at least one data row.");
  return target.type === "post"
    ? dataRows.map((row, index) => parsePostResourceCsvRow(row, index + 2))
    : dataRows.map((row, index) => parseTaxonomyResourceCsvRow(row, index + 2));
}

/** 将全部匹配资源逐页追加到临时 CSV，并在成功后替换为最终文件。 */
async function exportResourceCsv(client: WordPressClient, input: ResourceListInput): Promise<ResourceExportResult> {
  const outputFile = resolve(input.outputFile as string);
  await mkdir(dirname(outputFile), { recursive: true });
  await assertExportTargetAbsent(outputFile, "Resource CSV");
  const temporaryFile = resolve(dirname(outputFile), `.${basename(outputFile)}.${randomUUID()}.tmp`);
  const file = await open(temporaryFile, "wx");
  let rows = 0;
  let totalPages = 0;
  try {
    const headers = input.target.type === "post" ? POST_RESOURCE_CSV_HEADERS : TAXONOMY_RESOURCE_CSV_HEADERS;
    await file.writeFile(`\uFEFF${headers.join(",")}\r\n`, "utf8");
    const config = getResourceTargetConfig(input.target);
    const firstPage = await client.list<WordPressResourceEntity>(config.route, buildResourceQuery(input, { page: 1, perPage: 100 }, true));
    totalPages = await forEachDynamicPage({
      firstPage,
      loadPage: (page) => client.list<WordPressResourceEntity>(config.route, buildResourceQuery(input, { page, perPage: 100 }, true)),
      consumePage: async (items) => {
        const encodedRows = input.target.type === "post"
          ? items.map((entity) => encodePostResourceCsvRow(entity, input.target as PostResourceTarget))
          : items.map(encodeTaxonomyResourceCsvRow);
        await file.write(`${encodedRows.join("\r\n")}\r\n`, undefined, "utf8");
        rows += items.length;
      },
      isTerminalPageError: isInvalidPageNumberError
    });
    await file.close();
    await publishFileExclusive(temporaryFile, outputFile, "Resource CSV");
    return { file_path: outputFile, rows, totalPages };
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporaryFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** 判断 WordPress 错误是否表示分页期间集合缩减导致页码超出范围。 */
function isInvalidPageNumberError(error: unknown): boolean {
  return error instanceof WordPressApiError
    && error.status === 400
    && error.code.endsWith("invalid_page_number");
}

/** 从 WordPress batch 子响应中提取稳定错误信息。 */
function normalizeBatchError(response: WordPressBatchSubresponse): ResourceBatchError {
  const body = isRecord(response.body) ? response.body : {};
  return {
    code: typeof body.code === "string" ? body.code : "wordpress_batch_item_failed",
    message: typeof body.message === "string" ? body.message : "WordPress batch resource operation failed.",
    status: typeof response.status === "number" ? response.status : 500
  };
}

/** 判断 WordPress batch 子响应是否成功并包含可读取的实体。 */
function isSuccessfulBatchResponse(response: WordPressBatchSubresponse): boolean {
  return typeof response.status === "number" && response.status >= 200 && response.status < 300 && isRecord(response.body);
}

/** 在运行时拒绝批量条目携带未经过逐项路径边界校验的本地文件字段。 */
function assertBatchItemHasNoLocalFiles(item: ResourceBatchBodyInput, index: number): void {
  const runtimeItem = item as AnyResourceBodyInput;
  if (runtimeItem.contentFile !== undefined || runtimeItem.metaFile !== undefined) {
    throw new Error(`Resource batch item ${index + 1} does not support contentFile or metaFile.`);
  }
}

/** 计算单个 WordPress batch 子请求序列化后的 UTF-8 字节数。 */
function measureBatchRequestBytes(request: WordPressBatchRequest): number {
  return Buffer.byteLength(JSON.stringify(request), "utf8");
}

/** 校验单个子请求和整次批量调用的累计 JSON 大小，并返回新的累计值。 */
function accumulateBatchBytes(
  totalBytes: number,
  requestBytes: number,
  index: number,
  label: string
): number {
  const singlePayloadBytes = EMPTY_BATCH_PAYLOAD_BYTES + requestBytes;
  if (singlePayloadBytes > MAX_RESOURCE_BATCH_REQUEST_BYTES) {
    throw new Error(`${label} item ${index + 1} exceeds the maximum batch request size of ${MAX_RESOURCE_BATCH_REQUEST_BYTES} bytes.`);
  }
  const nextTotalBytes = totalBytes + requestBytes + (index === 0 ? 0 : 1);
  if (nextTotalBytes > MAX_RESOURCE_BATCH_TOTAL_BYTES) {
    throw new Error(`${label} exceeds the maximum total batch size of ${MAX_RESOURCE_BATCH_TOTAL_BYTES} bytes.`);
  }
  return nextTotalBytes;
}

/** 同时按最多 25 条和最大 JSON 字节数把已校验条目切分为请求块。 */
function chunkPreparedBatchEntries<TEntry extends PreparedBatchEntry>(entries: TEntry[], label: string): TEntry[][] {
  const chunks: TEntry[][] = [];
  let chunk: TEntry[] = [];
  let chunkBytes = EMPTY_BATCH_PAYLOAD_BYTES;

  for (const entry of entries) {
    const additionBytes = entry.requestBytes + (chunk.length === 0 ? 0 : 1);
    if (chunk.length >= RESOURCE_BATCH_SIZE || chunkBytes + additionBytes > MAX_RESOURCE_BATCH_REQUEST_BYTES) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = EMPTY_BATCH_PAYLOAD_BYTES;
    }
    chunkBytes += entry.requestBytes + (chunk.length === 0 ? 0 : 1);
    chunk.push(entry);
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  const totalPayloadBytes = chunks.reduce(
    (total, currentChunk) => total
      + EMPTY_BATCH_PAYLOAD_BYTES
      + currentChunk.reduce((chunkTotal, entry) => chunkTotal + entry.requestBytes, 0)
      + Math.max(0, currentChunk.length - 1),
    0
  );
  if (totalPayloadBytes > MAX_RESOURCE_BATCH_TOTAL_BYTES) {
    throw new Error(`${label} exceeds the maximum total batch size of ${MAX_RESOURCE_BATCH_TOTAL_BYTES} bytes.`);
  }
  return chunks;
}

/** 读取资源总数和按指定分页大小计算的总页数。 */
export async function countResource(client: WordPressClient, input: ResourceCountInput): Promise<ResourceCountResult> {
  const config = getResourceTargetConfig(input.target);
  if (input.target.type === "taxonomy" && input.status !== undefined) {
    throw new Error("Taxonomy resource queries do not support status.");
  }
  assertPerPage(input.perPage);
  assertInclude(input.include);
  const perPage = input.perPage ?? 100;
  const result = await client.list<WordPressResourceEntity>(config.route, {
    ...buildResourceQuery(input, { page: 1, perPage }),
    _fields: "id"
  });
  return { target: input.target, total: result.pagination.total, totalPages: result.pagination.totalPages, perPage };
}

/** 查询一页资源，并可独立导出全部匹配资源。 */
export async function listResource(client: WordPressClient, input: ResourceListInput): Promise<ResourceListResult> {
  const config = getResourceTargetConfig(input.target);
  if (input.target.type === "taxonomy" && input.status !== undefined) {
    throw new Error("Taxonomy resource queries do not support status.");
  }
  if (input.page !== undefined) assertPositiveId(input.page, "Page");
  assertPerPage(input.perPage);
  assertInclude(input.include);
  if (input.outputFile !== undefined && input.outputFile.trim().length === 0) throw new Error("Resource CSV outputFile must not be blank.");
  const result = await client.list<WordPressResourceEntity>(config.route, {
    ...buildResourceQuery(input),
    page: input.page,
    per_page: input.perPage
  });
  const response: ResourceListResult = { items: result.items, pagination: result.pagination };
  if (input.outputFile !== undefined) response.export = await exportResourceCsv(client, input);
  return response;
}

/** 按 ID 读取单个资源。 */
export async function getResource(client: WordPressClient, input: ResourceGetInput): Promise<WordPressResourceEntity> {
  assertPositiveId(input.id, "Resource id");
  return client.get<WordPressResourceEntity>(getResourceTargetConfig(input.target).route, input.id);
}

/** 创建单个资源。 */
export async function createResource(client: WordPressClient, input: ResourceCreateInput): Promise<WordPressResourceEntity> {
  const body = await buildResourceBody(input.target, input.data);
  if (Object.keys(body).length === 0) throw new Error("At least one applicable resource field is required to create a resource.");
  return client.create<WordPressResourceEntity>(getResourceTargetConfig(input.target).route, body);
}

/** 更新单个资源。 */
export async function updateResource(client: WordPressClient, input: ResourceUpdateInput): Promise<WordPressResourceEntity> {
  assertPositiveId(input.id, "Resource id");
  const body = await buildResourceBody(input.target, input.data);
  if (Object.keys(body).length === 0) throw new Error("No update fields were provided.");
  return client.update<WordPressResourceEntity>(getResourceTargetConfig(input.target).route, input.id, body);
}

/** 删除单个资源，并要求 taxonomy 永久删除得到显式确认。 */
export async function deleteResource(client: WordPressClient, input: ResourceDeleteInput): Promise<WordPressResourceEntity> {
  assertPositiveId(input.id, "Resource id");
  const config = getResourceTargetConfig(input.target);
  if (config.deleteMode === "force" && input.force !== true) {
    throw new Error("Taxonomy terms do not support trash; set force to true to confirm permanent deletion.");
  }
  return client.delete<WordPressResourceEntity>(config.route, input.id, { force: config.deleteMode === "force" ? true : input.force === true });
}

/** 解析并预校验全部批量创建输入及 WordPress 请求体。 */
async function prepareBatchCreateItems(input: ResourceBatchCreateInput): Promise<PreparedBatchCreateEntry[]> {
  if ((input.items === undefined) === (input.csvFile === undefined)) throw new Error("Provide exactly one of items or csvFile for wp_resource_batch_create.");
  const items = input.csvFile === undefined ? input.items as ResourceBatchCreateItem[] : await readResourceCsvItems(input.csvFile, input.target);
  if (!Array.isArray(items) || items.length === 0) throw new Error("wp_resource_batch_create requires at least one item.");
  const route = getResourceTargetConfig(input.target).route;
  const prepared: PreparedBatchCreateEntry[] = [];
  let totalBytes = EMPTY_BATCH_PAYLOAD_BYTES;
  for (const [index, item] of items.entries()) {
    assertBatchItemHasNoLocalFiles(item.data, index);
    if (item.id !== undefined) assertPositiveId(item.id, `Resource create item ${index + 1} source id`);
    const body = await buildResourceBody(input.target, item.data);
    if (Object.keys(body).length === 0) throw new Error(`Resource create item ${index + 1} requires at least one applicable field.`);
    const request: WordPressBatchRequest = { method: "POST", path: `/wp/v2/${route}`, body };
    const requestBytes = measureBatchRequestBytes(request);
    totalBytes = accumulateBatchBytes(totalBytes, requestBytes, index, "Resource batch create");
    prepared.push({ index, sourceId: item.id, request, requestBytes });
  }
  return prepared;
}

/** 解析并预校验全部批量更新输入及 WordPress 请求体。 */
async function prepareBatchUpdateItems(input: ResourceBatchUpdateInput): Promise<PreparedBatchUpdateEntry[]> {
  if ((input.items === undefined) === (input.csvFile === undefined)) throw new Error("Provide exactly one of items or csvFile for wp_resource_batch_update.");
  const rawItems = input.csvFile === undefined ? input.items as ResourceBatchUpdateItem[] : await readResourceCsvItems(input.csvFile, input.target) as ResourceBatchUpdateItem[];
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error("wp_resource_batch_update requires at least one item.");
  const route = getResourceTargetConfig(input.target).route;
  const seenIds = new Set<number>();
  const prepared: PreparedBatchUpdateEntry[] = [];
  let totalBytes = EMPTY_BATCH_PAYLOAD_BYTES;
  for (const [index, item] of rawItems.entries()) {
    assertBatchItemHasNoLocalFiles(item.data, index);
    assertPositiveId(item.id, `Resource update item ${index + 1} id`);
    if (seenIds.has(item.id)) throw new Error(`Duplicate resource update id: ${item.id}.`);
    seenIds.add(item.id);
    const body = await buildResourceBody(input.target, item.data);
    if (Object.keys(body).length === 0) throw new Error(`Resource update item ${index + 1} requires at least one update field.`);
    const request: WordPressBatchRequest = { method: "POST", path: `/wp/v2/${route}/${item.id}`, body };
    const requestBytes = measureBatchRequestBytes(request);
    totalBytes = accumulateBatchBytes(totalBytes, requestBytes, index, "Resource batch update");
    prepared.push({ index, id: item.id, request, requestBytes });
  }
  return prepared;
}

/** 通过 WordPress batch v1 分块创建多条资源。 */
export async function batchCreateResources(client: WordPressClient, input: ResourceBatchCreateInput): Promise<ResourceBatchResult> {
  const items = await prepareBatchCreateItems(input);
  const results: ResourceBatchItemResult[] = [];
  for (const chunk of chunkPreparedBatchEntries(items, "Resource batch create")) {
    const batch = await client.requestApiPath<WordPressBatchResponse>("batch/v1", {
      method: "POST",
      body: { validation: "normal", requests: chunk.map((item) => item.request) }
    });
    if (!Array.isArray(batch.data.responses) || batch.data.responses.length !== chunk.length) throw new Error("WordPress batch response count does not match the submitted resource creates.");
    batch.data.responses.forEach((response, index) => {
      const item = chunk[index];
      if (isSuccessfulBatchResponse(response) && typeof (response.body as Record<string, unknown>).id === "number") {
        const body = response.body as Record<string, unknown>;
        results.push({ index: item.index, sourceId: item.sourceId, id: body.id as number, success: true });
      } else {
        results.push({ index: item.index, sourceId: item.sourceId, success: false, error: normalizeBatchError(response) });
      }
    });
  }
  const succeeded = results.filter((item) => item.success).length;
  return { target: input.target, total: results.length, succeeded, failed: results.length - succeeded, items: results };
}

/** 通过 WordPress batch v1 分块更新多条资源。 */
export async function batchUpdateResources(client: WordPressClient, input: ResourceBatchUpdateInput): Promise<ResourceBatchResult> {
  const items = await prepareBatchUpdateItems(input);
  const results: ResourceBatchItemResult[] = [];
  for (const chunk of chunkPreparedBatchEntries(items, "Resource batch update")) {
    const batch = await client.requestApiPath<WordPressBatchResponse>("batch/v1", {
      method: "POST",
      body: { validation: "normal", requests: chunk.map((item) => item.request) }
    });
    if (!Array.isArray(batch.data.responses) || batch.data.responses.length !== chunk.length) throw new Error("WordPress batch response count does not match the submitted resource updates.");
    batch.data.responses.forEach((response, index) => {
      const item = chunk[index];
      if (isSuccessfulBatchResponse(response)) {
        const body = response.body as Record<string, unknown>;
        results.push({ index: item.index, id: typeof body.id === "number" ? body.id : item.id, success: true });
      } else {
        results.push({ index: item.index, id: item.id, success: false, error: normalizeBatchError(response) });
      }
    });
  }
  const succeeded = results.filter((item) => item.success).length;
  return { target: input.target, total: results.length, succeeded, failed: results.length - succeeded, items: results };
}
