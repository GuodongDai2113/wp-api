import test from "node:test";
import assert from "node:assert/strict";

import {
  buildElementorMeta,
  createElementorRevision,
  parseElementorData,
  readElementorDataFromEntity
} from "../build/wordpress/elementor/document.js";

/** 验证页面版本校验值覆盖完整 Elementor 树。 */
test("createElementorRevision fingerprints the complete element tree", () => {
  const first = [{ id: "head001", elType: "widget", settings: { title: "Hero" }, elements: [] }];
  const second = [{ id: "head001", elType: "widget", settings: { title: "Changed" }, elements: [] }];
  assert.equal(createElementorRevision(first), createElementorRevision(structuredClone(first)));
  assert.notEqual(createElementorRevision(first), createElementorRevision(second));
  assert.match(createElementorRevision(first), /^[a-f0-9]{64}$/);
});

/** 验证 Elementor data 解析和 REST meta 序列化完整保留所有字段。 */
test("Elementor data parsing and meta serialization preserve full trees", () => {
  const tree = [{
    id: "head001",
    elType: "widget",
    widgetType: "heading",
    settings: { title: "Hero", title_color: "#fff" },
    extension: { value: true },
    elements: []
  }];
  assert.deepEqual(parseElementorData(JSON.stringify(tree)), tree);
  assert.deepEqual(parseElementorData(tree), tree);
  assert.deepEqual(parseElementorData(""), []);
  assert.throws(() => parseElementorData("{}"), /must contain a JSON array/);
  assert.deepEqual(readElementorDataFromEntity({ meta: { _elementor_data: JSON.stringify(tree) } }), tree);
  assert.deepEqual(buildElementorMeta(tree, { templateType: "wp-page" }), {
    meta: {
      _elementor_data: JSON.stringify(tree),
      _elementor_edit_mode: "builder",
      _elementor_template_type: "wp-page"
    }
  });
});

/** 验证 REST 未暴露私有 meta 时不会被误判为空页面。 */
test("readElementorDataFromEntity rejects hidden Elementor meta", () => {
  assert.throws(
    () => readElementorDataFromEntity({ id: 12, meta: {} }),
    /not exposed.*show_in_rest/
  );
});
