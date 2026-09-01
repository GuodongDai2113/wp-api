import { WordPressApiError } from "../../wordpress/client.js";

/** WordPress batch/v1 默认支持的单批最大子请求数。 */
const WORDPRESS_BATCH_SIZE = 25;

/** 单次发送到 WordPress batch/v1 的 JSON 请求体最大字节数。 */
export const MAX_WORDPRESS_BATCH_REQUEST_BYTES = 8 * 1024 * 1024;

/** 单次 MCP 批量工具调用准备的全部 WordPress batch 请求累计最大字节数。 */
export const MAX_WORDPRESS_BATCH_TOTAL_BYTES = 25 * 1024 * 1024;

/** 空 WordPress batch/v1 请求包装的序列化字节数。 */
const EMPTY_WORDPRESS_BATCH_PAYLOAD_BYTES = Buffer.byteLength(
  JSON.stringify({ validation: "normal", requests: [] }),
  "utf8"
);

/** 发送给 WordPress batch/v1 的单个写入子请求。 */
export interface WordPressBatchRequest {
  /** 子请求使用的 HTTP 方法。 */
  method: "POST";
  /** wp-json 根路径下的子请求路径。 */
  path: string;
  /** 已完成字段映射和校验的 REST 请求体。 */
  body: Record<string, unknown>;
}

/** WordPress batch/v1 返回的单条子响应。 */
export interface WordPressBatchSubresponse {
  /** 子请求 HTTP 状态码。 */
  status?: number;
  /** 子请求返回体。 */
  body?: unknown;
}

/** WordPress batch/v1 顶层响应。 */
export interface WordPressBatchResponse {
  /** 与提交顺序一致的子响应。 */
  responses?: WordPressBatchSubresponse[];
}

/** WordPress batch 子请求的规范化错误。 */
export interface WordPressBatchError {
  /** WordPress 错误码。 */
  code: string;
  /** 可供调用方展示的错误消息。 */
  message: string;
  /** 子请求 HTTP 状态码。 */
  status: number;
}

/** 同时按条目数和序列化字节数校验并切分 WordPress batch 子请求。 */
export function chunkWordPressBatchEntries<TEntry extends { request: WordPressBatchRequest }>(
  entries: readonly TEntry[],
  label: string
): TEntry[][] {
  const chunks: TEntry[][] = [];
  let chunk: TEntry[] = [];
  let chunkBytes = EMPTY_WORDPRESS_BATCH_PAYLOAD_BYTES;
  let totalPayloadBytes = 0;

  for (const [index, entry] of entries.entries()) {
    const requestBytes = Buffer.byteLength(JSON.stringify(entry.request), "utf8");
    if (EMPTY_WORDPRESS_BATCH_PAYLOAD_BYTES + requestBytes > MAX_WORDPRESS_BATCH_REQUEST_BYTES) {
      throw new Error(`${label} item ${index + 1} exceeds the maximum batch request size of ${MAX_WORDPRESS_BATCH_REQUEST_BYTES} bytes.`);
    }

    const additionBytes = requestBytes + (chunk.length === 0 ? 0 : 1);
    if (chunk.length >= WORDPRESS_BATCH_SIZE || chunkBytes + additionBytes > MAX_WORDPRESS_BATCH_REQUEST_BYTES) {
      chunks.push(chunk);
      totalPayloadBytes += chunkBytes;
      chunk = [];
      chunkBytes = EMPTY_WORDPRESS_BATCH_PAYLOAD_BYTES;
    }
    chunkBytes += requestBytes + (chunk.length === 0 ? 0 : 1);
    chunk.push(entry);
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
    totalPayloadBytes += chunkBytes;
  }
  if (totalPayloadBytes > MAX_WORDPRESS_BATCH_TOTAL_BYTES) {
    throw new Error(`${label} exceeds the maximum total batch size of ${MAX_WORDPRESS_BATCH_TOTAL_BYTES} bytes.`);
  }
  return chunks;
}

/** 判断未知值是否为可安全读取字段的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从 WordPress batch 子响应中提取稳定的错误码、消息和状态。 */
export function normalizeWordPressBatchError(
  response: WordPressBatchSubresponse,
  fallbackMessage: string
): WordPressBatchError {
  const body = isRecord(response.body) ? response.body : {};
  return {
    code: typeof body.code === "string" ? body.code : "wordpress_batch_item_failed",
    message: typeof body.message === "string" ? body.message : fallbackMessage,
    status: typeof response.status === "number" ? response.status : 500
  };
}

/** 判断 WordPress batch 子响应是否成功且包含对象形式的实体。 */
export function isSuccessfulWordPressBatchResponse(
  response: WordPressBatchSubresponse
): response is WordPressBatchSubresponse & { status: number; body: Record<string, unknown> } {
  return typeof response.status === "number"
    && response.status >= 200
    && response.status < 300
    && isRecord(response.body);
}

/** 判断错误是否表示动态分页期间集合缩减造成的页码越界。 */
export function isInvalidWordPressPageNumberError(error: unknown): boolean {
  return error instanceof WordPressApiError
    && error.status === 400
    && error.code.endsWith("invalid_page_number");
}
