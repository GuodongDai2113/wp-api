import test from "node:test";
import assert from "node:assert/strict";

import {
  applyElementorContentChanges,
  buildElementorMeta,
  createElementorRevision,
  extractElementorEditableContent,
  isElementorContentSettingKey,
  parseElementorData
} from "../build/wordpress/elementor/document.js";

/** 验证页面版本校验值对相同数据保持稳定，并能识别任意正文变化。 */
test("createElementorRevision fingerprints the complete element tree", () => {
  const first = [{ id: "head001", elType: "widget", settings: { title: "Hero" }, elements: [] }];
  const second = [{ id: "head001", elType: "widget", settings: { title: "Changed" }, elements: [] }];

  assert.equal(createElementorRevision(first), createElementorRevision(structuredClone(first)));
  assert.notEqual(createElementorRevision(first), createElementorRevision(second));
  assert.match(createElementorRevision(first), /^[a-f0-9]{64}$/);
});

/** 验证正文读取仅返回元素 ID 和内容字段，不向 Agent 暴露布局、样式或部件信息。 */
test("extractElementorEditableContent returns content-only editable fields", () => {
  const tree = [{
    id: "root001",
    elType: "container",
    settings: { flex_direction: "row", background_color: "#fff" },
    elements: [
      {
        id: "head001",
        elType: "widget",
        widgetType: "heading",
        settings: { title: "Old heading", title_color: "#000", heading_title: "Supporting title" },
        elements: []
      },
      {
        id: "text001",
        elType: "widget",
        widgetType: "text-editor",
        settings: { editor: "Body copy", typography_font_size: 16 },
        elements: []
      }
    ]
  }];

  assert.deepEqual(extractElementorEditableContent(tree), [
    { elementId: "head001", settings: { title: "Old heading", heading_title: "Supporting title" } },
    { elementId: "text001", settings: { editor: "Body copy" } }
  ]);
  assert.deepEqual(extractElementorEditableContent(tree, "body"), [
    { elementId: "text001", settings: { editor: "Body copy" } }
  ]);
  assert.equal(isElementorContentSettingKey("button_text"), true);
  assert.equal(isElementorContentSettingKey("items"), true);
  assert.equal(isElementorContentSettingKey("title_color"), false);
  assert.equal(isElementorContentSettingKey("background_image"), false);
});

/** 验证局部修改按元素 ID 合并正文对象，同时保留未修改的正文和样式值。 */
test("applyElementorContentChanges updates existing content fields only", () => {
  const tree = [{
    id: "button1",
    elType: "widget",
    widgetType: "button",
    settings: {
      text: "Contact us",
      link: { url: "/old", is_external: "on" },
      text_color: "#fff"
    },
    elements: []
  }];

  const result = applyElementorContentChanges(tree, [{
    elementId: "button1",
    settings: { text: "Get a quote", link: { url: "/quote" } }
  }]);

  assert.deepEqual(result, [{ elementId: "button1", fields: ["text", "link"] }]);
  assert.deepEqual(tree[0].settings, {
    text: "Get a quote",
    link: { url: "/quote", is_external: "on" },
    text_color: "#fff"
  });
});

/** 验证局部修改拒绝样式键、不存在字段、值类型变化和重复元素操作。 */
test("applyElementorContentChanges rejects non-content and unsafe changes", () => {
  const tree = [{
    id: "head001",
    elType: "widget",
    settings: { title: "Original", title_color: "#000" },
    elements: []
  }];

  assert.throws(
    () => applyElementorContentChanges(tree, [{ elementId: "head001", settings: { title_color: "#fff" } }]),
    /not editable/
  );
  assert.throws(
    () => applyElementorContentChanges(tree, [{ elementId: "head001", settings: { description: "New" } }]),
    /does not exist/
  );
  assert.throws(
    () => applyElementorContentChanges(tree, [{ elementId: "head001", settings: { title: { value: "New" } } }]),
    /keep the value type/
  );
  assert.throws(
    () => applyElementorContentChanges(tree, [
      { elementId: "head001", settings: { title: "One" } },
      { elementId: "head001", settings: { title: "Two" } }
    ]),
    /Duplicate/
  );
  assert.equal(tree[0].settings.title, "Original");
});

/** 验证 Elementor 原始数组解析和页面 meta 序列化保持覆盖导入所需格式。 */
test("Elementor data parsing and meta serialization preserve full trees", () => {
  const tree = [{ id: "head001", elType: "widget", widgetType: "heading", settings: { title: "Hero" }, elements: [] }];

  assert.deepEqual(parseElementorData(JSON.stringify(tree)), tree);
  assert.deepEqual(parseElementorData(tree), tree);
  assert.deepEqual(parseElementorData(""), []);
  assert.throws(() => parseElementorData("{}"), /must contain a JSON array/);
  assert.deepEqual(buildElementorMeta(tree, { templateType: "wp-page" }), {
    meta: {
      _elementor_data: JSON.stringify(tree),
      _elementor_edit_mode: "builder",
      _elementor_template_type: "wp-page"
    }
  });
});
