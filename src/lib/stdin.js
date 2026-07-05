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
