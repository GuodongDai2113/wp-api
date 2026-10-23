/** 资源读取的字段集合与未指定字段时使用的预设。 */
export interface ResourceProjectionInput {
  /** summary 返回定位字段；full 保留完整实体。显式 fields 优先于预设。 */
  detail?: "summary" | "full";
  /** 精确字段路径，支持 content.raw、meta.key 等点分隔对象路径；不支持数组索引。 */
  fields?: string[];
}

/** 校验读取选项并解析实际字段集合；undefined 表示完整返回。 */
export function resolveProjection(input: ResourceProjectionInput, defaults: readonly string[], defaultDetail: "summary" | "full"): string[] | undefined {
  if (input.detail !== undefined && input.detail !== "summary" && input.detail !== "full") throw new TypeError("detail must be summary or full.");
  if (input.fields !== undefined) {
    if (!Array.isArray(input.fields) || input.fields.length === 0 || input.fields.length > 50
      || input.fields.some((field) => typeof field !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_-]*(\.[a-zA-Z_][a-zA-Z0-9_-]*)*$/.test(field)
        || field.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part)))) {
      throw new TypeError("fields must contain 1 to 50 safe dot-separated object field paths.");
    }
    return [...new Set(input.fields)];
  }
  return (input.detail ?? defaultDetail) === "full" ? undefined : [...defaults];
}

/**
 * 按字段路径进行本地兜底投影，不依赖上游支持 _fields。
 * 保留缺失与 null 的区别、raw/rendered 原值；禁止原型链读取，不展开数组子字段。
 */
export function projectResource<T extends Record<string, unknown>>(entity: T, fields: readonly string[] | undefined): T {
  if (!fields) return entity;
  const output: Record<string, unknown> = {};
  for (const field of [...fields].sort((a, b) => a.split(".").length - b.split(".").length)) {
    const parts = field.split(".");
    let source: unknown = entity;
    let found = true;
    for (const part of parts) {
      if (typeof source !== "object" || source === null || Array.isArray(source) || !Object.hasOwn(source, part)) { found = false; break; }
      source = (source as Record<string, unknown>)[part];
    }
    if (!found) continue;
    let target = output;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (Object.hasOwn(target, part)) {
        // 已选父字段包含完整子树，不再修改或复用上游对象作为写入目标。
        if (fields.includes(parts.slice(0, index + 1).join("."))) break;
      }
      if (index === parts.length - 1) target[part] = source;
      else { target[part] ??= {}; target = target[part] as Record<string, unknown>; }
    }
  }
  return output as T;
}
