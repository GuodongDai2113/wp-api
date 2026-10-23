import { WordPressApiError, type WordPressClient } from "../../wordpress/client.js";

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
  /** 错误码或消息超出有界摘要时显式标记。 */
  truncated?: boolean;
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
  const code = typeof body.code === "string" ? body.code : "wordpress_batch_item_failed";
  const message = typeof body.message === "string" ? body.message : fallbackMessage;
  return {
    code: code.slice(0, 128),
    message: message.slice(0, 512),
    ...(code.length > 128 || message.length > 512 ? { truncated: true } : {}),
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

/** 批处理条目已知的执行状态，未知与未执行不能计为失败或自动重试。 */
export type BatchExecutionState = "succeeded" | "failed" | "unknown" | "not_executed";

/** 保留原始条目关联的批处理结果，不携带顶层网络错误中的敏感请求数据。 */
export interface BatchExecutionOutcome<T> {
  /** 原始输入与请求，用于生成稳定索引和 ID 映射。 */
  entry: T;
  /** 当前条目执行状态。 */
  state: BatchExecutionState;
  /** 仅在收到结构完整的对应子响应时保留。 */
  response?: WordPressBatchSubresponse;
}

/**
 * 预检全部分块后顺序执行；传输失败或无法对应响应时保留先前结果，当前块标未知，后续不执行。
 * 单个有效失败响应不会阻止后续块。不得重试任何块，避免重复创建。
 */
export async function executeWordPressBatch<T extends { request: WordPressBatchRequest }>(
  client: WordPressClient,
  entries: readonly T[],
  label: string,
  confirmsSuccess: (body: Record<string, unknown>, entry: T) => boolean
): Promise<BatchExecutionOutcome<T>[]> {
  const chunks = chunkWordPressBatchEntries(entries, label);
  const outcomes: BatchExecutionOutcome<T>[] = [];
  let interrupted = false;
  for (const chunk of chunks) {
    if (interrupted) {
      outcomes.push(...chunk.map((entry) => ({ entry, state: "not_executed" as const })));
      continue;
    }
    let responses: WordPressBatchSubresponse[];
    try {
      const batch = await client.requestApiPath<WordPressBatchResponse>("batch/v1", {
        method: "POST", body: { validation: "normal", requests: chunk.map((entry) => entry.request) }
      });
      if (!Array.isArray(batch.data?.responses) || batch.data.responses.length !== chunk.length) throw new Error("Unmatched batch responses");
      responses = batch.data.responses;
    } catch {
      outcomes.push(...chunk.map((entry) => ({ entry, state: "unknown" as const })));
      interrupted = true;
      continue;
    }
    for (const [index, entry] of chunk.entries()) {
      const response = responses[index];
      if (isRecord(response) && isSuccessfulWordPressBatchResponse(response) && confirmsSuccess(response.body, entry)) {
        outcomes.push({ entry, state: "succeeded", response });
      } else if (isRecord(response) && typeof response.status === "number" && response.status >= 400 && response.status <= 599) {
        outcomes.push({ entry, state: "failed", response });
      } else {
        outcomes.push({ entry, state: "unknown" });
        interrupted = true;
      }
    }
  }
  return outcomes;
}

/** 判断错误是否表示动态分页期间集合缩减造成的页码越界。 */
export function isInvalidWordPressPageNumberError(error: unknown): boolean {
  return error instanceof WordPressApiError
    && error.status === 400
    && error.code.endsWith("invalid_page_number");
}
