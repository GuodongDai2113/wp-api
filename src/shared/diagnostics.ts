import { AsyncLocalStorage } from "node:async_hooks";
import { writeSync } from "node:fs";

/** 单次工具调用的数值诊断；不保存参数、URL、凭据、正文或错误消息。 */
export interface ToolDiagnostic {
  /** 固定事件类型，便于从 stderr 中筛选。 */
  event: "wp-api-cost";
  /** 已注册的工具名称。 */
  tool: string;
  /** 回调是否正常完成；批量条目失败仍由工具结果表达。 */
  completed: boolean;
  /** 回调总耗时，单位毫秒。 */
  elapsedMs: number;
  /** 实际发起的 HTTP 请求次数，包含网络失败。 */
  requests: number;
  /** HTTP 请求等待与响应流读取耗时之和，并发时可能大于总耗时。 */
  upstreamMs: number;
  /** 实际读取的解压后响应体字节数，不含 HTTP 头。 */
  responseBytes: number;
  /** 工具回调结果完整 JSON 大小，不含 SDK 添加的 JSON-RPC 信封。失败时为 null。 */
  resultBytes: number | null;
  /** 文本块内容的 UTF-8 字节数，不含 JSON 转义和包装。 */
  textBytes: number;
  /** structuredContent 序列化后的字节数。 */
  structuredBytes: number;
  /** 成功写入的通用大型结果文件数量，不包括用户导出文件。 */
  storedResults: number;
}

/** 使用异步上下文隔离同时执行的工具调用，避免跨站点计数混合。 */
const activeDiagnostic = new AsyncLocalStorage<ToolDiagnostic>();

/** 累加当前调用的数值指标；未启用诊断时立即返回。 */
export function recordDiagnostic(
  field: "requests" | "upstreamMs" | "responseBytes" | "storedResults",
  amount: number
): void {
  const record = activeDiagnostic.getStore();
  if (record) record[field] += amount;
}

/** 将脱敏后的统计写入 stderr，保持 STDIO 的 stdout 协议通道纯净。 */
function writeDiagnostic(record: ToolDiagnostic): void {
  writeSync(2, `${JSON.stringify(record)}\n`);
}

/**
 * 在显式启用时测量回调；日志接收器失败不能改变已执行操作的成功或错误语义。
 * 未设置 WP_API_DIAGNOSTICS=1 时不序列化结果，也不创建异步诊断上下文。
 */
export async function measureToolCall<T>(
  tool: string,
  callback: () => Promise<T>,
  sink: ((record: ToolDiagnostic) => void) | undefined = process.env.WP_API_DIAGNOSTICS === "1" ? writeDiagnostic : undefined
): Promise<T> {
  if (!sink || activeDiagnostic.getStore()) return callback();
  const record: ToolDiagnostic = {
    event: "wp-api-cost", tool, completed: false, elapsedMs: 0,
    requests: 0, upstreamMs: 0, responseBytes: 0, resultBytes: null,
    textBytes: 0, structuredBytes: 0, storedResults: 0
  };
  const started = performance.now();
  return activeDiagnostic.run(record, async () => {
    try {
      const result = await callback();
      record.completed = true;
      try {
        record.resultBytes = Buffer.byteLength(JSON.stringify(result));
        const payload = result as { content?: { type: string; text?: string }[]; structuredContent?: unknown };
        record.textBytes = payload.content?.reduce((sum, block) => sum + (block.type === "text" ? Buffer.byteLength(block.text ?? "") : 0), 0) ?? 0;
        record.structuredBytes = payload.structuredContent === undefined ? 0 : Buffer.byteLength(JSON.stringify(payload.structuredContent));
      } catch {
        // 测量失败不得掩盖已经成功的领域操作。
      }
      return result;
    } finally {
      record.elapsedMs = performance.now() - started;
      try { sink(record); } catch {
        // 外部诊断接收器失败不得触发写入重试或覆盖原始异常。
      }
    }
  });
}
