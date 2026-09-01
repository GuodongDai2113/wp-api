import { constants } from "node:fs";
import { access, link, open, rm } from "node:fs/promises";

/** 动态分页读取所需的最小分页结构。 */
export interface DynamicPage<T> {
  /** 当前页包含的记录。 */
  items: T[];
  /** 当前请求观察到的分页信息。 */
  pagination: {
    /** 当前请求观察到的总页数。 */
    totalPages: number;
  };
}

/** 动态分页遍历选项。 */
export interface DynamicPageIterationOptions<T> {
  /** 已经获取的第一页，避免重复请求。 */
  firstPage: DynamicPage<T>;
  /** 按页码读取后续页面。 */
  loadPage: (page: number) => Promise<DynamicPage<T>>;
  /** 按顺序消费每个非空页面。 */
  consumePage: (items: T[], page: number) => Promise<void>;
  /** 判断异常是否表示数据缩减后请求页码已经超出范围。 */
  isTerminalPageError?: (error: unknown) => boolean;
}

/** 有界 CSV 文件读取选项。 */
export interface BoundedCsvReadOptions {
  /** 错误消息中使用的 CSV 类型名称。 */
  label: string;
  /** 允许读取的最大文件字节数。 */
  maxBytes: number;
}

/** 提前检查导出目标不存在，以避免在常见冲突场景下执行无用的远程查询。 */
export async function assertExportTargetAbsent(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`${label} output file already exists: ${filePath}`);
}

/** 通过同目录硬链接原子发布临时文件，确保竞态中也不会覆盖已有目标。 */
export async function publishFileExclusive(temporaryFile: string, outputFile: string, label: string): Promise<void> {
  try {
    await link(temporaryFile, outputFile);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "EEXIST") {
      throw new Error(`${label} output file already exists: ${outputFile}`);
    }
    throw error;
  }
  await rm(temporaryFile, { force: true });
}

/** 按每页最新分页头动态遍历，并在集合缩减造成页码越界时安全结束。 */
export async function forEachDynamicPage<T>({
  firstPage,
  loadPage,
  consumePage,
  isTerminalPageError
}: DynamicPageIterationOptions<T>): Promise<number> {
  let page = 1;
  let currentPage = firstPage;
  let pagesRead = 0;

  while (currentPage.items.length > 0) {
    await consumePage(currentPage.items, page);
    pagesRead = page;
    if (page >= currentPage.pagination.totalPages) {
      break;
    }
    page += 1;
    try {
      currentPage = await loadPage(page);
    } catch (error) {
      if (isTerminalPageError?.(error)) {
        break;
      }
      throw error;
    }
  }
  return pagesRead;
}

/** 将单个值编码为兼容逗号、引号和换行的标准 CSV 字段。 */
export function encodeCsvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** 解析完整 CSV 文本，支持 UTF-8 BOM、引号转义及字段内换行。 */
export function parseCsvRows(csvText: string, label = "CSV"): string[][] {
  const source = csvText.startsWith("\uFEFF") ? csvText.slice(1) : csvText;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new Error(`${label} contains characters after a closing quote.`);
    }
    if (character === '"') {
      if (field.length > 0 || afterQuote) {
        throw new Error(`${label} contains an unexpected quote.`);
      }
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (character === "\r" || character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      afterQuote = false;
      if (character === "\r" && source[index + 1] === "\n") {
        index += 1;
      }
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error(`${label} contains an unclosed quoted field.`);
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 读取不超过指定大小的常规 CSV 文件并返回 UTF-8 文本。 */
export async function readBoundedCsvFile(
  filePath: string,
  { label, maxBytes }: BoundedCsvReadOptions
): Promise<string> {
  const file = await open(filePath, "r");
  try {
    const fileStats = await file.stat();
    if (!fileStats.isFile()) {
      throw new Error(`${label} path must point to a regular file: ${filePath}`);
    }
    if (fileStats.size > maxBytes) {
      throw new Error(`${label} exceeds the maximum allowed size of ${maxBytes} bytes.`);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - totalBytes + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new Error(`${label} exceeds the maximum allowed size of ${maxBytes} bytes.`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } finally {
    await file.close();
  }
}
