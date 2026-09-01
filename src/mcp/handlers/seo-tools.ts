import { mkdir, open, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  assertExportTargetAbsent,
  encodeCsvField,
  forEachDynamicPage,
  parseCsvRows,
  publishFileExclusive,
  readBoundedCsvFile
} from "../../lib/csv.js";
import { getResourceConfig, type ResourceName } from "../../lib/resources.js";
import { type Pagination, type QueryParams, WordPressApiError, WordPressClient } from "../../lib/wp-client.js";

/** SEO CSV 文件固定使用的列名。 */
const SEO_CSV_HEADERS = [
  "id",
  "rank_math_title",
  "rank_math_description",
  "rank_math_focus_keyword"
] as const;

/** 单个 SEO CSV 导入文件允许占用的最大字节数。 */
const MAX_SEO_CSV_BYTES = 10 * 1024 * 1024;

/** WordPress batch v1 默认支持的单批最大请求数。 */
const SEO_BATCH_SIZE = 25;

/** WordPress SEO 实体中当前工具需要读取的最小字段集合。 */
interface SeoResourceEntity {
  /** WordPress 资源 ID。 */
  id?: number;
  /** 已通过 REST 暴露的 WordPress meta。 */
  meta?: Record<string, unknown>;
}

/** Rank Math SEO 读取工具输入。 */
export interface ResourceSeoGetInput {
  /** 要读取的 WordPress 资源类型。 */
  resource: ResourceName;
  /** 要读取的资源 ID。 */
  id: number;
}

/** Rank Math SEO 单条更新字段。 */
export interface ResourceSeoUpdateItem {
  /** 要更新的资源 ID。 */
  id: number;
  /** Rank Math SEO 标题，空字符串表示清空。 */
  title?: string;
  /** Rank Math SEO 描述，空字符串表示清空。 */
  description?: string;
  /** Rank Math 焦点关键词，空字符串表示清空。 */
  focusKeyword?: string;
}

/** Rank Math SEO 单条更新工具输入。 */
export interface ResourceSeoUpdateInput extends ResourceSeoGetInput, Omit<ResourceSeoUpdateItem, "id"> {}

/** Rank Math SEO 列表工具输入。 */
export interface ResourceSeoListInput {
  /** 要查询的 WordPress 资源类型。 */
  resource: ResourceName;
  /** 可选全文搜索文本。 */
  search?: string;
  /** 可选资源状态。 */
  status?: string;
  /** 当前内联结果页码。 */
  page?: number;
  /** 当前内联结果每页条数。 */
  perPage?: number;
  /** 可选资源 ID 白名单。 */
  include?: number[];
  /** 可选全量 CSV 输出路径。 */
  outputFile?: string;
}

/** Rank Math SEO 批量更新工具输入。 */
export interface ResourceSeoBatchUpdateInput {
  /** 要更新的 WordPress 资源类型。 */
  resource: ResourceName;
  /** 内联更新记录，与 csvFile 二选一。 */
  items?: ResourceSeoUpdateItem[];
  /** CSV 导入文件，与 items 二选一。 */
  csvFile?: string;
}

/** Rank Math SEO 工具返回的稳定结构。 */
export interface ResourceSeoPayload {
  /** 实际返回或请求的资源 ID。 */
  id: number;
  /** 对应的资源类型。 */
  resource: ResourceName;
  /** Rank Math SEO 标题。 */
  rank_math_title: string;
  /** Rank Math SEO 描述。 */
  rank_math_description: string;
  /** Rank Math 焦点关键词。 */
  rank_math_focus_keyword: string;
}

/** SEO 全量 CSV 导出结果。 */
export interface ResourceSeoExportResult {
  /** CSV 文件绝对路径。 */
  file_path: string;
  /** 实际导出的数据行数。 */
  rows: number;
  /** 实际成功读取并写入的分页数。 */
  totalPages: number;
}

/** SEO 列表工具返回结果。 */
export interface ResourceSeoListResult {
  /** 当前分页内的 SEO 记录。 */
  items: ResourceSeoPayload[];
  /** 当前查询的 WordPress 分页信息。 */
  pagination: Pagination;
  /** 提供 outputFile 时生成的全量 CSV 信息。 */
  export?: ResourceSeoExportResult;
}

/** batch v1 单条子响应的最小结构。 */
interface WordPressBatchSubresponse {
  /** 子请求 HTTP 状态码。 */
  status?: number;
  /** 子请求返回体。 */
  body?: unknown;
}

/** batch v1 顶层响应结构。 */
interface WordPressBatchResponse {
  /** 与请求顺序一致的子响应。 */
  responses?: WordPressBatchSubresponse[];
}

/** SEO 批量更新中的规范化失败信息。 */
export interface ResourceSeoBatchError {
  /** WordPress 错误码。 */
  code: string;
  /** 可供调用方展示的错误消息。 */
  message: string;
  /** 子请求 HTTP 状态码。 */
  status: number;
}

/** SEO 批量更新单项结果。 */
export interface ResourceSeoBatchItemResult {
  /** 输入记录 ID。 */
  id: number;
  /** 当前记录是否更新成功。 */
  success: boolean;
  /** 更新成功后的稳定 SEO 字段。 */
  seo?: ResourceSeoPayload;
  /** 更新失败后的规范化错误。 */
  error?: ResourceSeoBatchError;
}

/** SEO 批量更新汇总结果。 */
export interface ResourceSeoBatchUpdateResult {
  /** 本次更新使用的资源类型。 */
  resource: ResourceName;
  /** 输入记录总数。 */
  total: number;
  /** 成功记录数。 */
  succeeded: number;
  /** 失败记录数。 */
  failed: number;
  /** 与输入顺序一致的逐项结果。 */
  items: ResourceSeoBatchItemResult[];
}

/** 校验 ID 是可安全传给 WordPress REST API 的正整数。 */
function assertPositiveId(id: number, label: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

/** 移除值为 undefined 的字段，同时保留空字符串清空语义。 */
function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/** 从 WordPress 实体中提取稳定的 Rank Math SEO 返回结构。 */
function extractResourceSeo(resource: ResourceName, entity: SeoResourceEntity, requestedId: number): ResourceSeoPayload {
  const meta = entity.meta ?? {};
  return {
    id: typeof entity.id === "number" ? entity.id : requestedId,
    resource,
    rank_math_title: String(meta.rank_math_title ?? ""),
    rank_math_description: String(meta.rank_math_description ?? ""),
    rank_math_focus_keyword: String(meta.rank_math_focus_keyword ?? "")
  };
}

/** 把 MCP SEO 更新字段映射为 WordPress REST meta 请求体。 */
function buildSeoMeta(item: ResourceSeoUpdateItem): Record<string, string> {
  if (item.title === undefined && item.description === undefined && item.focusKeyword === undefined) {
    throw new Error(`SEO update for id ${item.id} requires at least one SEO field.`);
  }
  return compactObject({
    rank_math_title: item.title,
    rank_math_description: item.description,
    rank_math_focus_keyword: item.focusKeyword
  }) as Record<string, string>;
}

/** 校验列表分页、include ID 和输出路径等业务输入。 */
function validateSeoListInput(input: ResourceSeoListInput): void {
  if (input.page !== undefined) {
    assertPositiveId(input.page, "Page");
  }
  if (input.perPage !== undefined && (!Number.isSafeInteger(input.perPage) || input.perPage < 1 || input.perPage > 100)) {
    throw new Error("Items per page must be between 1 and 100.");
  }
  if (input.include !== undefined) {
    if (!Array.isArray(input.include) || input.include.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error("Include must contain only positive integers.");
    }
    if (new Set(input.include).size !== input.include.length) {
      throw new Error("Include must not contain duplicate IDs.");
    }
  }
  if (input.outputFile !== undefined && input.outputFile.trim().length === 0) {
    throw new Error("SEO CSV outputFile must not be blank.");
  }
}

/** 构造 SEO 资源集合查询，并可覆盖分页窗口。 */
function buildSeoListQuery(
  input: ResourceSeoListInput,
  pagination?: { page: number; perPage: number }
): QueryParams {
  return compactObject({
    search: input.search,
    status: input.status,
    page: pagination?.page ?? input.page,
    per_page: pagination?.perPage ?? input.perPage,
    include: input.include?.join(","),
    _fields: "id,meta"
  }) as QueryParams;
}

/** 将稳定 SEO 数据编码为一行 CSV。 */
function encodeSeoCsvRow(item: ResourceSeoPayload): string {
  return [
    item.id,
    item.rank_math_title,
    item.rank_math_description,
    item.rank_math_focus_keyword
  ].map(encodeCsvField).join(",");
}

/** 从有界 CSV 文件读取并校验批量 SEO 更新记录。 */
async function readSeoCsvItems(filePath: string): Promise<ResourceSeoUpdateItem[]> {
  const csvText = await readBoundedCsvFile(filePath, { label: "SEO CSV", maxBytes: MAX_SEO_CSV_BYTES });
  const rows = parseCsvRows(csvText, "SEO CSV");
  if (rows.length === 0 || rows[0].join("\u0000") !== SEO_CSV_HEADERS.join("\u0000")) {
    throw new Error(`SEO CSV header must be exactly: ${SEO_CSV_HEADERS.join(",")}.`);
  }
  const dataRows = rows.slice(1).filter((row) => !(row.length === 1 && row[0] === ""));
  if (dataRows.length === 0) {
    throw new Error("SEO CSV must contain at least one data row.");
  }
  return dataRows.map((row, index) => {
    if (row.length !== SEO_CSV_HEADERS.length) {
      throw new Error(`SEO CSV row ${index + 2} must contain exactly ${SEO_CSV_HEADERS.length} columns.`);
    }
    if (!/^\d+$/.test(row[0])) {
      throw new Error(`SEO CSV row ${index + 2} contains an invalid id.`);
    }
    const id = Number(row[0]);
    assertPositiveId(id, `SEO CSV row ${index + 2} id`);
    return { id, title: row[1], description: row[2], focusKeyword: row[3] };
  });
}

/** 校验批量更新来源、记录字段和重复 ID。 */
async function resolveBatchItems(input: ResourceSeoBatchUpdateInput): Promise<ResourceSeoUpdateItem[]> {
  if ((input.items === undefined) === (input.csvFile === undefined)) {
    throw new Error("Provide exactly one of items or csvFile for wp_seo_batch_update.");
  }
  const items = input.csvFile === undefined ? input.items as ResourceSeoUpdateItem[] : await readSeoCsvItems(input.csvFile);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("wp_seo_batch_update requires at least one item.");
  }
  const seenIds = new Set<number>();
  for (const item of items) {
    assertPositiveId(item.id, "SEO item id");
    buildSeoMeta(item);
    if (seenIds.has(item.id)) {
      throw new Error(`Duplicate SEO item id: ${item.id}.`);
    }
    seenIds.add(item.id);
  }
  return items;
}

/** 从 WordPress 子响应中提取错误码、消息和状态。 */
function normalizeBatchError(response: WordPressBatchSubresponse): ResourceSeoBatchError {
  const body = typeof response.body === "object" && response.body !== null
    ? response.body as Record<string, unknown>
    : {};
  return {
    code: typeof body.code === "string" ? body.code : "wordpress_batch_item_failed",
    message: typeof body.message === "string" ? body.message : "WordPress batch item update failed.",
    status: typeof response.status === "number" ? response.status : 500
  };
}

/** 将全部匹配 SEO 记录逐页写入临时 CSV，并在成功后替换为最终文件。 */
async function exportSeoCsv(
  client: WordPressClient,
  input: ResourceSeoListInput
): Promise<ResourceSeoExportResult> {
  const outputFile = resolve(input.outputFile as string);
  await mkdir(dirname(outputFile), { recursive: true });
  await assertExportTargetAbsent(outputFile, "SEO CSV");
  const temporaryFile = resolve(dirname(outputFile), `.${basename(outputFile)}.${randomUUID()}.tmp`);
  const file = await open(temporaryFile, "wx");
  let rows = 0;
  let totalPages = 0;
  try {
    await file.writeFile(`\uFEFF${SEO_CSV_HEADERS.join(",")}\r\n`, "utf8");
    const config = getResourceConfig(input.resource);
    const firstPage = await client.list<SeoResourceEntity>(config.route, buildSeoListQuery(input, { page: 1, perPage: 100 }));
    totalPages = await forEachDynamicPage({
      firstPage,
      loadPage: (page) => client.list<SeoResourceEntity>(config.route, buildSeoListQuery(input, { page, perPage: 100 })),
      consumePage: async (items) => {
        const payloads = items.map((entity) => extractResourceSeo(input.resource, entity, entity.id ?? 0));
        await file.write(`${payloads.map(encodeSeoCsvRow).join("\r\n")}\r\n`, undefined, "utf8");
        rows += payloads.length;
      },
      isTerminalPageError: isInvalidPageNumberError
    });
    await file.close();
    await publishFileExclusive(temporaryFile, outputFile, "SEO CSV");
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

/** 读取指定资源的 Rank Math SEO 字段。 */
export async function getResourceSeo(client: WordPressClient, input: ResourceSeoGetInput): Promise<ResourceSeoPayload> {
  assertPositiveId(input.id, "Resource id");
  const config = getResourceConfig(input.resource);
  const entity = await client.get<SeoResourceEntity>(config.route, input.id);
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
  const entity = await client.update<SeoResourceEntity>(config.route, input.id, { meta: buildSeoMeta(input) });
  return extractResourceSeo(input.resource, entity, input.id);
}

/** 查询当前分页 SEO 数据，并可额外全量导出全部匹配记录。 */
export async function listResourceSeo(
  client: WordPressClient,
  input: ResourceSeoListInput
): Promise<ResourceSeoListResult> {
  validateSeoListInput(input);
  const config = getResourceConfig(input.resource);
  const result = await client.list<SeoResourceEntity>(config.route, buildSeoListQuery(input));
  const response: ResourceSeoListResult = {
    items: result.items.map((entity) => extractResourceSeo(input.resource, entity, entity.id ?? 0)),
    pagination: result.pagination
  };
  if (input.outputFile !== undefined) {
    response.export = await exportSeoCsv(client, input);
  }
  return response;
}

/** 通过 WordPress batch v1 分块更新多条 Rank Math SEO 数据。 */
export async function batchUpdateResourceSeo(
  client: WordPressClient,
  input: ResourceSeoBatchUpdateInput
): Promise<ResourceSeoBatchUpdateResult> {
  const items = await resolveBatchItems(input);
  const config = getResourceConfig(input.resource);
  const results: ResourceSeoBatchItemResult[] = [];

  for (let offset = 0; offset < items.length; offset += SEO_BATCH_SIZE) {
    const chunk = items.slice(offset, offset + SEO_BATCH_SIZE);
    const batch = await client.requestApiPath<WordPressBatchResponse>("batch/v1", {
      method: "POST",
      body: {
        validation: "normal",
        requests: chunk.map((item) => ({
          method: "POST",
          path: `/wp/v2/${config.route}/${item.id}`,
          body: { meta: buildSeoMeta(item) }
        }))
      }
    });
    if (!Array.isArray(batch.data.responses) || batch.data.responses.length !== chunk.length) {
      throw new Error("WordPress batch response count does not match the submitted SEO updates.");
    }
    for (let index = 0; index < chunk.length; index += 1) {
      const item = chunk[index];
      const response = batch.data.responses[index];
      if (typeof response.status === "number" && response.status >= 200 && response.status < 300
        && typeof response.body === "object" && response.body !== null) {
        results.push({
          id: item.id,
          success: true,
          seo: extractResourceSeo(input.resource, response.body as SeoResourceEntity, item.id)
        });
      } else {
        results.push({ id: item.id, success: false, error: normalizeBatchError(response) });
      }
    }
  }

  const succeeded = results.filter((item) => item.success).length;
  return {
    resource: input.resource,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    items: results
  };
}
