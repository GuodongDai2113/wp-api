import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { readStdinText } from "../dist/lib/stdin.js";

test("readStdinText returns undefined for tty-like stdin", async () => {
  const stream = new Readable({ read() {} });
  stream.isTTY = true;

  const value = await readStdinText(stream);

  assert.equal(value, undefined);
});

test("readStdinText reads piped text", async () => {
  const stream = Readable.from(["Hello ", "world"]);
  stream.isTTY = false;

  const value = await readStdinText(stream);

  assert.equal(value, "Hello world");
});
