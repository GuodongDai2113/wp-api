import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { assertExportTargetAbsent, publishFileExclusive } from "./csv.js";

/** 通用 MCP JSON 输入文件默认允许占用的最大字节数。 */
const DEFAULT_MAX_JSON_FILE_BYTES = 10 * 1024 * 1024;

/** 有界 JSON 文件读取选项。 */
export interface ReadBoundedJsonFileOptions {
  /** JSON 文件允许占用的最大字节数，默认 10 MiB。 */
  maxBytes?: number;
  /** 错误消息中标识当前文件用途的名称。 */
  label?: string;
}

/** 原子 JSON 文件写入选项。 */
export interface WriteJsonFileAtomicallyOptions {
  /** 最终输出文件路径。 */
  outputFile: string;
  /** 要序列化的 JSON 兼容值。 */
  value: unknown;
  /** 是否允许原子替换已有目标文件。 */
  overwrite?: boolean;
  /** 错误消息中标识当前文件用途的名称。 */
  label?: string;
  /** 原子替换前要求目标文件仍具有的 SHA-256，用于防止覆盖并发本地修改。 */
  expectedExistingSha256?: string;
}

/** 原子 JSON 文件写入结果。 */
export interface AtomicJsonFileResult {
  /** 已发布文件的绝对路径。 */
  filePath: string;
  /** 已发布文件的 UTF-8 字节数。 */
  bytes: number;
  /** 已发布文件内容的 SHA-256。 */
  sha256: string;
}

/** 有界 JSON 文件读取结果及原始文件摘要。 */
export interface BoundedJsonFileResult {
  /** 解析后的 JSON 值。 */
  value: unknown;
  /** 实际读取的文件字节数。 */
  bytes: number;
  /** 原始文件字节内容的 SHA-256。 */
  sha256: string;
}

/** 校验 JSON 文件大小上限是正安全整数。 */
function normalizeMaxJsonFileBytes(maxBytes: number | undefined): number {
  const normalized = maxBytes ?? DEFAULT_MAX_JSON_FILE_BYTES;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError("JSON file maxBytes must be a positive safe integer.");
  }
  return normalized;
}

/** 以分块方式计算普通文件的 SHA-256。 */
async function calculateFileSha256(filePath: string, label: string): Promise<string> {
  const file = await open(filePath, "r");
  const hash = createHash("sha256");
  try {
    const fileStats = await file.stat();
    if (!fileStats.isFile()) {
      throw new Error(`${label} path must point to a regular file: ${filePath}`);
    }
    while (true) {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const { bytesRead } = await file.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) {
        return hash.digest("hex");
      }
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
}

/**
 * 以有界分块方式读取并解析本地 JSON 文件。
 * 调用方仍需根据领域规则校验解析结果的对象、数组及字段形状。
 */
export async function readBoundedJsonFile(
  filePath: string,
  options: ReadBoundedJsonFileOptions = {}
): Promise<unknown> {
  return (await readBoundedJsonFileWithMetadata(filePath, options)).value;
}

/**
 * 以有界分块方式读取并解析本地 JSON 文件，同时返回原始文件摘要。
 * SHA-256 针对文件的原始字节计算，可用于本地并发修改保护。
 */
export async function readBoundedJsonFileWithMetadata(
  filePath: string,
  options: ReadBoundedJsonFileOptions = {}
): Promise<BoundedJsonFileResult> {
  const maxBytes = normalizeMaxJsonFileBytes(options.maxBytes);
  const label = options.label?.trim() || "JSON file";
  const fileHandle = await open(filePath, "r");
  try {
    const fileStats = await fileHandle.stat();
    if (!fileStats.isFile()) {
      throw new Error(`${label} path must point to a regular file: ${filePath}`);
    }
    if (fileStats.size > maxBytes) {
      throw new Error(`${label} exceeds the maximum allowed size of ${maxBytes} bytes.`);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithOverflowByte = maxBytes - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remainingWithOverflowByte));
      const { bytesRead } = await fileHandle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new Error(`${label} exceeds the maximum allowed size of ${maxBytes} bytes.`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }

    try {
      const contents = Buffer.concat(chunks, totalBytes);
      return {
        value: JSON.parse(contents.toString("utf8")) as unknown,
        bytes: totalBytes,
        sha256: createHash("sha256").update(contents).digest("hex")
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} does not contain valid JSON: ${message}`);
    }
  } finally {
    await fileHandle.close();
  }
}

/**
 * 使用同目录临时文件原子写入两空格缩进的 UTF-8 JSON。
 * 默认以排他方式发布，只有明确设置 overwrite 时才替换已有文件。
 */
export async function writeJsonFileAtomically({
  outputFile,
  value,
  overwrite = false,
  label = "JSON",
  expectedExistingSha256
}: WriteJsonFileAtomicallyOptions): Promise<AtomicJsonFileResult> {
  const resolvedOutputFile = resolve(outputFile);
  await mkdir(dirname(resolvedOutputFile), { recursive: true });
  if (!overwrite) {
    await assertExportTargetAbsent(resolvedOutputFile, label);
  }
  if (expectedExistingSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedExistingSha256)) {
    throw new TypeError(`${label} expectedExistingSha256 must be a lowercase SHA-256 value.`);
  }
  const temporaryFile = resolve(
    dirname(resolvedOutputFile),
    `.${basename(resolvedOutputFile)}.${randomUUID()}.tmp`
  );
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error(`${label} value cannot be serialized as JSON.`);
  }
  const contents = `${serialized}\n`;

  try {
    const file = await open(temporaryFile, "wx");
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    if (overwrite) {
      if (
        expectedExistingSha256 !== undefined
        && await calculateFileSha256(resolvedOutputFile, label) !== expectedExistingSha256
      ) {
        throw new Error(`${label} file changed before atomic replacement: ${resolvedOutputFile}`);
      }
      await rename(temporaryFile, resolvedOutputFile);
    } else {
      await publishFileExclusive(temporaryFile, resolvedOutputFile, label);
    }
    const fileStats = await stat(resolvedOutputFile);
    return {
      filePath: resolvedOutputFile,
      bytes: fileStats.size,
      sha256: createHash("sha256").update(contents).digest("hex")
    };
  } catch (error) {
    await rm(temporaryFile, { force: true }).catch(() => undefined);
    throw error;
  }
}
