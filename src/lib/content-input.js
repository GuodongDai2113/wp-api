import { readFile } from "node:fs/promises";

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
