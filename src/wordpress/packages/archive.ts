import { createWriteStream } from "node:fs";
import { lstat, mkdir, opendir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import archiver from "archiver";

/** WordPress 本地打包操作支持的软件包类型。 */
export type LocalPackageType = "plugin" | "theme";

/** 本地软件包目录默认允许包含的最大文件和目录条目数。 */
const DEFAULT_MAX_PACKAGE_ENTRIES = 20_000;

/** 本地软件包目录默认允许包含的最大未压缩文件字节数。 */
const DEFAULT_MAX_PACKAGE_SOURCE_BYTES = 512 * 1024 * 1024;

/** 创建本地 WordPress 软件包时使用的资源边界。 */
export interface PackageArchiveOptions {
  /** 允许遍历的最大文件和目录条目数，默认 20,000。 */
  maxEntries?: number;
  /** 允许读取的最大未压缩文件字节数，默认 512 MiB。 */
  maxSourceBytes?: number;
}

/** WordPress 本地打包操作返回的结构化结果。 */
export interface PackageArchiveResult {
  /** 已打包的软件包类型。 */
  packageType: LocalPackageType;
  /** 已解析为绝对路径的源文件夹。 */
  sourceDirectory: string;
  /** 已生成 ZIP 文件的绝对路径。 */
  outputFile: string;
  /** ZIP 文件的字节大小。 */
  size: number;
}

/** 判断目标路径是否位于源文件夹内部，避免把输出 ZIP 再次写入自身。 */
function isPathInside(sourceDirectory: string, targetPath: string): boolean {
  const pathFromSource = relative(sourceDirectory, targetPath);
  return pathFromSource !== "" && !pathFromSource.startsWith("..") && !isAbsolute(pathFromSource);
}

/** 校验打包资源上限必须是正安全整数。 */
function normalizePositiveLimit(value: number | undefined, fallback: number, optionName: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${optionName} must be a positive safe integer.`);
  }
  return normalized;
}

/**
 * 在压缩前遍历软件包目录，拒绝符号链接、特殊文件以及超出数量或大小边界的输入。
 * 预检也可避免误把 node_modules 等超大目录提交给高压缩级别任务。
 */
async function validatePackageSourceTree(
  sourceDirectory: string,
  maxEntries: number,
  maxSourceBytes: number
): Promise<void> {
  const pendingDirectories = [sourceDirectory];
  let entryCount = 0;
  let sourceBytes = 0;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop() as string;
    const directory = await opendir(currentDirectory);
    for await (const entry of directory) {
      entryCount += 1;
      if (entryCount > maxEntries) {
        throw new Error(`Package source exceeds the maximum allowed entry count of ${maxEntries}.`);
      }

      const entryPath = join(currentDirectory, entry.name);
      const entryStats = await lstat(entryPath);
      if (entryStats.isSymbolicLink()) {
        throw new Error(`Package source must not contain symbolic links: ${entryPath}`);
      }
      if (entryStats.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }
      if (!entryStats.isFile()) {
        throw new Error(`Package source contains an unsupported special file: ${entryPath}`);
      }

      sourceBytes += entryStats.size;
      if (!Number.isSafeInteger(sourceBytes) || sourceBytes > maxSourceBytes) {
        throw new Error(`Package source exceeds the maximum allowed size of ${maxSourceBytes} bytes.`);
      }
    }
  }
}

/** 把 WordPress 主题或插件文件夹压缩为包含顶层目录的 ZIP 安装包。 */
export async function createPackageArchive(
  packageType: LocalPackageType,
  folderPath: string,
  outputPath?: string,
  options: PackageArchiveOptions = {}
): Promise<PackageArchiveResult> {
  const sourceDirectory = resolve(folderPath);
  const sourceStats = await stat(sourceDirectory).catch(() => undefined);
  if (!sourceStats?.isDirectory()) {
    throw new Error(`Package source folder does not exist or is not a directory: ${sourceDirectory}`);
  }

  const folderName = basename(sourceDirectory);
  if (!folderName) {
    throw new Error("The filesystem root cannot be packaged as a WordPress package.");
  }

  const outputFile = resolve(outputPath ?? resolve(dirname(sourceDirectory), `${folderName}.zip`));
  if (extname(outputFile).toLowerCase() !== ".zip") {
    throw new Error(`Package output file must use the .zip extension: ${outputFile}`);
  }
  if (isPathInside(sourceDirectory, outputFile)) {
    throw new Error("Package output file must be outside the source folder.");
  }

  const maxEntries = normalizePositiveLimit(options.maxEntries, DEFAULT_MAX_PACKAGE_ENTRIES, "maxEntries");
  const maxSourceBytes = normalizePositiveLimit(
    options.maxSourceBytes,
    DEFAULT_MAX_PACKAGE_SOURCE_BYTES,
    "maxSourceBytes"
  );
  await validatePackageSourceTree(sourceDirectory, maxEntries, maxSourceBytes);

  await mkdir(dirname(outputFile), { recursive: true });
  const temporaryFile = resolve(dirname(outputFile), `.${basename(outputFile)}.${randomUUID()}.tmp`);

  try {
    await new Promise<void>((resolveArchive, rejectArchive) => {
      const output = createWriteStream(temporaryFile);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", resolveArchive);
      output.on("error", rejectArchive);
      archive.on("warning", rejectArchive);
      archive.on("error", rejectArchive);
      archive.pipe(output);
      archive.directory(sourceDirectory, folderName);
      void archive.finalize();
    });

    await rename(temporaryFile, outputFile);
    const outputStats = await stat(outputFile);
    return {
      packageType,
      sourceDirectory,
      outputFile,
      size: outputStats.size
    };
  } finally {
    await rm(temporaryFile, { force: true });
  }
}
