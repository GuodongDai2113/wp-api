import test from "node:test";
import assert from "node:assert/strict";

import {
  buildElementorMeta,
  findElements,
  mergeElementorPageSettings,
  parseElementorData,
  readDefaultKitId,
  readElementorPageSettings,
  simplifyElementorStructure
} from "../build/lib/elementor.js";

test("simplifyElementorStructure returns a lightweight readable tree", () => {
  const root = {
    id: "aaaaaaa",
    elType: "container",
    widgetType: null,
    settings: {
      container_type: "flex",
      content_width: "boxed",
      flex_direction: "row"
    },
    elements: [
      {
        id: "bbbbbbb",
        elType: "widget",
        widgetType: "heading",
        settings: { title: "Hero", long: "x".repeat(120) },
        elements: []
      }
    ]
  };

  assert.deepEqual(simplifyElementorStructure([root]), [
    {
      id: "aaaaaaa",
      elType: "container",
      settings_summary: {
        flex_direction: "row",
        content_width: "boxed",
        container_type: "flex"
      },
      elements: [
        {
          id: "bbbbbbb",
          elType: "widget",
          widgetType: "heading",
          settings_summary: {
            title: "Hero"
          }
        }
      ]
    }
  ]);
});

test("findElements filters by widget type and search text", () => {
  const root = {
    id: "aaaaaaa",
    elType: "container",
    widgetType: null,
    settings: {},
    elements: [
      { id: "bbbbbbb", elType: "widget", widgetType: "heading", settings: { title: "Hero Section" }, elements: [] },
      { id: "ccccccc", elType: "widget", widgetType: "button", settings: { text: "Contact" }, elements: [] }
    ]
  };

  const matches = findElements([root], { widgetType: "heading", searchText: "hero" });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].widgetType, "heading");
  assert.deepEqual(matches[0].settings_preview, { title: "Hero Section" });
});

test("parseElementorData accepts JSON strings and arrays", () => {
  const tree = [{ id: "aaaaaaa", elType: "widget", widgetType: "heading", settings: { title: "Hero" }, elements: [] }];

  assert.deepEqual(parseElementorData(JSON.stringify(tree)), tree);
  assert.deepEqual(parseElementorData(tree), tree);
  assert.deepEqual(parseElementorData(""), []);
});

test("buildElementorMeta serializes Elementor data and required flags", () => {
  const tree = [{ id: "aaaaaaa", elType: "widget", widgetType: "heading", settings: { title: "Hero" }, elements: [] }];

  assert.deepEqual(buildElementorMeta(tree, { templateType: "wp-page", pageSettings: { hide_title: "yes" } }), {
    meta: {
      _elementor_data: JSON.stringify(tree),
      _elementor_edit_mode: "builder",
      _elementor_template_type: "wp-page",
      _elementor_page_settings: {
        hide_title: "yes"
      }
    }
  });
});

test("readDefaultKitId returns the first default kit id", () => {
  assert.equal(readDefaultKitId([{ id: 23 }, { id: 24 }]), 23);
});

test("readDefaultKitId rejects missing or invalid default kits", () => {
  assert.throws(() => readDefaultKitId([]), /Default Elementor Kit was not found/);
  assert.throws(() => readDefaultKitId([{ id: "23" }]), /Default Elementor Kit was not found/);
});

test("readElementorPageSettings returns settings or an empty object", () => {
  assert.deepEqual(readElementorPageSettings({
    meta: { _elementor_page_settings: { system_colors: [{ _id: "primary" }] } }
  }), { system_colors: [{ _id: "primary" }] });
  assert.deepEqual(readElementorPageSettings({ meta: {} }), {});
  assert.deepEqual(readElementorPageSettings({ meta: { _elementor_page_settings: [] } }), {});
});

test("mergeElementorPageSettings shallowly replaces matching top-level values", () => {
  assert.deepEqual(mergeElementorPageSettings(
    { keep: true, nested: { old: 1 }, list: [1, 2] },
    { nested: { next: 2 }, list: [3] }
  ), {
    keep: true,
    nested: { next: 2 },
    list: [3]
  });
});
