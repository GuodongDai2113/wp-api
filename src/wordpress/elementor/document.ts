import { createHash } from "node:crypto";

/** Elementor 元素 settings 对象。 */
export type ElementorSettings = Record<string, unknown>;

/** Elementor 原始 settings；官方格式允许未配置元素使用空数组。 */
export type ElementorRawSettings = ElementorSettings | [];

/** Elementor 元素树节点。 */
export interface ElementorElement {
  /** Elementor 元素 ID。 */
  id: string;
  /** Elementor 元素类型，例如 container 或 widget。 */
  elType: string;
  /** widget 元素的组件类型；仅为兼容原始 Elementor 数据保留。 */
  widgetType?: string | null;
  /** 是否为嵌套容器或内部元素。 */
  isInner?: boolean;
  /** 当前元素的 Elementor settings；未配置时可能是官方格式中的空数组。 */
  settings: ElementorRawSettings;
  /** 子元素列表。 */
  elements: ElementorElement[];
  /** Elementor 或站点插件扩展的额外字段。 */
  [key: string]: unknown;
}

/** Elementor 元数据构造选项。 */
export interface BuildElementorMetaOptions {
  /** Elementor 模板类型；本项目固定页面写入时使用 wp-page。 */
  templateType?: string;
}

/** 判断未知值是否为普通对象。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 为完整元素树生成并发修改校验值。 */
export function createElementorRevision(tree: ElementorElement[]): string {
  return createHash("sha256").update(JSON.stringify(tree)).digest("hex");
}

/** 将 REST meta 中的 `_elementor_data` 解析为 Elementor 元素数组。 */
export function parseElementorData(value: unknown): ElementorElement[] {
  if (Array.isArray(value)) {
    return value as ElementorElement[];
  }
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Elementor _elementor_data must contain a JSON array.");
  }
  return parsed as ElementorElement[];
}

/** 从 WordPress REST 页面实体中读取 Elementor 元素树。 */
export function readElementorDataFromEntity(entity: unknown): ElementorElement[] {
  if (
    !isObject(entity)
    || !isObject(entity.meta)
    || !Object.prototype.hasOwnProperty.call(entity.meta, "_elementor_data")
  ) {
    throw new Error(
      "Elementor _elementor_data is not exposed by the pages REST response; register this private meta with show_in_rest before using Elementor tools."
    );
  }
  return parseElementorData(entity.meta._elementor_data);
}

/** 构造写回 WordPress 页面 REST API 的 Elementor meta 请求体。 */
export function buildElementorMeta(
  data: ElementorElement[],
  options: BuildElementorMetaOptions = {}
): { meta: Record<string, unknown> } {
  const meta: Record<string, unknown> = {
    _elementor_data: JSON.stringify(data),
    _elementor_edit_mode: "builder"
  };
  if (options.templateType) {
    meta._elementor_template_type = options.templateType;
  }
  return { meta };
}
