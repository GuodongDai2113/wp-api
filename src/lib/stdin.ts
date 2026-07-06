/** 读取标准输入时需要的最小流接口。 */
export interface StdinLike extends AsyncIterable<Buffer | string> {
  /** 标记当前输入是否连接到 TTY。 */
  isTTY?: boolean;
}

/** 在存在管道输入时读取全部标准输入文本，TTY 模式或未传入流时返回 undefined。 */
export async function readStdinText(stream?: StdinLike | null): Promise<string | undefined> {
  if (!stream || stream.isTTY) {
    return undefined;
  }

  let content = "";
  for await (const chunk of stream) {
    content += chunk.toString();
  }
  return content;
}
