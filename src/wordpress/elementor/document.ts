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

/** Agent 可读取和局部修改的单个内容元素。 */
export interface ElementorEditableContent {
  /** 局部修改时使用的稳定元素 ID。 */
  elementId: string;
  /** 该元素当前存在且允许修改的内容字段。 */
  settings: ElementorSettings;
}

/** 单个元素的局部内容修改请求。 */
export interface ElementorContentChange {
  /** 要修改的 Elementor 元素 ID。 */
  elementId: string;
  /** 只包含本次需要修改的现有内容字段。 */
  settings: ElementorSettings;
}

/** 已应用的单个元素修改摘要。 */
export interface ElementorAppliedChange {
  /** 已修改的 Elementor 元素 ID。 */
  elementId: string;
  /** 已修改的顶层内容字段名称。 */
  fields: string[];
}

/** Elementor 元数据构造选项。 */
export interface BuildElementorMetaOptions {
  /** Elementor 模板类型；本项目固定页面写入时使用 wp-page。 */
  templateType?: string;
}

/** 常见重复内容字段；其数组值应整体替换。 */
const REPEATER_CONTENT_KEYS = new Set(["tabs", "items", "slides", "icon_list", "carousel", "gallery"]);

/** 明确不属于正文内容的设置名称片段。 */
const NON_CONTENT_KEY_PARTS = [
  "align",
  "animation",
  "background",
  "border",
  "breakpoint",
  "color",
  "css",
  "font",
  "gap",
  "height",
  "hover",
  "margin",
  "mobile",
  "motion",
  "opacity",
  "padding",
  "position",
  "responsive",
  "shadow",
  "size",
  "spacing",
  "tablet",
  "transform",
  "typography",
  "width",
  "z_index"
];

/** 判断未知值是否为普通对象。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断 setting 名称是否表达可编辑正文，而不是布局、样式或响应式配置。 */
export function isElementorContentSettingKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (NON_CONTENT_KEY_PARTS.some((part) => normalized.includes(part))) {
    return false;
  }
  if (REPEATER_CONTENT_KEYS.has(normalized)) {
    return true;
  }
  return /(?:^|_)(?:title|text|editor|paragraph|content|description|caption|label|name|job|url|link|image|html|shortcode)$/.test(normalized);
}

/** 在元素树中查找指定 ID 的元素。 */
export function findElementById(tree: ElementorElement[], elementId: string): ElementorElement | null {
  for (const element of tree) {
    if (element.id === elementId) {
      return element;
    }
    const found = findElementById(element.elements ?? [], elementId);
    if (found) {
      return found;
    }
  }
  return null;
}

/** 统计元素树中的元素数量。 */
export function countElements(tree: ElementorElement[]): number {
  return tree.reduce((total, element) => total + 1 + countElements(element.elements ?? []), 0);
}

/** 为读取到的完整元素树生成并发修改校验值。 */
export function createElementorRevision(tree: ElementorElement[]): string {
  return createHash("sha256").update(JSON.stringify(tree)).digest("hex");
}

/** 从完整 Elementor 树中提取 Agent 修改正文所需的元素 ID 和现有内容字段。 */
export function extractElementorEditableContent(
  tree: ElementorElement[],
  searchText?: string
): ElementorEditableContent[] {
  const result: ElementorEditableContent[] = [];
  const normalizedSearch = searchText?.trim().toLowerCase() ?? "";
  collectEditableContent(tree, normalizedSearch, result);
  return result;
}

/** 递归收集包含可编辑内容字段并符合可选文本筛选的元素。 */
function collectEditableContent(
  tree: ElementorElement[],
  normalizedSearch: string,
  result: ElementorEditableContent[]
): void {
  for (const element of tree) {
    const elementSettings = isObject(element.settings) ? element.settings : {};
    const settings = Object.fromEntries(
      Object.entries(elementSettings).filter(([key, value]) =>
        isElementorContentSettingKey(key) && value !== undefined && value !== ""
      )
    );
    if (
      Object.keys(settings).length > 0
      && (normalizedSearch === "" || JSON.stringify(settings).toLowerCase().includes(normalizedSearch))
    ) {
      result.push({ elementId: element.id, settings });
    }
    collectEditableContent(element.elements ?? [], normalizedSearch, result);
  }
}

/** 判断两个 JSON 值是否具有可安全局部替换的相同顶层类型。 */
function hasCompatibleJsonType(current: unknown, incoming: unknown): boolean {
  if (Array.isArray(current) || Array.isArray(incoming)) {
    return Array.isArray(current) && Array.isArray(incoming);
  }
  if (isObject(current) || isObject(incoming)) {
    return isObject(current) && isObject(incoming);
  }
  return typeof current === typeof incoming;
}

/** 深合并内容对象并整体替换数组或标量，避免局部链接、图片更新丢失同级值。 */
function mergeContentValue(current: unknown, incoming: unknown, fieldPath: string): unknown {
  if (!hasCompatibleJsonType(current, incoming)) {
    throw new TypeError(`${fieldPath} must keep the value type returned by wp_elementor_get.`);
  }
  if (!isObject(current) || !isObject(incoming)) {
    return incoming;
  }

  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    merged[key] = key in current
      ? mergeContentValue(current[key], value, `${fieldPath}.${key}`)
      : value;
  }
  return merged;
}

/**
 * 校验并应用一批局部正文修改。
 * 每个元素只能出现一次，且只能修改读取工具会暴露的现有内容字段。
 */
export function applyElementorContentChanges(
  tree: ElementorElement[],
  changes: ElementorContentChange[]
): ElementorAppliedChange[] {
  const seenElementIds = new Set<string>();
  const prepared: Array<{
    /** 待更新的原始元素引用。 */
    element: ElementorElement;
    /** 校验完成后的新 settings。 */
    settings: ElementorSettings;
    /** 本次修改的字段名称。 */
    fields: string[];
  }> = [];

  for (const change of changes) {
    if (seenElementIds.has(change.elementId)) {
      throw new Error(`Duplicate Elementor element change: ${change.elementId}`);
    }
    seenElementIds.add(change.elementId);
    const element = findElementById(tree, change.elementId);
    if (!element) {
      throw new Error(`Elementor element not found: ${change.elementId}`);
    }

    const fields = Object.keys(change.settings);
    if (fields.length === 0) {
      throw new Error(`Elementor change settings must not be empty: ${change.elementId}`);
    }
    if (!isObject(element.settings)) {
      throw new Error(`Elementor element has no editable content settings: ${change.elementId}`);
    }
    const currentSettings = element.settings;
    const nextSettings: ElementorSettings = { ...currentSettings };
    for (const key of fields) {
      if (!isElementorContentSettingKey(key) || !(key in currentSettings)) {
        throw new Error(`Elementor content field is not editable or does not exist: ${change.elementId}.${key}`);
      }
      nextSettings[key] = mergeContentValue(
        currentSettings[key],
        change.settings[key],
        `${change.elementId}.${key}`
      );
    }
    prepared.push({ element, settings: nextSettings, fields });
  }

  for (const update of prepared) {
    update.element.settings = update.settings;
  }
  return prepared.map((update) => ({ elementId: update.element.id, fields: update.fields }));
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
