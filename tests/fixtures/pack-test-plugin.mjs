import { execSync } from "node:child_process";
import { resolve } from "node:path";

const fixtureDir = resolve(import.meta.dirname, "test-plugin");
const outputPath = resolve(import.meta.dirname, "test-plugin.zip");

execSync(
  `PowerShell -NoProfile -Command "Compress-Archive -Path '${fixtureDir}' -DestinationPath '${outputPath}' -Force"`,
  { stdio: "pipe" }
);

console.log(`Created ${outputPath}`);
