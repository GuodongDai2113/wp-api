import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  buildElementorMeta,
  createElementorRevision,
  readElementorDataFromEntity,
  type ElementorElement
} from "../../wordpress/elementor/document.js";
import { normalizeWordPressBaseUrl, type WordPressClient } from "../../wordpress/client.js";
import {
  readBoundedJsonFile,
  readBoundedJsonFileWithMetadata,
  writeJsonFileAtomically,
  type AtomicJsonFileResult,
  type BoundedJsonFileResult
} from "../../shared/files/json.js";

/** Elementor data 默认允许占用的最大紧凑 JSON 字节数。 */
export const DEFAULT_MAX_ELEMENTOR_DATA_BYTES = 100 * 1024 * 1024;

/** Elementor 本地文件格式标识。 */
export const ELEMENTOR_FILE_FORMAT = "wp-api.elementor-page";

/** Elementor 本地文件格式版本。 */
export const ELEMENTOR_FILE_VERSION = 1;

/** Elementor MCP handler 支持的本地文件工作流工具名称。 */
export type ElementorToolName =
  | "wp_elementor_pull"
  | "wp_elementor_inspect"
  | "wp_elementor_edit"
  | "wp_elementor_push";

/** Elementor MCP handler 接收的 camelCase 输入对象。 */
export type ElementorToolInput = Record<string, unknown>;

/** Elementor 文件工作流运行选项。 */
export interface ElementorWorkflowOptions {
  /** 未指定 outputFile 时保存拉取结果的目录。 */
  resultDirectory?: string;
  /** Elementor data 允许占用的最大紧凑 JSON 字节数。 */
  maxDataBytes?: number;
}

/** Elementor 本地文件记录的远端来源。 */
export interface ElementorFileSource {
  /** 规范化后的 WordPress 站点根地址。 */
  site_url: string;
  /** WordPress 页面 ID。 */
  post_id: number;
  /** 拉取或最近一次成功同步时的远端 data revision。 */
  revision: string;
}

/** 可由本地编辑器修改的版本化 Elementor 文件。 */
export interface ElementorDataFile {
  /** 固定文件格式标识。 */
  format: typeof ELEMENTOR_FILE_FORMAT;
  /** 固定文件格式版本。 */
  version: typeof ELEMENTOR_FILE_VERSION;
  /** 用于站点、页面和并发保护的来源信息。 */
  source: ElementorFileSource;
  /** 完整 Elementor 元素树；本地修改应只编辑该字段。 */
  data: ElementorElement[];
}

/** Elementor 拉取结果。 */
export interface ElementorPullPayload {
  /** 表示页面 data 已成功拉取到本地文件。 */
  pulled: true;
  /** 已生成文件的绝对路径。 */
  file_path: string;
  /** 规范化后的来源站点地址。 */
  site_url: string;
  /** 来源页面 ID。 */
  post_id: number;
  /** 元素树中的递归元素数量。 */
  elements_count: number;
  /** 紧凑 data JSON 的 UTF-8 字节数。 */
  data_bytes: number;
  /** 当前远端 data revision。 */
  revision: string;
  /** 本地封装文件字节数。 */
  file_bytes: number;
  /** 本地封装文件内容的 SHA-256。 */
  file_sha256: string;
}

/** Elementor 上传结果。 */
export interface ElementorPushPayload {
  /** 表示本地文件已经与远端安全同步。 */
  pushed: true;
  /** 表示本次调用实际执行了页面写入。 */
  remote_updated: boolean;
  /** 表示本次调用是否执行了 Elementor 缓存刷新。 */
  cache_refreshed: boolean;
  /** 已同步并更新基线的本地文件绝对路径。 */
  file_path: string;
  /** 规范化后的目标站点地址。 */
  site_url: string;
  /** 目标页面 ID。 */
  post_id: number;
  /** 元素树中的递归元素数量。 */
  elements_count: number;
  /** 紧凑 data JSON 的 UTF-8 字节数。 */
  data_bytes: number;
  /** 本次同步开始时读取到的远端 revision。 */
  revision_before: string;
  /** 同步完成后的远端和本地基线 revision。 */
  revision_after: string;
  /** 表示远端持久化 data 与本地 data 完全一致。 */
  match: true;
  /** 更新基线后的本地文件字节数。 */
  file_bytes: number;
  /** 更新基线后的本地文件内容 SHA-256。 */
  file_sha256: string;
}

/** Elementor inspect 返回的单个元素定位结果。 */
export interface ElementorInspectMatch {
  /** 元素 ID。 */
  element_id: string;
  /** 元素类型。 */
  element_type: string;
  /** 可选 widget 类型。 */
  widget_type?: string | null;
  /** 从文件根开始定位元素的 JSON Pointer。 */
  pointer: string;
  /** 直接父元素 ID；根元素为 null。 */
  parent_id: string | null;
  /** 直接子元素数量。 */
  children_count: number;
  /** 不含后代树的完整元素字段，或显式请求的完整子树。 */
  element: Record<string, unknown>;
}

/** Elementor 本地文件检查结果。 */
export interface ElementorInspectPayload {
  /** 表示本地文件已经成功解析和校验。 */
  inspected: true;
  /** 已检查文件的绝对路径。 */
  file_path: string;
  /** 原始文件字节数。 */
  file_bytes: number;
  /** 原始文件内容 SHA-256。 */
  file_sha256: string;
  /** 文件中的来源站点地址。 */
  site_url: string;
  /** 文件中的来源页面 ID。 */
  post_id: number;
  /** 文件保存的远端基线 revision。 */
  baseline_revision: string;
  /** 当前本地 data 计算出的 revision。 */
  data_revision: string;
  /** 完整树递归元素数量。 */
  elements_count: number;
  /** 紧凑 data JSON 字节数。 */
  data_bytes: number;
  /** JSON Pointer 查询返回的值。 */
  pointer_result?: { pointer: string; value: unknown };
  /** 元素筛选命中的结果。 */
  matches?: ElementorInspectMatch[];
  /** 元素筛选在截断前的命中总数。 */
  total_matches?: number;
  /** 表示匹配结果是否受 limit 截断。 */
  truncated?: boolean;
}

/** Elementor settings 更新操作。 */
export interface ElementorUpdateSettingsOperation {
  /** 操作类型。 */
  op: "update_settings";
  /** 目标元素 ID。 */
  elementId: string;
  /** 新增或覆盖的顶层 settings 字段。 */
  settings: Record<string, unknown>;
  /** 需要从 settings 中删除的顶层字段。 */
  removeSettings?: string[];
}

/** Elementor 元素替换操作。 */
export interface ElementorReplaceElementOperation {
  /** 操作类型。 */
  op: "replace_element";
  /** 目标元素 ID；替换元素必须保持相同 ID。 */
  elementId: string;
  /** 替换后的完整元素和子树。 */
  element: ElementorElement;
}

/** Elementor 子元素插入操作。 */
export interface ElementorInsertChildOperation {
  /** 操作类型。 */
  op: "insert_child";
  /** 目标父元素 ID；省略时插入 data 根数组。 */
  parentElementId?: string;
  /** 插入位置；省略时追加到目标数组末尾。 */
  index?: number;
  /** 要插入的完整元素和子树。 */
  element: ElementorElement;
}

/** Elementor 元素删除操作。 */
export interface ElementorRemoveElementOperation {
  /** 操作类型。 */
  op: "remove_element";
  /** 要删除的元素 ID。 */
  elementId: string;
}

/** Elementor 元素移动操作。 */
export interface ElementorMoveElementOperation {
  /** 操作类型。 */
  op: "move_element";
  /** 要移动的元素 ID。 */
  elementId: string;
  /** 新父元素 ID；省略时移动到 data 根数组。 */
  parentElementId?: string;
  /** 在新父数组中的位置；省略时追加。 */
  index?: number;
}

/** Elementor 本地编辑支持的领域操作。 */
export type ElementorEditOperation =
  | ElementorUpdateSettingsOperation
  | ElementorReplaceElementOperation
  | ElementorInsertChildOperation
  | ElementorRemoveElementOperation
  | ElementorMoveElementOperation;

/** Elementor 本地编辑的单项结果摘要。 */
export interface ElementorAppliedEdit {
  /** 操作在输入数组中的零基索引。 */
  index: number;
  /** 已执行的操作类型。 */
  op: ElementorEditOperation["op"];
  /** 操作涉及的主要元素 ID。 */
  element_id: string;
}

/** Elementor 本地文件编辑结果。 */
export interface ElementorEditPayload {
  /** 表示全部操作已成功原子写回本地文件。 */
  edited: true;
  /** 被修改文件的绝对路径。 */
  file_path: string;
  /** 修改前的文件 SHA-256。 */
  file_sha256_before: string;
  /** 修改后的文件 SHA-256。 */
  file_sha256_after: string;
  /** 修改后的文件字节数。 */
  file_bytes: number;
  /** 修改前的本地 data revision。 */
  data_revision_before: string;
  /** 修改后的本地 data revision。 */
  data_revision_after: string;
  /** 修改后完整树的递归元素数量。 */
  elements_count: number;
  /** 修改后紧凑 data JSON 字节数。 */
  data_bytes: number;
  /** 按输入顺序执行的操作摘要。 */
  operations: ElementorAppliedEdit[];
}

/** Elementor MCP handler 可能返回的业务 payload。 */
export type ElementorToolPayload =
  | ElementorPullPayload
  | ElementorInspectPayload
  | ElementorEditPayload
  | ElementorPushPayload;

/** Elementor 页面使用的固定 WordPress REST route。 */
const ELEMENTOR_PAGE_ROUTE = "pages";

/** Elementor Core 提供的全站缓存清理 REST 路径。 */
const ELEMENTOR_CACHE_API_PATH = "elementor/v1/cache";

/** 单次 Elementor 读写允许处理的最大元素数量。 */
const MAX_ELEMENTOR_ELEMENT_COUNT = 100_000;

/** Elementor 元素树允许的最大父子层级深度。 */
const MAX_ELEMENTOR_TREE_DEPTH = 100;

/** Elementor 任意 settings 或扩展字段允许的最大 JSON 嵌套深度。 */
const MAX_ELEMENTOR_JSON_DEPTH = 256;

/** Elementor REST 外层 JSON 和本地缩进格式允许使用的固定额外字节数。 */
const ELEMENTOR_ENVELOPE_OVERHEAD_BYTES = 1024 * 1024;

/** 单次本地 edit 允许执行的最大操作数量。 */
const MAX_ELEMENTOR_EDIT_OPERATIONS = 100;

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

/** 已完成校验的 Elementor 树统计。 */
interface ValidatedElementorTree {
  /** 完整 Elementor 元素树。 */
  data: ElementorElement[];
  /** 递归元素数量。 */
  elementsCount: number;
  /** 紧凑 JSON UTF-8 字节数。 */
  dataBytes: number;
}

/** 元素在完整 Elementor 树中的可变定位信息。 */
interface ElementorElementLocation {
  /** 当前元素对象。 */
  element: ElementorElement;
  /** 包含当前元素的根数组或父元素 children 数组。 */
  siblings: ElementorElement[];
  /** 当前元素在 siblings 中的索引。 */
  index: number;
  /** 直接父元素；根元素为 null。 */
  parent: ElementorElement | null;
  /** 从版本化文件根开始的 JSON Pointer。 */
  pointer: string;
}

/** 已读取并完成领域校验的 Elementor 本地文件。 */
interface LoadedElementorDataFile {
  /** 规范化后的版本化文件内容。 */
  envelope: ElementorDataFile;
  /** 完整树统计。 */
  validated: ValidatedElementorTree;
  /** 原始文件摘要。 */
  file: BoundedJsonFileResult;
}

/** 判断未知值是否为非数组对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 规范化 Elementor data 字节上限。 */
function normalizeMaxDataBytes(value: number | undefined): number {
  const normalized = value ?? DEFAULT_MAX_ELEMENTOR_DATA_BYTES;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError("Elementor maxDataBytes must be a positive safe integer.");
  }
  return normalized;
}

/** 计算包含 REST 转义或本地缩进开销的安全外层字节上限。 */
function calculateEnvelopeLimit(maxDataBytes: number): number {
  const limit = maxDataBytes * 2 + ELEMENTOR_ENVELOPE_OVERHEAD_BYTES;
  if (!Number.isSafeInteger(limit)) {
    throw new TypeError("Elementor maxDataBytes is too large to derive a safe envelope limit.");
  }
  return limit;
}

/** 从工具输入读取正整数页面 ID。 */
function readPostId(input: ElementorToolInput): number {
  const postId = input.postId;
  if (typeof postId !== "number" || !Number.isInteger(postId) || postId <= 0) {
    throw new Error("postId must be a positive integer.");
  }
  return postId;
}

/** 确保需要远端访问的 Elementor 工具已经解析 WordPress client。 */
function requireElementorClient(client: WordPressClient | undefined, toolName: ElementorToolName): WordPressClient {
  if (!client) {
    throw new Error(`${toolName} requires a WordPress client.`);
  }
  return client;
}

/** 拒绝纯本地 Elementor 工具收到远端连接字段。 */
function assertLocalElementorInput(input: ElementorToolInput, toolName: ElementorToolName): void {
  if (input.client !== undefined || input.siteUrl !== undefined) {
    throw new Error(`${toolName} is a local tool and does not accept client or siteUrl.`);
  }
}

/** 从工具输入读取必填非空字符串。 */
function readRequiredString(input: ElementorToolInput, fieldName: string): string {
  const value = input[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-blank string.`);
  }
  return value;
}

/** 从工具输入读取可选非空字符串。 */
function readOptionalString(input: ElementorToolInput, fieldName: string): string | undefined {
  const value = input[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-blank string when provided.`);
  }
  return value;
}

/** 从工具输入读取可选布尔值。 */
function readOptionalBoolean(input: ElementorToolInput, fieldName: string, fallback: boolean): boolean {
  const value = input[fieldName];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean when provided.`);
  }
  return value;
}

/** 迭代校验未知值可安全序列化为有界 JSON，并返回紧凑字节数。 */
function assertBoundedJsonValue(value: unknown, label: string, maxDataBytes: number): number {
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
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maxDataBytes) {
    throw new Error(`${label} exceeds the maximum size of ${maxDataBytes} bytes.`);
  }
  return bytes;
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

/** 迭代校验元素树形状、总数量、父子深度和紧凑 JSON 大小。 */
function validateElementorTree(data: unknown, maxDataBytes: number): ValidatedElementorTree {
  if (!Array.isArray(data)) {
    throw new Error("Elementor data must be an array.");
  }
  const pending: PendingElementValidation[] = data.map((element) => ({ element, depth: 1 }));
  const elementIds = new Set<string>();
  let elementsCount = 0;
  while (pending.length > 0) {
    const current = pending.pop() as PendingElementValidation;
    if (current.depth > MAX_ELEMENTOR_TREE_DEPTH) {
      throw new Error(`Elementor data exceeds the maximum tree depth of ${MAX_ELEMENTOR_TREE_DEPTH}.`);
    }
    assertElementShape(current.element);
    if (elementIds.has(current.element.id)) {
      throw new Error(`Elementor data contains a duplicate element ID: ${current.element.id}`);
    }
    elementIds.add(current.element.id);
    elementsCount += 1;
    if (elementsCount > MAX_ELEMENTOR_ELEMENT_COUNT) {
      throw new Error(`Elementor data exceeds the maximum element count of ${MAX_ELEMENTOR_ELEMENT_COUNT}.`);
    }
    for (const child of current.element.elements) {
      pending.push({ element: child, depth: current.depth + 1 });
    }
  }
  return {
    data: data as ElementorElement[],
    elementsCount,
    dataBytes: assertBoundedJsonValue(data, "Elementor data", maxDataBytes)
  };
}

/** 校验并解析版本化 Elementor 本地文件。 */
function validateElementorDataFile(value: unknown, maxDataBytes: number): ElementorDataFile {
  if (!isRecord(value) || value.format !== ELEMENTOR_FILE_FORMAT || value.version !== ELEMENTOR_FILE_VERSION) {
    throw new Error(`Elementor data file must use format ${ELEMENTOR_FILE_FORMAT} version ${ELEMENTOR_FILE_VERSION}.`);
  }
  if (!isRecord(value.source)) {
    throw new Error("Elementor data file source must be an object.");
  }
  const siteUrl = value.source.site_url;
  const postId = value.source.post_id;
  const revision = value.source.revision;
  if (typeof siteUrl !== "string" || siteUrl.trim() === "") {
    throw new Error("Elementor data file source.site_url must be a non-blank string.");
  }
  if (typeof postId !== "number" || !Number.isInteger(postId) || postId <= 0) {
    throw new Error("Elementor data file source.post_id must be a positive integer.");
  }
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) {
    throw new Error("Elementor data file source.revision must be a lowercase SHA-256 value.");
  }
  const validated = validateElementorTree(value.data, maxDataBytes);
  return {
    format: ELEMENTOR_FILE_FORMAT,
    version: ELEMENTOR_FILE_VERSION,
    source: { site_url: normalizeWordPressBaseUrl(siteUrl), post_id: postId, revision },
    data: validated.data
  };
}

/** 读取并校验版本化 Elementor 本地文件，同时保留原始文件摘要。 */
async function loadElementorDataFile(
  dataFile: string,
  maxDataBytes: number
): Promise<LoadedElementorDataFile> {
  const file = await readBoundedJsonFileWithMetadata(dataFile, {
    maxBytes: calculateEnvelopeLimit(maxDataBytes),
    label: "Elementor data file"
  });
  const envelope = validateElementorDataFile(file.value, maxDataBytes);
  return {
    envelope,
    validated: validateElementorTree(envelope.data, maxDataBytes),
    file
  };
}

/** 把 JSON Pointer 路径片段编码为 RFC 6901 形式。 */
function encodeJsonPointerToken(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** 解码并严格校验 RFC 6901 JSON Pointer 路径片段。 */
function decodeJsonPointerToken(value: string): string {
  if (/~(?:[^01]|$)/.test(value)) {
    throw new Error(`Invalid JSON Pointer escape sequence in token: ${value}`);
  }
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** 从版本化 Elementor 文件根解析 JSON Pointer。 */
function resolveJsonPointer(root: ElementorDataFile, pointer: string): unknown {
  if (pointer === "") {
    return root;
  }
  if (!pointer.startsWith("/")) {
    throw new Error("jsonPointer must be empty or start with '/'.");
  }
  let current: unknown = root;
  for (const encodedToken of pointer.slice(1).split("/")) {
    const token = decodeJsonPointerToken(encodedToken);
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) {
        throw new Error(`JSON Pointer array token must be a non-negative integer: ${token}`);
      }
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) {
        throw new Error(`JSON Pointer array index is out of range: ${token}`);
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) {
      throw new Error(`JSON Pointer path does not exist: ${pointer}`);
    }
    current = current[token];
  }
  return current;
}

/** 按文档顺序收集完整元素树的定位信息。 */
function collectElementLocations(tree: ElementorElement[]): ElementorElementLocation[] {
  const result: ElementorElementLocation[] = [];
  const pending: ElementorElementLocation[] = [];
  for (let index = tree.length - 1; index >= 0; index -= 1) {
    pending.push({ element: tree[index], siblings: tree, index, parent: null, pointer: `/data/${index}` });
  }
  while (pending.length > 0) {
    const location = pending.pop() as ElementorElementLocation;
    result.push(location);
    for (let index = location.element.elements.length - 1; index >= 0; index -= 1) {
      pending.push({
        element: location.element.elements[index],
        siblings: location.element.elements,
        index,
        parent: location.element,
        pointer: `${location.pointer}/elements/${index}`
      });
    }
  }
  return result;
}

/** 按唯一元素 ID 查找可变定位信息。 */
function findElementLocation(tree: ElementorElement[], elementId: string): ElementorElementLocation {
  const location = collectElementLocations(tree).find((candidate) => candidate.element.id === elementId);
  if (!location) {
    throw new Error(`Elementor element not found: ${elementId}`);
  }
  return location;
}

/** 判断一个元素子树是否包含指定元素 ID。 */
function subtreeContainsElementId(element: ElementorElement, elementId: string): boolean {
  const pending = [element];
  while (pending.length > 0) {
    const current = pending.pop() as ElementorElement;
    if (current.id === elementId) {
      return true;
    }
    pending.push(...current.elements);
  }
  return false;
}

/** 读取 inspect 的结果数量上限。 */
function readInspectLimit(input: ElementorToolInput): number {
  const value = input.limit ?? 20;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error("limit must be an integer between 1 and 100.");
  }
  return value;
}

/** 读取并校验 edit 操作数组。 */
async function readEditOperations(
  input: ElementorToolInput,
  maxDataBytes: number
): Promise<ElementorEditOperation[]> {
  if (input.operations !== undefined && input.operationsFile !== undefined) {
    throw new Error("Provide either operations or operationsFile, not both.");
  }
  const rawOperations = input.operationsFile === undefined
    ? input.operations
    : await readBoundedJsonFile(readRequiredString(input, "operationsFile"), {
      maxBytes: calculateEnvelopeLimit(maxDataBytes),
      label: "Elementor operations file"
    });
  if (!Array.isArray(rawOperations) || rawOperations.length === 0) {
    throw new Error("operations must be a non-empty array.");
  }
  if (rawOperations.length > MAX_ELEMENTOR_EDIT_OPERATIONS) {
    throw new Error(`operations cannot contain more than ${MAX_ELEMENTOR_EDIT_OPERATIONS} items.`);
  }
  assertBoundedJsonValue(rawOperations, "Elementor edit operations", maxDataBytes);

  return rawOperations.map((rawOperation, index) => {
    if (!isRecord(rawOperation) || typeof rawOperation.op !== "string") {
      throw new Error(`operations[${index}] must be an object with an op string.`);
    }
    const elementId = rawOperation.elementId;
    if (rawOperation.op !== "insert_child" && (typeof elementId !== "string" || elementId.length === 0)) {
      throw new Error(`operations[${index}].elementId must be a non-empty string.`);
    }
    /** 读取当前操作的可选父元素 ID。 */
    const readParentElementId = (): string | undefined => {
      const parentElementId = rawOperation.parentElementId;
      if (parentElementId !== undefined && (typeof parentElementId !== "string" || parentElementId.length === 0)) {
        throw new Error(`operations[${index}].parentElementId must be a non-empty string when provided.`);
      }
      return parentElementId as string | undefined;
    };
    /** 读取当前操作的可选插入位置。 */
    const readIndex = (): number | undefined => {
      const operationIndex = rawOperation.index;
      if (operationIndex !== undefined && (
        typeof operationIndex !== "number"
        || !Number.isSafeInteger(operationIndex)
        || operationIndex < 0
      )) {
        throw new Error(`operations[${index}].index must be a non-negative safe integer when provided.`);
      }
      return operationIndex as number | undefined;
    };

    switch (rawOperation.op) {
      case "update_settings": {
        if (!isRecord(rawOperation.settings)) {
          throw new Error(`operations[${index}].settings must be an object.`);
        }
        const removeSettings = rawOperation.removeSettings;
        if (removeSettings !== undefined && (
          !Array.isArray(removeSettings)
          || removeSettings.some((key) => typeof key !== "string" || key.length === 0)
        )) {
          throw new Error(`operations[${index}].removeSettings must contain non-empty strings.`);
        }
        if (Object.keys(rawOperation.settings).length === 0 && (removeSettings?.length ?? 0) === 0) {
          throw new Error(`operations[${index}] must update or remove at least one setting.`);
        }
        return {
          op: rawOperation.op,
          elementId: elementId as string,
          settings: rawOperation.settings,
          removeSettings: removeSettings as string[] | undefined
        };
      }
      case "replace_element":
        if (!isRecord(rawOperation.element)) {
          throw new Error(`operations[${index}].element must be an object.`);
        }
        return { op: rawOperation.op, elementId: elementId as string, element: rawOperation.element as unknown as ElementorElement };
      case "insert_child":
        if (!isRecord(rawOperation.element)) {
          throw new Error(`operations[${index}].element must be an object.`);
        }
        return {
          op: rawOperation.op,
          parentElementId: readParentElementId(),
          index: readIndex(),
          element: rawOperation.element as unknown as ElementorElement
        };
      case "remove_element":
        return { op: rawOperation.op, elementId: elementId as string };
      case "move_element":
        return {
          op: rawOperation.op,
          elementId: elementId as string,
          parentElementId: readParentElementId(),
          index: readIndex()
        };
      default:
        throw new Error(`operations[${index}].op is not supported: ${rawOperation.op}`);
    }
  });
}

/** 把元素插入根数组或指定父元素的 children 数组。 */
function insertElement(
  tree: ElementorElement[],
  element: ElementorElement,
  parentElementId: string | undefined,
  index: number | undefined
): void {
  const target = parentElementId === undefined
    ? tree
    : findElementLocation(tree, parentElementId).element.elements;
  const insertionIndex = index ?? target.length;
  if (insertionIndex > target.length) {
    throw new Error(`Elementor insertion index ${insertionIndex} exceeds target length ${target.length}.`);
  }
  target.splice(insertionIndex, 0, element);
}

/** 按顺序把领域化 edit 操作应用到内存中的 Elementor 树。 */
function applyEditOperations(
  tree: ElementorElement[],
  operations: ElementorEditOperation[]
): ElementorAppliedEdit[] {
  return operations.map((operation, index) => {
    switch (operation.op) {
      case "update_settings": {
        const location = findElementLocation(tree, operation.elementId);
        const settings = isRecord(location.element.settings) ? { ...location.element.settings } : {};
        Object.assign(settings, structuredClone(operation.settings));
        for (const key of operation.removeSettings ?? []) {
          delete settings[key];
        }
        location.element.settings = settings;
        return { index, op: operation.op, element_id: operation.elementId };
      }
      case "replace_element": {
        if (operation.element.id !== operation.elementId) {
          throw new Error(`Replacement element ID must remain ${operation.elementId}.`);
        }
        const location = findElementLocation(tree, operation.elementId);
        location.siblings[location.index] = structuredClone(operation.element);
        return { index, op: operation.op, element_id: operation.elementId };
      }
      case "insert_child": {
        const element = structuredClone(operation.element);
        insertElement(tree, element, operation.parentElementId, operation.index);
        return { index, op: operation.op, element_id: element.id };
      }
      case "remove_element": {
        const location = findElementLocation(tree, operation.elementId);
        location.siblings.splice(location.index, 1);
        return { index, op: operation.op, element_id: operation.elementId };
      }
      case "move_element": {
        const location = findElementLocation(tree, operation.elementId);
        if (
          operation.parentElementId !== undefined
          && subtreeContainsElementId(location.element, operation.parentElementId)
        ) {
          throw new Error(`Cannot move Elementor element ${operation.elementId} into its own subtree.`);
        }
        const [element] = location.siblings.splice(location.index, 1);
        insertElement(tree, element, operation.parentElementId, operation.index);
        return { index, op: operation.op, element_id: operation.elementId };
      }
    }
  });
}

/** 使用 edit 上下文读取并校验远端 Elementor 元素树。 */
async function readElementorTree(
  client: WordPressClient,
  postId: number,
  maxDataBytes: number
): Promise<ValidatedElementorTree> {
  const result = await client.request<unknown>(`${ELEMENTOR_PAGE_ROUTE}/${postId}`, {
    query: { context: "edit", _fields: "id,meta._elementor_data" },
    maxResponseBytes: calculateEnvelopeLimit(maxDataBytes)
  });
  return validateElementorTree(readElementorDataFromEntity(result.data), maxDataBytes);
}

/** 把完整 Elementor 元素树写回固定 pages route，并校验保存响应。 */
async function saveElementorTree(
  client: WordPressClient,
  postId: number,
  data: ElementorElement[],
  maxDataBytes: number
): Promise<string> {
  const requestedRevision = createElementorRevision(data);
  const result = await client.request<unknown>(`${ELEMENTOR_PAGE_ROUTE}/${postId}`, {
    method: "POST",
    query: { context: "edit", _fields: "id,meta._elementor_data" },
    body: buildElementorMeta(data, { templateType: "wp-page" }),
    maxResponseBytes: calculateEnvelopeLimit(maxDataBytes)
  });
  const savedData = validateElementorTree(readElementorDataFromEntity(result.data), maxDataBytes).data;
  const persistedRevision = createElementorRevision(savedData);
  if (persistedRevision !== requestedRevision) {
    throw new Error("WordPress did not persist the requested Elementor page data.");
  }
  return persistedRevision;
}

/** 在页面数据成功落盘后清理 Elementor 全站缓存。 */
async function refreshElementorCacheAfterSave(client: WordPressClient): Promise<void> {
  try {
    await client.requestApiPath(ELEMENTOR_CACHE_API_PATH, { method: "DELETE" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Elementor page data was saved, but cache refresh failed: ${message}`);
  }
}

/** 构造新的版本化 Elementor 本地文件。 */
function createElementorDataFile(
  client: WordPressClient,
  postId: number,
  revision: string,
  data: ElementorElement[]
): ElementorDataFile {
  return {
    format: ELEMENTOR_FILE_FORMAT,
    version: ELEMENTOR_FILE_VERSION,
    source: {
      site_url: client.baseUrl,
      post_id: postId,
      revision
    },
    data
  };
}

/** 将本地文件写入结果转换为 MCP 统一文件摘要字段。 */
function toFileSummary(file: AtomicJsonFileResult): Pick<ElementorPullPayload, "file_path" | "file_bytes" | "file_sha256"> {
  return {
    file_path: file.filePath,
    file_bytes: file.bytes,
    file_sha256: file.sha256
  };
}

/** 拉取完整 Elementor data 并原子保存为可编辑本地文件。 */
export async function pullElementorPage(
  client: WordPressClient,
  input: ElementorToolInput,
  options: ElementorWorkflowOptions = {}
): Promise<ElementorPullPayload> {
  const postId = readPostId(input);
  const overwrite = readOptionalBoolean(input, "overwrite", false);
  const maxDataBytes = normalizeMaxDataBytes(options.maxDataBytes);
  const tree = await readElementorTree(client, postId, maxDataBytes);
  const revision = createElementorRevision(tree.data);
  const outputFile = readOptionalString(input, "outputFile") ?? resolve(
    options.resultDirectory ?? resolve(process.cwd(), ".wp-api-results"),
    `wp_elementor_pull-${postId}-${Date.now()}-${randomUUID()}.json`
  );
  const file = await writeJsonFileAtomically({
    outputFile,
    value: createElementorDataFile(client, postId, revision, tree.data),
    overwrite,
    label: "Elementor pull"
  });
  return {
    pulled: true,
    ...toFileSummary(file),
    site_url: client.baseUrl,
    post_id: postId,
    elements_count: tree.elementsCount,
    data_bytes: tree.dataBytes,
    revision
  };
}

/** 检查本地 Elementor 文件，并按 JSON Pointer 或元素条件返回有界结果。 */
export async function inspectElementorPage(
  input: ElementorToolInput,
  options: ElementorWorkflowOptions = {}
): Promise<ElementorInspectPayload> {
  assertLocalElementorInput(input, "wp_elementor_inspect");
  const dataFile = readRequiredString(input, "dataFile");
  const maxDataBytes = normalizeMaxDataBytes(options.maxDataBytes);
  const loaded = await loadElementorDataFile(dataFile, maxDataBytes);
  const jsonPointer = readOptionalString(input, "jsonPointer");
  const elementId = readOptionalString(input, "elementId");
  const widgetType = readOptionalString(input, "widgetType");
  const searchText = readOptionalString(input, "searchText");
  const includeSubtree = readOptionalBoolean(input, "includeSubtree", false);
  const hasElementFilter = elementId !== undefined || widgetType !== undefined || searchText !== undefined;
  if (jsonPointer !== undefined && hasElementFilter) {
    throw new Error("jsonPointer cannot be combined with elementId, widgetType, or searchText.");
  }
  if (includeSubtree && elementId === undefined) {
    throw new Error("includeSubtree requires an exact elementId filter.");
  }

  const base: ElementorInspectPayload = {
    inspected: true,
    file_path: resolve(dataFile),
    file_bytes: loaded.file.bytes,
    file_sha256: loaded.file.sha256,
    site_url: loaded.envelope.source.site_url,
    post_id: loaded.envelope.source.post_id,
    baseline_revision: loaded.envelope.source.revision,
    data_revision: createElementorRevision(loaded.envelope.data),
    elements_count: loaded.validated.elementsCount,
    data_bytes: loaded.validated.dataBytes
  };
  if (jsonPointer !== undefined) {
    return {
      ...base,
      pointer_result: {
        pointer: jsonPointer,
        value: resolveJsonPointer(loaded.envelope, jsonPointer)
      }
    };
  }
  if (!hasElementFilter) {
    return base;
  }

  const normalizedSearch = searchText?.toLowerCase();
  const locations = collectElementLocations(loaded.envelope.data).filter((location) => {
    if (elementId !== undefined && location.element.id !== elementId) {
      return false;
    }
    if (widgetType !== undefined && location.element.widgetType !== widgetType) {
      return false;
    }
    if (normalizedSearch !== undefined) {
      const searchableElement = Object.fromEntries(
        Object.entries(location.element).filter(([key]) => key !== "elements")
      );
      if (!JSON.stringify(searchableElement).toLowerCase().includes(normalizedSearch)) {
        return false;
      }
    }
    return true;
  });
  const limit = readInspectLimit(input);
  const matches = locations.slice(0, limit).map((location): ElementorInspectMatch => {
    const element = includeSubtree
      ? structuredClone(location.element) as unknown as Record<string, unknown>
      : Object.fromEntries(Object.entries(location.element).filter(([key]) => key !== "elements"));
    return {
      element_id: location.element.id,
      element_type: location.element.elType,
      ...(location.element.widgetType !== undefined ? { widget_type: location.element.widgetType } : {}),
      pointer: location.pointer,
      parent_id: location.parent?.id ?? null,
      children_count: location.element.elements.length,
      element
    };
  });
  return {
    ...base,
    matches,
    total_matches: locations.length,
    truncated: locations.length > matches.length
  };
}

/** 使用领域化操作原子修改本地 Elementor 文件，不接触远端 WordPress。 */
export async function editElementorPage(
  input: ElementorToolInput,
  options: ElementorWorkflowOptions = {}
): Promise<ElementorEditPayload> {
  assertLocalElementorInput(input, "wp_elementor_edit");
  const dataFile = readRequiredString(input, "dataFile");
  const expectedFileSha256 = readRequiredString(input, "expectedFileSha256");
  if (!/^[a-f0-9]{64}$/.test(expectedFileSha256)) {
    throw new Error("expectedFileSha256 must be a lowercase SHA-256 value.");
  }
  const maxDataBytes = normalizeMaxDataBytes(options.maxDataBytes);
  const loaded = await loadElementorDataFile(dataFile, maxDataBytes);
  if (loaded.file.sha256 !== expectedFileSha256) {
    throw new Error("Elementor data file changed after it was inspected. Inspect it again before editing.");
  }
  const operations = await readEditOperations(input, maxDataBytes);
  const dataRevisionBefore = createElementorRevision(loaded.envelope.data);
  const editableData = structuredClone(loaded.envelope.data);
  const applied = applyEditOperations(editableData, operations);
  const validated = validateElementorTree(editableData, maxDataBytes);
  loaded.envelope.data = validated.data;
  const dataRevisionAfter = createElementorRevision(validated.data);
  const file = await writeJsonFileAtomically({
    outputFile: dataFile,
    value: loaded.envelope,
    overwrite: true,
    label: "Elementor data",
    expectedExistingSha256: loaded.file.sha256
  });
  return {
    edited: true,
    file_path: file.filePath,
    file_sha256_before: loaded.file.sha256,
    file_sha256_after: file.sha256,
    file_bytes: file.bytes,
    data_revision_before: dataRevisionBefore,
    data_revision_after: dataRevisionAfter,
    elements_count: validated.elementsCount,
    data_bytes: validated.dataBytes,
    operations: applied
  };
}

/** 从本地 Elementor 文件上传完整 data，并在成功后原子更新文件基线。 */
export async function pushElementorPage(
  client: WordPressClient,
  input: ElementorToolInput,
  options: ElementorWorkflowOptions = {}
): Promise<ElementorPushPayload> {
  const dataFile = readRequiredString(input, "dataFile");
  const maxDataBytes = normalizeMaxDataBytes(options.maxDataBytes);
  const loaded = await loadElementorDataFile(dataFile, maxDataBytes);
  const envelope = loaded.envelope;
  if (envelope.source.site_url !== client.baseUrl) {
    throw new Error(
      `Elementor data file belongs to ${envelope.source.site_url}, not the selected site ${client.baseUrl}.`
    );
  }

  const validated = validateElementorTree(envelope.data, maxDataBytes);
  const desiredRevision = createElementorRevision(validated.data);
  const current = await readElementorTree(client, envelope.source.post_id, maxDataBytes);
  const currentRevision = createElementorRevision(current.data);
  let remoteUpdated = false;
  let cacheRefreshed = false;

  if (currentRevision !== desiredRevision) {
    if (currentRevision !== envelope.source.revision) {
      throw new Error("Elementor page changed after it was pulled. Pull the page again before pushing local data.");
    }
    await saveElementorTree(client, envelope.source.post_id, validated.data, maxDataBytes);
    remoteUpdated = true;
    await refreshElementorCacheAfterSave(client);
    cacheRefreshed = true;
  } else if (envelope.source.revision !== desiredRevision) {
    await refreshElementorCacheAfterSave(client);
    cacheRefreshed = true;
  }

  envelope.source.revision = desiredRevision;
  const file = await writeJsonFileAtomically({
    outputFile: dataFile,
    value: envelope,
    overwrite: true,
    label: "Elementor data",
    expectedExistingSha256: loaded.file.sha256
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Elementor page data was saved, but the local revision update failed: ${message}`);
  });

  return {
    pushed: true,
    remote_updated: remoteUpdated,
    cache_refreshed: cacheRefreshed,
    ...toFileSummary(file),
    site_url: client.baseUrl,
    post_id: envelope.source.post_id,
    elements_count: validated.elementsCount,
    data_bytes: validated.dataBytes,
    revision_before: currentRevision,
    revision_after: desiredRevision,
    match: true
  };
}

/** 将两个 Elementor MCP 工具名称分派到本地文件工作流 handler。 */
export async function executeElementorTool(
  toolName: ElementorToolName,
  client: WordPressClient | undefined,
  input: ElementorToolInput,
  options: ElementorWorkflowOptions = {}
): Promise<ElementorToolPayload> {
  switch (toolName) {
    case "wp_elementor_pull":
      return pullElementorPage(requireElementorClient(client, toolName), input, options);
    case "wp_elementor_inspect":
      return inspectElementorPage(input, options);
    case "wp_elementor_edit":
      return editElementorPage(input, options);
    case "wp_elementor_push":
      return pushElementorPage(requireElementorClient(client, toolName), input, options);
    default: {
      const exhaustiveCheck: never = toolName;
      throw new Error(`Unknown Elementor MCP tool: ${String(exhaustiveCheck)}`);
    }
  }
}
