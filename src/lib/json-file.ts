import { open } from "node:fs/promises";

/** 通用 MCP JSON 输入文件默认允许占用的最大字节数。 */
const DEFAULT_MAX_JSON_FILE_BYTES = 10 * 1024 * 1024;

/** 有界 JSON 文件读取选项。 */
export interface ReadBoundedJsonFileOptions {
  /** JSON 文件允许占用的最大字节数，默认 10 MiB。 */
  maxBytes?: number;
  /** 错误消息中标识当前文件用途的名称。 */
  label?: string;
}

/** 校验 JSON 文件大小上限是正安全整数。 */
function normalizeMaxJsonFileBytes(maxBytes: number | undefined): number {
  const normalized = maxBytes ?? DEFAULT_MAX_JSON_FILE_BYTES;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError("JSON file maxBytes must be a positive safe integer.");
  }
  return normalized;
}

/**
 * 以有界分块方式读取并解析本地 JSON 文件。
 * 调用方仍需根据领域规则校验解析结果的对象、数组及字段形状。
 */
export async function readBoundedJsonFile(
  filePath: string,
  options: ReadBoundedJsonFileOptions = {}
): Promise<unknown> {
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
      return JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} does not contain valid JSON: ${message}`);
    }
  } finally {
    await fileHandle.close();
  }
}
