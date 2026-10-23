import { getResultStore } from "./result-store.js";
import { recordDiagnostic } from "../shared/diagnostics.js";
import { mutationReceipt } from "./shared/mutation-receipt.js";
import type { WpApiToolContext, WpApiToolName } from "./tool-router.js";
/** MCP 工具结果允许直接进入会话的最大紧凑 JSON 字节数。 */
const MAX_INLINE_RESULT_BYTES = 8 * 1024;

/**
 * 将任意结构化数据包装为 MCP 工具响应。
 * 超过 8 KiB 的完整结果只写入本地文件，避免 structuredContent 再次占用会话上下文。
 */
async function formatToolResult(
  toolName: WpApiToolName,
  data: unknown,
  context: WpApiToolContext,
  structuredOnly = false,
  requestedId?: number
) {
  const serializedJson = JSON.stringify(data);
  if (serializedJson === undefined) {
    throw new Error(`MCP tool ${toolName} returned a value that cannot be serialized as JSON.`);
  }
  const serializedBytes = Buffer.byteLength(serializedJson, "utf8");
  if (serializedBytes > MAX_INLINE_RESULT_BYTES) {
    const storedResult = await getResultStore(context).put(serializedJson);
    recordDiagnostic("storedResults", 1);
    return {
      structuredContent: {
        result: { ...storedResult, scope: "requested_result", summary: summarizeDelivery(toolName, data, requestedId) }
      },
      content: [
        {
          type: "text" as const,
          text: `Result is ${serializedBytes} bytes and was stored locally at ${storedResult.file_path}. Use wp_result_read with resultId=${storedResult.resultId}; expiresAt=${storedResult.expiresAt}.\nSummary: ${JSON.stringify(summarizeDelivery(toolName, data, requestedId))}\n`
        }
      ]
    };
  }

  if (structuredOnly) {
    return {
      structuredContent: {
        result: data
      },
      content: [
        {
          type: "text" as const,
          text: "Compact result is available in structuredContent.result.\n"
        }
      ]
    };
  }
  const formattedJson = `${toolName === "wp_result_read" ? serializedJson : JSON.stringify(data, null, 2)}\n`;
  return {
    structuredContent: {
      result: data
    },
    content: [
      {
        type: "text" as const,
        text: formattedJson
      }
    ]
  };
}

/** 为存储引用或交付失败保留有界定位信息，不从输入回显凭据或业务正文。 */
function summarizeDelivery(toolName: WpApiToolName, value: unknown, requestedId?: number): Record<string, unknown> {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  if (["wp_resource_create", "wp_resource_update", "wp_resource_delete"].includes(toolName)) {
    return { ...mutationReceipt(toolName.replace(/^wp_(resource|product)_/, "") as "create" | "update" | "delete", data, requestedId) };
  }
  const summary: Record<string, unknown> = {};
  for (const key of ["id", "total", "succeeded", "failed", "unknown", "notExecuted", "page", "perPage", "nextPage"]) {
    if (data[key] === null || typeof data[key] === "number") summary[key] = data[key];
  }
  if (typeof data.unknown === "number" && data.unknown > 0) summary.recovery = "Verify unknown entries on the site before retrying; do not repeat the complete batch. not_executed entries were not sent.";
  if (typeof data.pagination === "object" && data.pagination !== null) {
    const pagination = data.pagination as Record<string, unknown>;
    summary.pagination = Object.fromEntries(["total", "totalPages"].filter((key) => typeof pagination[key] === "number").map((key) => [key, pagination[key]]));
  }
  if (Array.isArray(data.items)) {
    summary.returnedItems = data.items.length;
    summary.itemsTruncated = data.items.length > 20;
    summary.items = data.items.slice(0, 20).map((item: Record<string, unknown>) => {
      if (!item || typeof item !== "object") return {};
      return Object.fromEntries(["index", "sourceId", "id", "success", "state"].filter((key) => typeof item[key] === "number" || typeof item[key] === "boolean" || item[key] === null || (key === "state" && ["unknown", "not_executed"].includes(String(item[key])))).map((key) => [key, item[key]]));
    });
  }
  return summary;
}

/** 批量部分失败和未知回执继续使用 MCP isError，不将业务错误包装为普通成功。 */
function hasExecutionError(toolName: WpApiToolName, value: unknown, requestedId?: number): boolean {
  if (["wp_resource_create", "wp_resource_update", "wp_resource_delete"].includes(toolName)) {
    return mutationReceipt(toolName.replace(/^wp_(resource|product)_/, "") as "create" | "update" | "delete", value, requestedId).execution === "unknown";
  }
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return ["wp_resource_batch_create", "wp_resource_batch_update", "wp_seo_batch_update"].includes(toolName)
    && ["failed", "unknown", "notExecuted"].some((key) => typeof data[key] === "number" && (data[key] as number) > 0);
}

/**
 * 领域操作完成后独立交付结果。序列化或落盘失败不抹掉已知回执，也不把失败误报为远端未执行。
 * isError 表示需要处理交付问题；明确要求先核查远端，禁止盲目重跑写入。
 */
export async function toToolResult(toolName: WpApiToolName, data: unknown, context: WpApiToolContext, structuredOnly = false, requestedId?: number) {
  try {
    const result = await formatToolResult(toolName, data, context, structuredOnly, requestedId);
    return hasExecutionError(toolName, data, requestedId) ? { ...result, isError: true } : result;
  } catch {
    const receipt = { domainCompleted: true, deliveryError: { code: "result_delivery_failed",
      message: "Operation returned, but result delivery failed. Do not repeat writes; inspect the receipt and verify remote state first." },
      summary: summarizeDelivery(toolName, data, requestedId) };
    return { isError: true, structuredContent: { result: receipt }, content: [{ type: "text" as const, text: JSON.stringify(receipt) }] };
  }
}

