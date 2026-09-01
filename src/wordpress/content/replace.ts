/** 正文文本替换操作需要的输入参数。 */
export interface ReplaceContentTextOptions {
  /** 需要被精确匹配的原文本。 */
  text: string;
  /** 用于替换匹配项的新文本。 */
  replacement: string;
}

/** 正文文本替换操作的结果。 */
export interface ReplaceContentTextResult {
  /** 是否实际修改了正文。 */
  updated: boolean;
  /** 替换操作状态。 */
  status: "updated" | "not_found";
  /** 实际完成的替换次数。 */
  replacements: number;
  /** 修改后或保持原样的完整正文。 */
  content: string;
}

/** 精确替换正文中的全部匹配文本，并统计实际替换次数。 */
export function replaceContentText(
  content: string,
  { text, replacement }: ReplaceContentTextOptions
): ReplaceContentTextResult {
  if (text.length === 0) {
    throw new Error("Replacement text to find must not be empty.");
  }

  const replacements = content.split(text).length - 1;
  if (replacements === 0) {
    return { updated: false, status: "not_found", replacements: 0, content };
  }

  return {
    updated: true,
    status: "updated",
    replacements,
    content: content.replaceAll(text, replacement)
  };
}
