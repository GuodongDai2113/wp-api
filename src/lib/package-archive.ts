import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import archiver from "archiver";

/** WordPress 本地打包操作支持的软件包类型。 */
export type LocalPackageType = "plugin" | "theme";

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

/** 把 WordPress 主题或插件文件夹压缩为包含顶层目录的 ZIP 安装包。 */
export async function createPackageArchive(
  packageType: LocalPackageType,
  folderPath: string,
  outputPath?: string
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

    await copyFile(temporaryFile, outputFile);
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
