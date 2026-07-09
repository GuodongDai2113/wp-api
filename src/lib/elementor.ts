/** Elementor 元素 settings 对象。 */
export type ElementorSettings = Record<string, unknown>;

/** Elementor 元素树节点。 */
export interface ElementorElement {
  /** Elementor 7 位十六进制元素 ID。 */
  id: string;
  /** Elementor 元素类型，例如 container 或 widget。 */
  elType: string;
  /** widget 元素的组件类型，容器通常为 null。 */
  widgetType?: string | null;
  /** 是否为嵌套容器或内部元素。 */
  isInner?: boolean;
  /** 当前元素的 Elementor settings。 */
  settings: ElementorSettings;
  /** 子元素列表。 */
  elements: ElementorElement[];
  /** 保留 Elementor 未来或站点插件扩展的额外字段。 */
  [key: string]: unknown;
}

/** Elementor 结构摘要节点。 */
export interface ElementorStructureSummary {
  /** Elementor 元素 ID。 */
  id: string;
  /** Elementor 元素类型。 */
  elType: string;
  /** widget 元素的组件类型。 */
  widgetType?: string;
  /** 便于阅读的关键 settings 摘要。 */
  settings_summary?: ElementorSettings;
  /** 子元素摘要列表。 */
  elements?: ElementorStructureSummary[];
}

/** Elementor 元素搜索条件。 */
export interface ElementorFindFilters {
  /** 按 widget 类型过滤。 */
  widgetType?: string;
  /** 按元素类型过滤。 */
  elementType?: string;
  /** 在字符串 settings 值中搜索的文本。 */
  searchText?: string;
  /** 要求存在的 settings key。 */
  settingKey?: string;
  /** 要求匹配的 settings 值。 */
  settingValue?: string;
}

/** Elementor 元素搜索结果。 */
export interface ElementorFindMatch {
  /** 匹配元素 ID。 */
  element_id: string;
  /** 匹配元素类型。 */
  elType: string;
  /** 匹配 widget 类型。 */
  widgetType: string;
  /** 前几个可读字符串 settings。 */
  settings_preview: ElementorSettings;
}

/** Elementor 元数据构造选项。 */
export interface BuildElementorMetaOptions {
  /** Elementor 模板类型，例如 wp-page 或 wp-post。 */
  templateType?: string;
  /** Elementor 页面级 settings。 */
  pageSettings?: ElementorSettings;
}

/** 结构摘要中保留的 widget settings key。 */
const SUMMARY_WIDGET_KEYS = ["title", "editor", "text", "image", "link", "html", "header_size"];

/** 结构摘要中保留的容器 settings key。 */
const SUMMARY_CONTAINER_KEYS = ["flex_direction", "content_width", "container_type"];

/** 判断未知值是否为普通对象。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** 简化 Elementor 元素树，保留 ID、类型、widget 类型和关键 settings。 */
export function simplifyElementorStructure(tree: ElementorElement[]): ElementorStructureSummary[] {
  return tree.map((element) => {
    const summary: ElementorStructureSummary = {
      id: element.id,
      elType: element.elType
    };

    if (element.widgetType) {
      summary.widgetType = element.widgetType;
    }

    const settingsSummary = extractSettingsSummary(element);
    if (Object.keys(settingsSummary).length > 0) {
      summary.settings_summary = settingsSummary;
    }

    if ((element.elements ?? []).length > 0) {
      summary.elements = simplifyElementorStructure(element.elements);
    }

    return summary;
  });
}

/** 从元素 settings 中提取适合展示的少量关键字段。 */
function extractSettingsSummary(element: ElementorElement): ElementorSettings {
  const summary: ElementorSettings = {};
  const settings = element.settings ?? {};

  for (const key of SUMMARY_WIDGET_KEYS) {
    if (settings[key] !== undefined && settings[key] !== "") {
      summary[key] = summarizeSettingValue(settings[key]);
    }
  }

  if (element.elType === "container") {
    for (const key of SUMMARY_CONTAINER_KEYS) {
      if (settings[key] !== undefined && settings[key] !== "") {
        summary[key] = summarizeSettingValue(settings[key]);
      }
    }
  }

  return summary;
}

/** 缩短过长的字符串 settings 值。 */
function summarizeSettingValue(value: unknown): unknown {
  if (typeof value === "string" && value.length > 100) {
    return `${value.slice(0, 100)}...`;
  }

  return value;
}

/** 根据条件递归搜索 Elementor 元素。 */
export function findElements(tree: ElementorElement[], filters: ElementorFindFilters = {}): ElementorFindMatch[] {
  const matches: ElementorFindMatch[] = [];
  collectElementMatches(tree, filters, matches);
  return matches;
}

/** 递归收集符合条件的元素。 */
function collectElementMatches(
  tree: ElementorElement[],
  filters: ElementorFindFilters,
  matches: ElementorFindMatch[]
): void {
  for (const element of tree) {
    if (elementMatchesFilters(element, filters)) {
      matches.push({
        element_id: element.id,
        elType: element.elType,
        widgetType: element.widgetType ?? "",
        settings_preview: buildSettingsPreview(element.settings ?? {})
      });
    }

    collectElementMatches(element.elements ?? [], filters, matches);
  }
}

/** 判断单个元素是否符合搜索条件。 */
function elementMatchesFilters(element: ElementorElement, filters: ElementorFindFilters): boolean {
  if (filters.elementType && element.elType !== filters.elementType) {
    return false;
  }

  if (filters.widgetType && element.widgetType !== filters.widgetType) {
    return false;
  }

  if (filters.settingKey) {
    if (!(filters.settingKey in (element.settings ?? {}))) {
      return false;
    }

    if (filters.settingValue !== undefined && String(element.settings[filters.settingKey]) !== filters.settingValue) {
      return false;
    }
  }

  if (filters.searchText) {
    const search = filters.searchText.toLowerCase();
    const found = Object.values(element.settings ?? {}).some((value) =>
      typeof value === "string" && value.toLowerCase().includes(search)
    );

    if (!found) {
      return false;
    }
  }

  return true;
}

/** 构造搜索结果中的 settings 预览。 */
function buildSettingsPreview(settings: ElementorSettings): ElementorSettings {
  const preview: ElementorSettings = {};

  for (const [key, value] of Object.entries(settings)) {
    if (Object.keys(preview).length >= 5) {
      break;
    }

    if (typeof value === "string" && value !== "") {
      preview[key] = summarizeSettingValue(value);
    }
  }

  return preview;
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
  return Array.isArray(parsed) ? parsed as ElementorElement[] : [];
}

/** 从 WordPress REST 实体中读取 Elementor 元素树。 */
export function readElementorDataFromEntity(entity: unknown): ElementorElement[] {
  if (!isObject(entity) || !isObject(entity.meta)) {
    return [];
  }

  return parseElementorData(entity.meta._elementor_data);
}

/** 构造写回 WordPress REST API 的 Elementor meta 请求体。 */
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

  if (options.pageSettings !== undefined) {
    meta._elementor_page_settings = options.pageSettings;
  }

  return { meta };
}
