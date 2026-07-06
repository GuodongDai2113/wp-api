import { readFile } from "node:fs/promises";

/** 解析正文输入时允许传入的三种来源。 */
export interface ContentInputOptions {
  /** 通过命令行参数直接传入的正文内容。 */
  content?: string;
  /** 保存正文内容的本地文件路径。 */
  contentFile?: string;
  /** 从标准输入读取到的正文内容。 */
  stdinText?: string;
}

/** 按照显式正文、文件正文、标准输入的优先级解析正文内容。 */
export async function resolveContentInput({
  content,
  contentFile,
  stdinText
}: ContentInputOptions = {}): Promise<string | undefined> {
  if (typeof content === "string") {
    return content;
  }

  if (contentFile) {
    return readFile(contentFile, "utf8");
  }

  if (typeof stdinText === "string" && stdinText.length > 0) {
    return stdinText;
  }

  return undefined;
}
