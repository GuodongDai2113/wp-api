import { readFile } from "node:fs/promises";
/** 按照显式正文、文件正文、标准输入的优先级解析正文内容。 */
export async function resolveContentInput({ content, contentFile, stdinText } = {}) {
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
