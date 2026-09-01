/** 校验数值是可安全传给 WordPress REST API 的正整数。 */
export function assertPositiveId(id: unknown, label: string): asserts id is number {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

/** 校验可选分页大小符合 WordPress REST API 的 1 到 100 边界。 */
export function assertPerPage(perPage: number | undefined): void {
  if (perPage !== undefined && (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100)) {
    throw new Error("Items per page must be between 1 and 100.");
  }
}

/** 校验可选 ID 白名单只包含互不重复的正整数。 */
export function assertUniquePositiveIds(ids: number[] | undefined, label: string): void {
  if (ids === undefined) {
    return;
  }
  if (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error(`${label} must contain only positive integers.`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} must not contain duplicate IDs.`);
  }
}
