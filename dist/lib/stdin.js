/** 在存在管道输入时读取全部标准输入文本，TTY 模式或未传入流时返回 undefined。 */
export async function readStdinText(stream) {
    if (!stream || stream.isTTY) {
        return undefined;
    }
    let content = "";
    for await (const chunk of stream) {
        content += chunk.toString();
    }
    return content;
}
