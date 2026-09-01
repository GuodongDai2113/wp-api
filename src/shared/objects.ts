/** 移除对象中值为 undefined 的字段，并保留空字符串、零、空数组等显式清空值。 */
export function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
