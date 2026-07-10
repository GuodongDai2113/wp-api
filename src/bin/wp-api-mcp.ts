#!/usr/bin/env node
import { startStdioServer } from "../mcp/server.js";

try {
  await startStdioServer();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
