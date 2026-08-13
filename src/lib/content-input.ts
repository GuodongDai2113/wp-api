import { open } from "node:fs/promises";

/** 正文文件和已解析正文默认允许占用的最大 UTF-8 字节数。 */
const DEFAULT_MAX_CONTENT_BYTES = 25 * 1024 * 1024;

/** 解析 MCP 正文输入时允许传入的来源。 */
export interface ContentInputOptions {
  /** 通过 MCP 工具直接传入的正文内容。 */
  content?: string;
  /** 保存正文内容的本地文件路径。 */
  contentFile?: string;
  /** 正文允许占用的最大 UTF-8 字节数，默认 25 MiB。 */
  maxBytes?: number;
}

/** 校验正文大小上限必须是正安全整数。 */
function normalizeMaxContentBytes(maxBytes: number | undefined): number {
  const normalized = maxBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError("Content maxBytes must be a positive safe integer.");
  }
  return normalized;
}

/** 校验内存中的正文没有超过配置的 UTF-8 字节上限。 */
function assertContentWithinLimit(content: string, maxBytes: number, source: string): void {
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new Error(`${source} exceeds the maximum allowed size of ${maxBytes} bytes.`);
  }
}

/** 以有界分块方式读取正文文件，避免文件变化时一次性分配过大内存。 */
async function readContentFileWithinLimit(contentFile: string, maxBytes: number): Promise<string> {
  const fileHandle = await open(contentFile, "r");
  try {
    const fileStats = await fileHandle.stat();
    if (!fileStats.isFile()) {
      throw new Error(`Content file path must point to a regular file: ${contentFile}`);
    }
    if (fileStats.size > maxBytes) {
      throw new Error(`Content file exceeds the maximum allowed size of ${maxBytes} bytes.`);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithOverflowByte = maxBytes - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remainingWithOverflowByte));
      const { bytesRead } = await fileHandle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) {
        return Buffer.concat(chunks, totalBytes).toString("utf8");
      }
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new Error(`Content file exceeds the maximum allowed size of ${maxBytes} bytes.`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await fileHandle.close();
  }
}

/** 按照 MCP 内联正文优先于本地文件的顺序解析正文内容。 */
export async function resolveContentInput({
  content,
  contentFile,
  maxBytes
}: ContentInputOptions = {}): Promise<string | undefined> {
  const contentLimit = normalizeMaxContentBytes(maxBytes);
  if (typeof content === "string") {
    assertContentWithinLimit(content, contentLimit, "Inline content");
    return content;
  }

  if (contentFile) {
    return readContentFileWithinLimit(contentFile, contentLimit);
  }

  return undefined;
}
