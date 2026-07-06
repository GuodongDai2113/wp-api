#!/usr/bin/env node
import { runCli } from "../dist/cli.js";
import { readStdinText } from "../dist/lib/stdin.js";

const result = await runCli(process.argv.slice(2), {
  stdinText: await readStdinText(process.stdin)
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

process.exitCode = result.exitCode;
