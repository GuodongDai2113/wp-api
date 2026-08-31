import {
  applyElementorContentChanges,
  buildElementorMeta,
  countElements,
  createElementorRevision,
  extractElementorEditableContent,
  readElementorDataFromEntity,
  type ElementorAppliedChange,
  type ElementorContentChange,
  type ElementorEditableContent,
  type ElementorElement,
  type ElementorSettings
} from "../../lib/elementor.js";
import { readBoundedJsonFile } from "../../lib/json-file.js";
import type { WordPressClient } from "../../lib/wp-client.js";

/** Elementor MCP handler 支持的三个页面内容工具名称。 */
export type ElementorToolName =
  | "wp_elementor_get"
  | "wp_elementor_update"
  | "wp_elementor_import";

/** Elementor MCP handler 接收的 camelCase 输入对象。 */
export type ElementorToolInput = Record<string, unknown>;

/** Elementor 读取工具支持的结果视图。 */
export type ElementorReadView = "content" | "data";

/** 所有 Elementor 页面操作共同返回的基础字段。 */
export interface ElementorBasePayload {
  /** WordPress 页面 ID。 */
  post_id: number;
  /** Elementor 工具固定操作的 WordPress 资源。 */
  resource: "pages";
}

/** Elementor 页面正文读取结果。 */
export interface ElementorContentReadPayload extends ElementorBasePayload {
  /** 当前结果为轻量正文视图。 */
  view: "content";
  /** 包含可修改内容字段的元素列表。 */
  elements: ElementorEditableContent[];
  /** 当前筛选后返回的内容元素数量。 */
  count: number;
  /** 完整元素树的 UTF-8 JSON 字节数，供 Agent 判断页面是否接近 10 MiB 上限。 */
  data_bytes: number;
  /** 局部修改时必须回传的页面数据版本，避免覆盖并发编辑。 */
  revision: string;
  /** Agent 将读取结果转换为局部修改输入的简短说明。 */
  how_to_update: string;
}

/** Elementor 页面原始数据读取结果。 */
export interface ElementorDataReadPayload extends ElementorBasePayload {
  /** 当前结果为完整数据视图。 */
  view: "data";
  /** 可备份或传给覆盖导入工具的完整 Elementor 元素树。 */
  data: ElementorElement[];
  /** 完整元素树中的递归元素数量。 */
  elements_count: number;
  /** 完整元素树的 UTF-8 JSON 字节数，供 Agent 判断页面是否接近 10 MiB 上限。 */
  data_bytes: number;
  /** 当前完整页面数据的版本校验值。 */
  revision: string;
}

/** Elementor 页面局部正文修改结果。 */
export interface ElementorUpdatePayload extends ElementorBasePayload {
  /** 表示所有局部修改已在同一次页面保存中完成。 */
  updated: true;
  /** 已修改的元素及字段摘要。 */
  changes: ElementorAppliedChange[];
  /** 页面修改前的完整 Elementor 数据 SHA-256。 */
  revision_before: string;
  /** 页面落盘后回读得到的完整 Elementor 数据 SHA-256。 */
  revision_after: string;
  /** 表示回读数据与请求写入数据完全一致。 */
  match: true;
  /** 表示页面保存后已自动刷新 Elementor 全站缓存。 */
  cache_refreshed: true;
}

/** Elementor 页面覆盖导入结果。 */
export interface ElementorImportPayload extends ElementorBasePayload {
  /** 表示完整元素树已覆盖写入页面。 */
  imported: true;
  /** 写入元素树中的递归元素数量。 */
  elements_count: number;
  /** 页面落盘后回读得到的完整 Elementor 数据 SHA-256。 */
  revision_after: string;
  /** 表示回读数据与输入文件中的数据完全一致。 */
  match: true;
  /** 表示页面保存后已自动刷新 Elementor 全站缓存。 */
  cache_refreshed: true;
}

/** Elementor MCP handler 可能返回的全部业务 payload。 */
export type ElementorToolPayload =
  | ElementorContentReadPayload
  | ElementorDataReadPayload
  | ElementorUpdatePayload
  | ElementorImportPayload;

/** Elementor 页面使用的固定 WordPress REST route。 */
const ELEMENTOR_PAGE_ROUTE = "pages";

/** Elementor Core 提供的全站缓存清理 REST 路径。 */
const ELEMENTOR_CACHE_API_PATH = "elementor/v1/cache";

/** 单次 Elementor 读写允许处理的最大元素数量。 */
const MAX_ELEMENTOR_ELEMENT_COUNT = 10_000;

/** 单次局部修改允许包含的最大元素数量。 */
const MAX_ELEMENTOR_CHANGE_COUNT = 100;

/** Elementor 元素树允许的最大父子层级深度。 */
const MAX_ELEMENTOR_TREE_DEPTH = 100;

/** Elementor 元素树或修改输入允许占用的最大 JSON 字节数。 */
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

/** 判断未知值是否为非数组对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验输入没有资源覆盖字段，并读取正整数页面 ID。 */
function readPostId(input: ElementorToolInput): number {
  if (input.resource !== undefined) {
    throw new Error("Elementor tools do not accept resource; pages is always used.");
  }
  const postId = input.postId;
  if (typeof postId !== "number" || !Number.isInteger(postId) || postId <= 0) {
    throw new Error("postId must be a positive integer.");
  }
  return postId;
}

/** 读取可选非空字符串输入字段。 */
function readOptionalNonBlankString(input: ElementorToolInput, fieldName: string): string | undefined {
  const value = input[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-blank string when provided.`);
  }
  return value;
}

/** 读取正文或完整数据视图；默认返回适合 Agent 局部修改的正文视图。 */
function readView(input: ElementorToolInput): ElementorReadView {
  const value = input.view ?? "content";
  if (value !== "content" && value !== "data") {
    throw new Error("view must be content or data.");
  }
  return value;
}

/** 读取局部修改必须回传的非空页面版本校验值。 */
function readExpectedRevision(input: ElementorToolInput): string {
  const revision = readOptionalNonBlankString(input, "expectedRevision");
  if (revision === undefined) {
    throw new Error("expectedRevision is required; copy revision from wp_elementor_get.");
  }
  return revision;
}

/**
 * 迭代校验未知值可安全序列化为有界 JSON。
 * 校验会拒绝循环或共享引用、非有限数字和 JSON 不支持的运行时类型。
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
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_ELEMENTOR_JSON_BYTES) {
    throw new Error(
      `${label} exceeds the maximum size of ${MAX_ELEMENTOR_JSON_BYTES} bytes.`
      + " Split or simplify the page, or update fewer elements; the Elementor limits are fixed and require code changes to raise."
    );
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
  if (!isRecord(element.settings) && !Array.isArray(element.settings)) {
    throw new Error("Each Elementor element must have a settings object or an empty array.");
  }
  if (Array.isArray(element.settings) && element.settings.length > 0) {
    throw new Error("Elementor settings arrays must be empty; configured settings must use an object.");
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

/** 迭代校验元素树形状、总数量、父子深度和序列化大小。 */
function validateElementorTree(data: unknown[]): ElementorElement[] {
  const pending: PendingElementValidation[] = data.map((element) => ({ element, depth: 1 }));
  let elementCount = 0;
  while (pending.length > 0) {
    const current = pending.pop() as PendingElementValidation;
    if (current.depth > MAX_ELEMENTOR_TREE_DEPTH) {
      throw new Error(
        `Elementor data exceeds the maximum tree depth of ${MAX_ELEMENTOR_TREE_DEPTH}.`
        + " Flatten the nested container structure to continue."
      );
    }
    assertElementShape(current.element);
    elementCount += 1;
    if (elementCount > MAX_ELEMENTOR_ELEMENT_COUNT) {
      throw new Error(
        `Elementor data exceeds the maximum element count of ${MAX_ELEMENTOR_ELEMENT_COUNT}.`
        + " Simplify the page structure or split it into smaller pages."
      );
    }
    for (const child of current.element.elements) {
      pending.push({ element: child, depth: current.depth + 1 });
    }
  }
  assertBoundedJsonValue(data, "Elementor data");
  return data as ElementorElement[];
}

/** 从原始数组或 wp_elementor_get 数据结果中提取完整 Elementor 元素树。 */
function extractImportedData(value: unknown): ElementorElement[] {
  if (Array.isArray(value)) {
    return validateElementorTree(value);
  }
  if (isRecord(value) && value.view === "data" && Array.isArray(value.data)) {
    return validateElementorTree(value.data);
  }
  throw new Error("dataFile must contain an Elementor element array or a wp_elementor_get data result.");
}

/** 从已经通过 MCP 本地路径边界校验的 JSON 文件读取覆盖导入数据。 */
async function readRequiredData(input: ElementorToolInput): Promise<ElementorElement[]> {
  const dataFile = input.dataFile;
  if (typeof dataFile !== "string" || dataFile.trim() === "") {
    throw new Error("dataFile must be a non-blank local JSON file path.");
  }
  try {
    const parsed = await readBoundedJsonFile(dataFile, {
      maxBytes: MAX_ELEMENTOR_JSON_BYTES + 64 * 1024,
      label: "Elementor data file"
    });
    return extractImportedData(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("maximum allowed size")) {
      throw new Error(
        `Elementor data exceeds the maximum size of ${MAX_ELEMENTOR_JSON_BYTES} bytes.`
        + " Split or simplify the page before importing it."
      );
    }
    throw error;
  }
}

/** 读取并校验一批非空、数量有界的局部内容修改。 */
async function readRequiredChanges(input: ElementorToolInput): Promise<ElementorContentChange[]> {
  if (input.changes !== undefined && input.changesFile !== undefined) {
    throw new Error("Provide either changes or changesFile, not both.");
  }
  const changes = input.changesFile === undefined
    ? input.changes
    : await readBoundedJsonFile(
      readOptionalNonBlankString(input, "changesFile") as string,
      { maxBytes: MAX_ELEMENTOR_JSON_BYTES, label: "Elementor changes file" }
    );
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("changes must be a non-empty array.");
  }
  if (changes.length > MAX_ELEMENTOR_CHANGE_COUNT) {
    throw new Error(`changes cannot contain more than ${MAX_ELEMENTOR_CHANGE_COUNT} elements.`);
  }
  assertBoundedJsonValue(changes, "Elementor changes");
  return changes.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`changes[${index}] must be an object.`);
    }
    if (typeof value.elementId !== "string" || value.elementId.length === 0) {
      throw new Error(`changes[${index}].elementId must be a non-empty string.`);
    }
    if (!isRecord(value.settings) || Object.keys(value.settings).length === 0) {
      throw new Error(`changes[${index}].settings must be a non-empty object.`);
    }
    return { elementId: value.elementId, settings: value.settings };
  });
}

/** 使用 edit 上下文从固定 pages route 读取并校验 Elementor 元素树。 */
async function readElementorTree(client: WordPressClient, postId: number): Promise<ElementorElement[]> {
  const result = await client.request<unknown>(`${ELEMENTOR_PAGE_ROUTE}/${postId}`, {
    query: { context: "edit" }
  });
  return validateElementorTree(readElementorDataFromEntity(result.data));
}

/** 把完整 Elementor 元素树写回固定 pages route。 */
async function saveElementorTree(
  client: WordPressClient,
  postId: number,
  data: ElementorElement[]
): Promise<string> {
  const requestedRevision = createElementorRevision(data);
  const savedEntity = await client.update<unknown>(
    ELEMENTOR_PAGE_ROUTE,
    postId,
    buildElementorMeta(data, { templateType: "wp-page" })
  );
  const savedData = validateElementorTree(readElementorDataFromEntity(savedEntity));
  const persistedRevision = createElementorRevision(savedData);
  if (persistedRevision !== requestedRevision) {
    throw new Error("WordPress did not persist the requested Elementor page data.");
  }
  return persistedRevision;
}

/** 在页面数据成功落盘后清理 Elementor 全站缓存，并为部分成功提供明确错误。 */
async function refreshElementorCacheAfterSave(client: WordPressClient): Promise<void> {
  try {
    await client.requestApiPath(ELEMENTOR_CACHE_API_PATH, { method: "DELETE" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Elementor page data was saved, but cache refresh failed: ${message}`);
  }
}

/** 读取页面正文定位信息，或显式读取覆盖导入所需的完整 Elementor 数据。 */
export async function readElementorPage(
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorContentReadPayload | ElementorDataReadPayload> {
  const postId = readPostId(input);
  const view = readView(input);
  const searchText = readOptionalNonBlankString(input, "searchText");
  if (view === "data" && searchText !== undefined) {
    throw new Error("searchText is only supported by the content view.");
  }
  const tree = await readElementorTree(client, postId);
  const revision = createElementorRevision(tree);
  const dataBytes = Buffer.byteLength(JSON.stringify(tree), "utf8");
  if (view === "data") {
    return {
      post_id: postId,
      resource: ELEMENTOR_PAGE_ROUTE,
      view,
      data: tree,
      elements_count: countElements(tree),
      data_bytes: dataBytes,
      revision
    };
  }

  const elements = extractElementorEditableContent(tree, searchText);
  return {
    post_id: postId,
    resource: ELEMENTOR_PAGE_ROUTE,
    view,
    elements,
    count: elements.length,
    data_bytes: dataBytes,
    revision,
    how_to_update: "Call wp_elementor_update with this revision as expectedRevision and changes:[{elementId,settings:{onlyChangedKeys}}]. Copy elementId and setting names from this result; for example settings:{title:'New title'}. data_bytes is the full tree size in bytes; pages over 10 MiB are rejected, and view:\"data\" returns the whole tree, so prefer this view for routine edits."
  };
}

/** 按元素 ID 局部修改现有正文 settings，并在全部校验通过后只保存页面一次。 */
export async function updateElementorPageContent(
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorUpdatePayload> {
  const postId = readPostId(input);
  const expectedRevision = readExpectedRevision(input);
  const changes = await readRequiredChanges(input);
  const tree = await readElementorTree(client, postId);
  const currentRevision = createElementorRevision(tree);
  if (currentRevision !== expectedRevision) {
    throw new Error("Elementor page changed after it was read. Read the page again before updating content.");
  }
  const appliedChanges = applyElementorContentChanges(tree, changes);
  validateElementorTree(tree);
  const persistedRevision = await saveElementorTree(client, postId, tree);
  await refreshElementorCacheAfterSave(client);
  return {
    post_id: postId,
    resource: ELEMENTOR_PAGE_ROUTE,
    updated: true,
    changes: appliedChanges,
    revision_before: currentRevision,
    revision_after: persistedRevision,
    match: true,
    cache_refreshed: true
  };
}

/** 用输入中的完整元素数组覆盖指定 WordPress 页面的 Elementor 数据。 */
export async function importElementorPage(
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorImportPayload> {
  const postId = readPostId(input);
  const data = await readRequiredData(input);
  const persistedRevision = await saveElementorTree(client, postId, data);
  await refreshElementorCacheAfterSave(client);
  return {
    post_id: postId,
    resource: ELEMENTOR_PAGE_ROUTE,
    imported: true,
    elements_count: countElements(data),
    revision_after: persistedRevision,
    match: true,
    cache_refreshed: true
  };
}

/** 将三个 Elementor MCP 工具名称分派到对应的页面内容 handler。 */
export async function executeElementorTool(
  toolName: ElementorToolName,
  client: WordPressClient,
  input: ElementorToolInput
): Promise<ElementorToolPayload> {
  switch (toolName) {
    case "wp_elementor_get":
      return readElementorPage(client, input);
    case "wp_elementor_update":
      return updateElementorPageContent(client, input);
    case "wp_elementor_import":
      return importElementorPage(client, input);
    default: {
      const exhaustiveCheck: never = toolName;
      throw new Error(`Unknown Elementor MCP tool: ${String(exhaustiveCheck)}`);
    }
  }
}
