#!/usr/bin/env node
import { startConfigServer } from "../config/server.js";

try {
  const service = await startConfigServer({
    configDir: process.env.WP_API_CONFIG_DIR?.trim() || undefined,
    openBrowser: true
  });
  process.stdout.write(`wp-api configuration UI: ${service.url}\n`);
  process.stdout.write("The service listens only on 127.0.0.1 and exits after 15 minutes of inactivity.\n");
  await service.finished;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
