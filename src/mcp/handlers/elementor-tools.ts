import {
  buildElementorMeta,
  countElements,
  findElementById,
  findElements,
  readElementorDataFromEntity,
  simplifyElementorStructure,
  type ElementorElement,
  type ElementorFindMatch,
  type ElementorSettings,
  type ElementorStructureSummary
} from "../../lib/elementor.js";
import type { WordPressClient } from "../../lib/wp-client.js";

/** Elementor MCP handler 支持的工具名称。 */
export type ElementorToolName =
  | "wp_elementor_init"
  | "wp_elementor_export"
  | "wp_elementor_import"
  | "wp_elementor_structure"
  | "wp_elementor_get_element"
  | "wp_elementor_find";

/** Elementor MCP handler 接收的 camelCase 输入对象。 */
export type ElementorToolInput = Record<string, unknown>;

/** 所有 Elementor 页面操作共同返回的基础字段。 */
export interface ElementorBasePayload {
  /** WordPress 页面 ID。 */
  post_id: number;
  /** Elementor MCP 工具固定操作的 WordPress 资源。 */
  resource: "pages";
}

/** Elementor 页面初始化结果。 */
export interface ElementorInitPayload extends ElementorBasePayload {
  /** 表示页面 Elementor 元数据已成功初始化。 */
  initialized: true;
}

/** Elementor 原始元素树导出结果。 */
export interface ElementorExportPayload extends ElementorBasePayload {
  /** 从页面 `_elementor_data` 元数据解析出的完整元素树。 */
  json: ElementorElement[];
}

/** Elementor 原始元素树导入结果。 */
export interface ElementorImportPayload extends ElementorBasePayload {
  /** 表示提供的元素树已成功写入页面。 */
  imported: true;
  /** 写入元素树中的元素总数，包含所有嵌套元素。 */
  elements_count: number;
}

/** Elementor 页面结构摘要结果。 */
export interface ElementorStructurePayload extends ElementorBasePayload {
  /** 仅保留元素 ID、类型和关键设置的结构摘要。 */
  structure: ElementorStructureSummary[];
}

/** Elementor 单元素读取结果。 */
export interface ElementorElementPayload extends ElementorBasePayload {
  /** 被读取元素的 Elementor ID。 */
  element_id: string;
  /** 被读取元素的 Elementor 元素类型。 */
  elType: string;
  /** 被读取元素的 widget 类型；非 widget 元素返回空字符串。 */
  widgetType: string;
  /** 被读取元素的完整 settings 对象。 */
  settings: ElementorSettings;
}

/** Elementor 元素搜索结果。 */
export interface ElementorFindPayload extends ElementorBasePayload {
  /** 符合所有搜索条件的元素摘要列表。 */
  matches: ElementorFindMatch[];
  /** 匹配元素数量。 */
  count: number;
}

/** Elementor MCP handler 可能返回的全部业务 payload。 */
export type ElementorToolPayload =
  | ElementorInitPayload
  | ElementorExportPayload
  | ElementorImportPayload
  | ElementorStructurePayload
  | ElementorElementPayload
  | ElementorFindPayload;

/** Elementor 页面使用的固定 WordPress REST route。 */
const ELEMENTOR_PAGE_ROUTE = "pages";

/** 单次 Elementor 读写允许处理的最大元素数量。 */
const MAX_ELEMENTOR_ELEMENT_COUNT = 10_000;

/** Elementor 元素树允许的最大父子层级深度。 */
const MAX_ELEMENTOR_TREE_DEPTH = 100;

/** Elementor 元素树及页面设置允许占用的最大 JSON 字节数。 */
const MAX_ELEMENTOR_JSON_BYTES = 10 * 1024 * 1024;

/** Elementor 任意 settings 或扩展字段允许的最大 JSON 嵌套深度。 */
const MAX_ELEMENTOR_JSON_DEPTH = 256;

/** 待校验 Elementor 元素及其所在树深度。 */
interface PendingElementValidation {
  /** 尚未校验的元素节点。 */
  element: unknown;
  /** 当前节点在元素父子树中的层级，根元素为 1。 */
  depth: number;
}

/** 待校验 JSON 值及其对象或数组嵌套深度。 */
interface PendingJsonValidation {
  /** 尚未校验的 JSON 值。 */
  value: unknown;
  /** 当前值所在的对象或数组嵌套深度。 */
  depth: number;
}

/** 校验 Elementor 输入没有资源覆盖字段，并读取正整数页面 ID。 */
function readPostId(input: ElementorToolInput): number {
  if (input.resource !== undefined) {
    throw new Error("Elementor MCP tools do not accept resource; pages is always used.");
  }

  const postId = input.postId;
  if (typeof postId !== "number" || !Number.isInteger(postId) || postId <= 0) {
    throw new Error("postId must be a positive integer.");
  }
  return postId;
}

/** 读取可选的 Elementor 元素树，并确保输入保持 MCP 的结构化数组形式。 */
function readOptionalData(input: ElementorToolInput): ElementorElement[] | undefined {
  if (input.data === undefined) {
    return undefined;
  }
  if (!Array.isArray(input.data)) {
    throw new Error("data must be an Elementor element array.");
  }
  return validateElementorTree(input.data);
}

/** 读取必需的 Elementor 元素树。 */
function readRequiredData(input: ElementorToolInput): ElementorElement[] {
  const data = readOptionalData(input);
  if (data === undefined) {
    throw new Error("data is required.");
  }
  return data;
}

/** 判断未知值是否为非数组对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 迭代校验未知值可安全序列化为有界 JSON。
 * 该校验拒绝循环或共享对象引用、非有限数字和 JSON 不支持的运行时类型。
 */
function assertBoundedJsonValue(value: unknown, label: string): void {
  const pending: PendingJsonValidation[] = [{ value, depth: 0 }];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop() as PendingJsonValidation;
    const candidate = current.value;
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") {
      continue;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        throw new Error(`${label} must not contain non-finite numbers.`);
      }
      continue;
    }
    if (typeof candidate !== "object") {
      throw new Error(`${label} must contain only JSON-compatible values.`);
    }
    if (current.depth >= MAX_ELEMENTOR_JSON_DEPTH) {
      throw new Error(`${label} exceeds the maximum JSON depth of ${MAX_ELEMENTOR_JSON_DEPTH}.`);
    }
    if (visited.has(candidate)) {
      throw new Error(`${label} must not contain cyclic or shared object references.`);
    }
    visited.add(candidate);

    const entries = Array.isArray(candidate)
      ? candidate
      : Object.values(candidate as Record<string, unknown>);
    for (const entry of entries) {
      pending.push({ value: entry, depth: current.depth + 1 });
    }
  }

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ELEMENTOR_JSON_BYTES) {
    throw new Error(`${label} exceeds the maximum size of ${MAX_ELEMENTOR_JSON_BYTES} bytes.`);
  }
}

/** 校验元素节点的必填形状以及可选字段类型。 */
function assertElementShape(element: unknown): asserts element is ElementorElement {
  if (!isRecord(element)) {
    throw new Error("Each Elementor element must be an object.");
  }
  if (typeof element.id !== "string" || element.id.length === 0) {
    throw new Error("Each Elementor element must have a non-empty string id.");
  }
  if (typeof element.elType !== "string" || element.elType.length === 0) {
    throw new Error("Each Elementor element must have a non-empty string elType.");
  }
  if (!isRecord(element.settings)) {
    throw new Error("Each Elementor element must have a settings object.");
  }
  if (!Array.isArray(element.elements)) {
    throw new Error("Each Elementor element must have an elements array.");
  }
  if (element.widgetType !== undefined && element.widgetType !== null && typeof element.widgetType !== "string") {
    throw new Error("Elementor widgetType must be a string or null when provided.");
  }
  if (element.isInner !== undefined && typeof element.isInner !== "boolean") {
    throw new Error("Elementor isInner must be a boolean when provided.");
  }
}

/**
 * 迭代校验 Elementor 元素树的节点形状、总数量、父子深度和序列化大小。
 * 通过后，现有递归读取逻辑只会处理已知安全深度的树。
 */
function validateElementorTree(data: unknown[]): ElementorElement[] {
  const pending: PendingElementValidation[] = data.map((element) => ({ element, depth: 1 }));
  let elementCount = 0;

  while (pending.length > 0) {
    const current = pending.pop() as PendingElementValidation;
    if (current.depth > MAX_ELEMENTOR_TREE_DEPTH) {
      throw new Error(`Elementor data exceeds the maximum tree depth of ${MAX_ELEMENTOR_TREE_DEPTH}.`);
    }
    assertElementShape(current.element);
    elementCount += 1;
    if (elementCount > MAX_ELEMENTOR_ELEMENT_COUNT) {
      throw new Error(`Elementor data exceeds the maximum element count of ${MAX_ELEMENTOR_ELEMENT_COUNT}.`);
    }
    for (const child of current.element.elements) {
      pending.push({ element: child, depth: current.depth + 1 });
    }
  }

  assertBoundedJsonValue(data, "Elementor data");
  return data as ElementorElement[];
}

/** 读取可选的 Elementor 页面设置对象。 */
function readOptionalPageSettings(input: ElementorToolInput): ElementorSettings | undefined {
  if (input.pageSettings === undefined) {
    return undefined;
  }
  if (!isRecord(input.pageSettings)) {
    throw new Error("pageSettings must be an object.");
  }
  assertBoundedJsonValue(input.pageSettings, "Elementor pageSettings");
  return input.pageSettings;
}

/** 读取必需的非空字符串输入字段。 */
function readRequiredString(input: ElementorToolInput, fieldName: string): string {
  const value = input[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

/** 读取可选字符串输入字段，并拒绝其他 JSON 类型。 */
function readOptionalString(input: ElementorToolInput, fieldName: string): string | undefined {
  const value = input[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  return value;
}

/** 使用 edit 上下文读取页面实体及其 Elementor 元素树。 */
async function readElementorTree(client: WordPressClient, postId: number): Promise<ElementorElement[]> {
  const result = await client.request<unknown>(`${ELEMENTOR_PAGE_ROUTE}/${postId}`, {
    query: { context: "edit" }
  });
  return validateElementorTree(readElementorDataFromEntity(result.data));
}

/** 把 Elementor 元素树和可选页面设置写回页面元数据。 */
async function saveElementorTree(
  client: WordPressClient,
  postId: number,
  data: ElementorElement[],
  pageSettings?: ElementorSettings
): Promise<void> {
  await client.update(
    ELEMENTOR_PAGE_ROUTE,
    postId,
    buildElementorMeta(data, {
      templateType: "wp-page",
      pageSettings
    })
  );
}

/** 初始化现有 WordPress 页面的 Elementor 元数据。 */
export async function initializeElementorPage(
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorInitPayload> {
  const postId = readPostId(input);
  const data = readOptionalData(input) ?? [];
  const pageSettings = readOptionalPageSettings(input);
  const existingData = await readElementorTree(client, postId);
  if (existingData.length > 0) {
    throw new Error(
      "Elementor page already contains elements. Export a backup and use wp_elementor_import for an intentional replacement."
    );
  }
  await saveElementorTree(client, postId, data, pageSettings);
  return {
    post_id: postId,
    resource: ELEMENTOR_PAGE_ROUTE,
    initialized: true
  };
}

/** 导出现有 WordPress 页面的完整 Elementor 元素树。 */
export async function exportElementorPage(
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorExportPayload> {
  const postId = readPostId(input);
  const tree = await readElementorTree(client, postId);
  return {
    post_id: postId,
    resource: ELEMENTOR_PAGE_ROUTE,
    json: tree
  };
}

/** 用 MCP 输入中的结构化元素数组替换页面的完整 Elementor 元素树。 */
export async function importElementorPage(
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorImportPayload> {
  const postId = readPostId(input);
  const data = readRequiredData(input);
  await saveElementorTree(client, postId, data);
  return {
    post_id: postId,
    resource: ELEMENTOR_PAGE_ROUTE,
    imported: true,
    elements_count: countElements(data)
  };
}

/** 读取现有 WordPress 页面的轻量 Elementor 结构摘要。 */
export async function getElementorStructure(
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorStructurePayload> {
  const postId = readPostId(input);
  const tree = await readElementorTree(client, postId);
  return {
    post_id: postId,
    resource: ELEMENTOR_PAGE_ROUTE,
    structure: simplifyElementorStructure(tree)
  };
}

/** 按元素 ID 读取现有 WordPress 页面中的一个 Elementor 元素。 */
export async function getElementorElement(
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorElementPayload> {
  const postId = readPostId(input);
  const elementId = readRequiredString(input, "elementId");
  const tree = await readElementorTree(client, postId);
  const element = findElementById(tree, elementId);
  if (!element) {
    throw new Error(`Element not found: ${elementId}`);
  }
  return {
    post_id: postId,
    resource: ELEMENTOR_PAGE_ROUTE,
    element_id: element.id,
    elType: element.elType,
    widgetType: element.widgetType ?? "",
    settings: element.settings ?? {}
  };
}

/** 使用 camelCase MCP 过滤字段搜索现有页面中的 Elementor 元素。 */
export async function findElementorPageElements(
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorFindPayload> {
  const postId = readPostId(input);
  const tree = await readElementorTree(client, postId);
  const matches = findElements(tree, {
    widgetType: readOptionalString(input, "widgetType"),
    elementType: readOptionalString(input, "elementType"),
    searchText: readOptionalString(input, "searchText"),
    settingKey: readOptionalString(input, "settingKey"),
    settingValue: readOptionalString(input, "settingValue")
  });
  return {
    post_id: postId,
    resource: ELEMENTOR_PAGE_ROUTE,
    matches,
    count: matches.length
  };
}

/** 将 Elementor MCP 工具名称分派到对应的直接业务 handler。 */
export async function executeElementorTool(
  toolName: ElementorToolName,
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorToolPayload> {
  switch (toolName) {
    case "wp_elementor_init":
      return initializeElementorPage(client, input);
    case "wp_elementor_export":
      return exportElementorPage(client, input);
    case "wp_elementor_import":
      return importElementorPage(client, input);
    case "wp_elementor_structure":
      return getElementorStructure(client, input);
    case "wp_elementor_get_element":
      return getElementorElement(client, input);
    case "wp_elementor_find":
      return findElementorPageElements(client, input);
    default: {
      const exhaustiveCheck: never = toolName;
      throw new Error(`Unknown Elementor MCP tool: ${String(exhaustiveCheck)}`);
    }
  }
}
