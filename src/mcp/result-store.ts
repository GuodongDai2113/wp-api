import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, unlink, open } from "node:fs/promises";
import { resolve } from "node:path";
import { readBoundedJsonFileWithMetadata } from "../shared/files/json.js";
import { projectResource, resolveProjection } from "./shared/projection.js";

/** 当前服务器会话的托管结果存储配置；不管理用户导出及 Elementor 工作文件。 */
export interface ResultStoreOptions {
  /** 通用结果根目录，实际托管文件位于 managed-results 子目录。 */
  resultDirectory?: string;
  /** 结果有效期，默认一小时，过期文件在后续读写时惰性清理。 */
  resultTtlMs?: number;
  /** 当前会话托管文件容量上限，默认 128 MiB；不包含前次进程遗留文件。 */
  resultMaxBytes?: number;
}

/** 注册表中的结果文件引用；只有本会话生成的 ID 才可读取。 */
export interface StoredResult {
  /** 表示结果已经写入本地受管文件。 */
  stored: true;
  /** 本会话生成的不可推测结果 ID，不接受文件路径。 */
  resultId: string;
  /** 供宿主兼容读取使用的绝对文件路径。 */
  file_path: string;
  /** UTF-8 文件大小。 */
  bytes: number;
  /** 文件内容哈希，读取前验证，防止被替换成其他文件。 */
  sha256: string;
  /** 固定 JSON 媒体类型。 */
  media_type: "application/json";
  /** 结果过期的 UTC 时间戳。 */
  expiresAt: string;
}

/** 有界结果读取参数，不允许指定本地路径。 */
export interface ResultReadInput {
  /** 当前服务器生成的结果 ID。 */
  resultId: string;
  /** RFC 6901 指针，默认根；只读取对象自身属性，不访问原型链。 */
  jsonPointer?: string;
  /** 对象或数组元素的精确字段集合，不提供时对象默认只列字段名。 */
  fields?: string[];
  /** 数组或对象键索引的零基起点，默认 0。 */
  offset?: number;
  /** 最多返回的元素或键数，默认 20，上限 100。 */
  limit?: number;
}

/** 单次读取返回体的紧凑 JSON 预算，为双份兼容输出及信封留足空间。 */
const READ_BUDGET = 1800;

/** 校验配置与输入使用的正安全整数。 */
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

/** 有界读取与容量清理共用串行锁，避免读写/清理竞争。 */
export class ManagedResultStore {
  /** 当前会话签发的文件注册表，其他会话或路径不可通过读取入口访问。 */
  private readonly entries = new Map<string, StoredResult>();
  /** 固定的专用目录，不扫描或清理用户文件。 */
  private readonly directory: string;
  /** 第一次创建目录后的规范路径，用于检测后续符号链接替换。 */
  private realDirectory?: string;
  /** 当前会话文件容量上限。 */
  private readonly maxBytes: number;
  /** 结果有效期，单位毫秒。 */
  private readonly ttlMs: number;
  /** 串行操作队列，失败不阻断后续操作。 */
  private queue: Promise<unknown> = Promise.resolve();

  /** 初始化会话级配置；不在构造时创建或清理文件。 */
  constructor(options: ResultStoreOptions = {}) {
    this.directory = resolve(options.resultDirectory ?? ".wp-api-results", "managed-results");
    this.maxBytes = positive(options.resultMaxBytes ?? 128 * 1024 * 1024, "resultMaxBytes");
    this.ttlMs = positive(options.resultTtlMs ?? 3600000, "resultTtlMs");
    if (this.ttlMs > 365 * 86400000) throw new Error("resultTtlMs must not exceed one year.");
  }

  /** 在同一会话内串行执行文件操作，始终释放队列。 */
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** 创建并核查专用目录，拒绝符号链接或运行时目录重定向。 */
  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error("result_directory_changed");
    const actual = await realpath(this.directory);
    if (this.realDirectory && actual !== this.realDirectory) throw new Error("result_directory_changed");
    this.realDirectory = actual;
  }

  /** 仅删除本会话注册的单个文件，不递归删除目录、不触碰用户导出。 */
  private async remove(entry: StoredResult): Promise<void> {
    try { await unlink(entry.file_path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.entries.delete(entry.resultId);
  }

  /** 惰性清理过期记录，并按创建顺序淘汰旧结果以满足会话容量上限。 */
  private async cleanup(incomingBytes = 0): Promise<void> {
    for (const entry of this.entries.values()) {
      if (Date.parse(entry.expiresAt) <= Date.now()) await this.remove(entry);
    }
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of this.entries.values()) {
      if (bytes + incomingBytes <= this.maxBytes) break;
      await this.remove(entry);
      bytes -= entry.bytes;
    }
  }

  /** 排他写入并登记结果，单文件最多 25 MiB；写入失败不得返回可用引用。 */
  put(json: string): Promise<StoredResult> {
    return this.serialized(async () => {
      const contents = `${json}\n`;
      const bytes = Buffer.byteLength(contents);
      if (bytes > Math.min(this.maxBytes, 25 * 1024 * 1024)) throw new Error("result_too_large");
      await this.ensureDirectory();
      await this.cleanup(bytes);
      const resultId = randomUUID();
      const file_path = resolve(this.directory, `${resultId}.json`);
      const file = await open(file_path, "wx", 0o600);
      try { await file.writeFile(contents, "utf8"); await file.close(); } catch (error) {
        await file.close().catch(() => undefined);
        await unlink(file_path).catch(() => undefined);
        throw error;
      }
      const entry: StoredResult = { stored: true, resultId, file_path, bytes, sha256: createHash("sha256").update(contents).digest("hex"),
        media_type: "application/json", expiresAt: new Date(Date.now() + this.ttlMs).toISOString() };
      this.entries.set(resultId, entry);
      return entry;
    });
  }

  /** 验证签发 ID、生命周期、文件边界与哈希后，返回有界字段或分页切片。 */
  read(input: ResultReadInput): Promise<Record<string, unknown>> {
    return this.serialized(async () => {
      if (typeof input.resultId !== "string" || !/^[a-f0-9-]{36}$/.test(input.resultId)) throw new Error("invalid_result_id");
      const entry = this.entries.get(input.resultId);
      if (!entry) throw new Error("result_unavailable: expired, evicted, or from another server session.");
      await this.ensureDirectory();
      if (Date.parse(entry.expiresAt) <= Date.now()) {
        await this.remove(entry);
        throw new Error("result_expired: repeat the read-only source query if needed; do not repeat writes.");
      }
      await this.cleanup();
      try {
        if ((await lstat(entry.file_path)).isSymbolicLink() || await realpath(entry.file_path) !== resolve(this.realDirectory!, `${entry.resultId}.json`)) throw new Error("changed");
        const file = await readBoundedJsonFileWithMetadata(entry.file_path, { maxBytes: entry.bytes });
        if (file.sha256 !== entry.sha256 || file.bytes !== entry.bytes) throw new Error("changed");
        return selectResult(file.value, input);
      } catch (error) {
        if (error instanceof ResultSelectionError) throw error;
        throw new Error("result_file_unavailable: missing, changed, or unreadable; do not repeat writes.");
      }
    });
  }
}

/** 区分合法文件的选择参数错误与文件交付错误，避免提示调用方重复读取上游。 */
class ResultSelectionError extends Error {}

/** 对已验证文件实施 RFC 6901 导航与有界分页，不截断字符串、JSON、ID 或 URL。 */
function selectResult(root: unknown, input: ResultReadInput): Record<string, unknown> {
  const pointer = input.jsonPointer ?? "";
  if (typeof pointer !== "string" || Buffer.byteLength(pointer) > 512 || (pointer !== "" && !pointer.startsWith("/")) || /~(?![01])/.test(pointer)) throw new ResultSelectionError("invalid_json_pointer");
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ResultSelectionError("invalid_result_range");
  let fields: string[] | undefined;
  try { fields = resolveProjection({ fields: input.fields }, [], "full"); } catch { throw new ResultSelectionError("invalid_result_fields"); }
  let value = root;
  for (const token of pointer === "" ? [] : pointer.slice(1).split("/")) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)
      || ["__proto__", "prototype", "constructor"].includes(key)
      || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))) throw new ResultSelectionError("result_pointer_not_found");
    value = (value as Record<string, unknown>)[key];
  }
  const base = { resultId: input.resultId, jsonPointer: pointer };
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const objectIndex = kind === "object" && !fields;
  if (Array.isArray(value) || objectIndex) {
    const source = Array.isArray(value) ? value : Object.keys(value as object);
    if (offset > source.length) throw new ResultSelectionError("result_offset_out_of_bounds");
    const items: unknown[] = [];
    let next = offset;
    for (; next < Math.min(source.length, offset + limit); next++) {
      const item = source[next];
      const selected = fields && typeof item === "object" && item !== null && !Array.isArray(item) ? projectResource(item as Record<string, unknown>, fields) : item;
      const candidate = { ...base, kind, ...(objectIndex ? { keys: [...items, selected] } : { items: [...items, selected] }), total: source.length,
        offset, returned: items.length + 1, nextOffset: next + 1 < source.length ? next + 1 : null, omitted: next + 1 < source.length };
      if (Buffer.byteLength(JSON.stringify(candidate)) > READ_BUDGET) break;
      items.push(selected);
    }
    const omitted = next < source.length;
    return { ...base, kind, ...((items.length || !omitted) ? objectIndex ? { keys: items } : { items } : {}), total: source.length, offset, returned: items.length,
      nextOffset: omitted ? next : null, omitted,
      ...(omitted && !items.length ? { hint: "Select narrower fields or a deeper jsonPointer; no elements were skipped." } : {}) };
  }
  if (input.offset !== undefined || input.limit !== undefined) throw new ResultSelectionError("result_range_requires_array_or_object_index");
  if (fields && kind !== "object") throw new ResultSelectionError("result_fields_require_object");
  const data = fields ? projectResource(value as Record<string, unknown>, fields) : value;
  const result = { ...base, kind, data, omitted: false };
  return Buffer.byteLength(JSON.stringify(result)) <= READ_BUDGET ? result
    : { ...base, kind, omitted: true, hint: "Selection exceeds the byte budget. Select narrower fields or a deeper jsonPointer; use the file reference for a large scalar." };
}

/** 按上下文对象持有当前会话的注册表，不在每次工具调用时重新创建。 */
const stores = new WeakMap<ResultStoreOptions, ManagedResultStore>();

/** 获取会话级受管存储，配置只在第一次使用时读取。 */
export function getResultStore(context: ResultStoreOptions): ManagedResultStore {
  let store = stores.get(context);
  if (!store) { store = new ManagedResultStore(context); stores.set(context, store); }
  return store;
}
