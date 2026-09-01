import test from "node:test";
import assert from "node:assert/strict";

import { replaceContentText } from "../build/wordpress/content/replace.js";

test("replaceContentText replaces every exact occurrence and reports the count", () => {
  assert.deepEqual(
    replaceContentText("teh word and teh word", { text: "teh", replacement: "the" }),
    {
      updated: true,
      status: "updated",
      replacements: 2,
      content: "the word and the word"
    }
  );
});

test("replaceContentText leaves content unchanged when text is absent", () => {
  assert.deepEqual(
    replaceContentText("correct content", { text: "teh", replacement: "the" }),
    {
      updated: false,
      status: "not_found",
      replacements: 0,
      content: "correct content"
    }
  );
});

test("replaceContentText rejects an empty search string", () => {
  assert.throws(
    () => replaceContentText("content", { text: "", replacement: "value" }),
    /must not be empty/
  );
});
