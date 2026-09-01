#!/usr/bin/env node
import { delimiter } from "node:path";
import { startStdioServer } from "../mcp/server.js";

/** 从平台路径分隔符格式的环境变量中读取额外允许访问的 MCP 本地根目录。 */
function readAllowedLocalRootsFromEnvironment(): string[] | undefined {
  const configuredRoots = process.env.WP_API_ALLOWED_LOCAL_ROOTS;
  if (!configuredRoots) {
    return undefined;
  }

  const roots = configuredRoots
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return roots.length > 0 ? roots : undefined;
}

/** 从环境变量读取 Elementor data 正整数最大字节数。 */
function readMaxElementorDataBytesFromEnvironment(): number | undefined {
  const configuredBytes = process.env.WP_API_MAX_ELEMENTOR_DATA_BYTES?.trim();
  if (!configuredBytes) {
    return undefined;
  }
  const bytes = Number(configuredBytes);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error("WP_API_MAX_ELEMENTOR_DATA_BYTES must be a positive safe integer.");
  }
  return bytes;
}

try {
  await startStdioServer({
    configDir: process.env.WP_API_CONFIG_DIR?.trim() || undefined,
    allowedLocalRoots: readAllowedLocalRootsFromEnvironment(),
    resultDirectory: process.env.WP_API_RESULT_DIR?.trim() || undefined,
    maxElementorDataBytes: readMaxElementorDataBytesFromEnvironment()
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
