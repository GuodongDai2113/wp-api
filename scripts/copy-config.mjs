import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 当前脚本所在的绝对目录。 */
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录。 */
const projectDirectory = path.resolve(scriptDirectory, "..");

/** 项目内保存真实 WordPress 凭据的构建源文件。 */
const sourceConfigPath = path.join(projectDirectory, "config", "config.json");

/** 编译产物中 MCP 运行时实际引用的配置文件。 */
const outputConfigPath = path.join(projectDirectory, "build", "config", "config.json");

/** 校验构建源是包含 clients 数组的 JSON 配置，避免把损坏文件复制到运行目录。 */
async function validateSourceConfig() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(sourceConfigPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Missing project credential file: ${sourceConfigPath}. `
        + "Create it from config/config.example.json before building."
      );
    }
    throw new Error(`Project credential file is not valid JSON: ${sourceConfigPath}`, { cause: error });
  }

  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.clients)) {
    throw new Error(`Project credential file must contain a clients array: ${sourceConfigPath}`);
  }
}

/** 将项目凭据配置复制到 build，供编译后的 MCP 服务直接引用。 */
async function copyProjectConfig() {
  await validateSourceConfig();
  await mkdir(path.dirname(outputConfigPath), { recursive: true });
  await copyFile(sourceConfigPath, outputConfigPath);
}

await copyProjectConfig();
