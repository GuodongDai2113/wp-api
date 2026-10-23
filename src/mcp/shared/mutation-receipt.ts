/** 单条资源操作的最小回执；不根据输入推断字段已成功保存。 */
export interface MutationReceipt {
  /** 请求的操作类型。 */
  operation: "create" | "update" | "delete";
  /** 有有效返回 ID 时确认操作响应，否则要求调用方先核查远端。 */
  execution: "confirmed" | "unknown";
  /** 远端实体或删除回执中实际返回的 ID。 */
  id?: number;
  /** 结果未知时用于核查的请求 ID，不表示保存成功。 */
  requestedId?: number;
  /** 仅在远端提供有界状态字符串时保留。 */
  status?: string;
  /** 仅在删除响应明确提供时保留，不根据 force 参数推断。 */
  deleted?: boolean;
}

/** 校验完整回显开关，在任何写入前拒绝非法值。 */
export function wantsFullResult(detail: "summary" | "full" | undefined): boolean {
  if (detail !== undefined && detail !== "summary" && detail !== "full") throw new TypeError("detail must be summary or full.");
  return detail === "full";
}

/** 从 HTTP 成功响应生成有界回执，拒绝把提交字段或错误 ID 当作写入证据。 */
export function mutationReceipt(operation: MutationReceipt["operation"], value: unknown, requestedId?: number): MutationReceipt {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const previous = typeof data.previous === "object" && data.previous !== null ? data.previous as Record<string, unknown> : {};
  const returnedId = data.id ?? (operation === "delete" ? previous.id : undefined);
  const confirmed = typeof returnedId === "number" && Number.isSafeInteger(returnedId) && returnedId > 0
    && (requestedId === undefined || returnedId === requestedId) && data.deleted !== false;
  return { operation, execution: confirmed ? "confirmed" : "unknown",
    ...(confirmed ? { id: returnedId as number } : requestedId === undefined ? {} : { requestedId }),
    ...(confirmed && typeof data.status === "string" && data.status.length <= 128 ? { status: data.status } : {}),
    ...(operation === "delete" && typeof data.deleted === "boolean" ? { deleted: data.deleted } : {}) };
}
