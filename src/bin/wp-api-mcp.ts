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

try {
  await startStdioServer({
    allowedLocalRoots: readAllowedLocalRootsFromEnvironment()
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
