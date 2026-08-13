import test from "node:test";
import assert from "node:assert/strict";

import {
  executeElementorTool,
  exportElementorPage,
  findElementorPageElements,
  getElementorElement,
  getElementorStructure,
  importElementorPage,
  initializeElementorPage
} from "../build/mcp/handlers/elementor-tools.js";

/** 构造包含 Elementor 元数据的 WordPress REST 测试实体。 */
function elementorEntity(data) {
  return {
    id: 12,
    meta: {
      _elementor_data: JSON.stringify(data),
      _elementor_edit_mode: "builder"
    }
  };
}

test("initializeElementorPage writes structured MCP data and page settings directly", async () => {
  const calls = [];
  const tree = [{ id: "root001", elType: "container", settings: {}, elements: [] }];
  const client = {
    /** 返回尚未包含 Elementor 元素的现有页面。 */
    async request() {
      return { data: elementorEntity([]), pagination: { total: 0, totalPages: 0 } };
    },
    async update(route, id, body) {
      calls.push({ route, id, body });
      return elementorEntity(tree);
    }
  };

  const result = await initializeElementorPage(client, {
    postId: 12,
    data: tree,
    pageSettings: { hide_title: "yes" }
  });

  assert.deepEqual(result, {
    post_id: 12,
    resource: "pages",
    initialized: true
  });
  assert.deepEqual(calls, [{
    route: "pages",
    id: 12,
    body: {
      meta: {
        _elementor_data: JSON.stringify(tree),
        _elementor_edit_mode: "builder",
        _elementor_template_type: "wp-page",
        _elementor_page_settings: { hide_title: "yes" }
      }
    }
  }]);
});

test("exportElementorPage parses the REST JSON string in edit context", async () => {
  const calls = [];
  const tree = [{ id: "head001", elType: "widget", widgetType: "heading", settings: { title: "Hero" }, elements: [] }];
  const client = {
    async request(route, options) {
      calls.push({ route, options });
      return { data: elementorEntity(tree), pagination: { total: 0, totalPages: 0 } };
    }
  };

  const result = await exportElementorPage(client, { postId: 12 });

  assert.deepEqual(calls, [{ route: "pages/12", options: { query: { context: "edit" } } }]);
  assert.deepEqual(result, {
    post_id: 12,
    resource: "pages",
    json: tree
  });
});

test("importElementorPage writes a nested tree and reports the recursive count", async () => {
  const calls = [];
  const tree = [{
    id: "root001",
    elType: "container",
    settings: {},
    elements: [{ id: "head001", elType: "widget", widgetType: "heading", settings: {}, elements: [] }]
  }];
  const client = {
    async update(route, id, body) {
      calls.push({ route, id, body });
      return elementorEntity(tree);
    }
  };

  const result = await importElementorPage(client, { postId: 12, data: tree });

  assert.equal(result.elements_count, 2);
  assert.equal(calls[0].route, "pages");
  assert.equal(calls[0].id, 12);
  assert.deepEqual(JSON.parse(calls[0].body.meta._elementor_data), tree);
  assert.equal("_elementor_page_settings" in calls[0].body.meta, false);
});

test("structure, get-element, and find handlers read without mutating the page", async () => {
  const calls = [];
  const tree = [{
    id: "root001",
    elType: "container",
    settings: { flex_direction: "column" },
    elements: [{
      id: "head001",
      elType: "widget",
      widgetType: "heading",
      settings: { title: "Hero section", color: "blue" },
      elements: []
    }]
  }];
  const client = {
    async request(route, options) {
      calls.push({ route, options });
      return { data: elementorEntity(tree), pagination: { total: 0, totalPages: 0 } };
    }
  };

  const structure = await getElementorStructure(client, { postId: 12 });
  const element = await getElementorElement(client, { postId: 12, elementId: "head001" });
  const found = await findElementorPageElements(client, {
    postId: 12,
    widgetType: "heading",
    searchText: "HERO",
    settingKey: "title",
    settingValue: "Hero section"
  });

  assert.deepEqual(structure.structure, [{
    id: "root001",
    elType: "container",
    settings_summary: { flex_direction: "column" },
    elements: [{
      id: "head001",
      elType: "widget",
      widgetType: "heading",
      settings_summary: { title: "Hero section" }
    }]
  }]);
  assert.deepEqual(element, {
    post_id: 12,
    resource: "pages",
    element_id: "head001",
    elType: "widget",
    widgetType: "heading",
    settings: { title: "Hero section", color: "blue" }
  });
  assert.equal(found.count, 1);
  assert.equal(found.matches[0].element_id, "head001");
  assert.equal(calls.length, 3);
  assert.equal(calls.every((call) => call.route === "pages/12"), true);
});

test("Elementor handlers reject missing elements and invalid MCP input before writes", async () => {
  let writes = 0;
  const client = {
    async request() {
      return { data: elementorEntity([]), pagination: { total: 0, totalPages: 0 } };
    },
    async update() {
      writes += 1;
      return {};
    }
  };

  await assert.rejects(
    () => getElementorElement(client, { postId: 12, elementId: "missing" }),
    /Element not found: missing/
  );
  await assert.rejects(() => importElementorPage(client, { postId: 12 }), /data is required/);
  await assert.rejects(
    () => importElementorPage(client, { postId: 12, data: "[]" }),
    /data must be an Elementor element array/
  );
  await assert.rejects(
    () => initializeElementorPage(client, { postId: 12, pageSettings: [] }),
    /pageSettings must be an object/
  );
  await assert.rejects(() => exportElementorPage(client, { postId: 0 }), /postId must be a positive integer/);
  await assert.rejects(
    () => exportElementorPage(client, { postId: 12, resource: "posts" }),
    /do not accept resource/
  );
  await assert.rejects(
    () => findElementorPageElements(client, { postId: 12, searchText: 3 }),
    /searchText must be a string/
  );
  await assert.rejects(
    () => executeElementorTool("wp_elementor_unknown", client, { postId: 12 }),
    /Unknown Elementor MCP tool/
  );
  assert.equal(writes, 0);
});

test("executeElementorTool dispatches the supported pure MCP tool names", async () => {
  const client = {
    async request() {
      return { data: elementorEntity([]), pagination: { total: 0, totalPages: 0 } };
    },
    async update() {
      return {};
    }
  };

  const initResult = await executeElementorTool("wp_elementor_init", client, { postId: 12 });
  const exportResult = await executeElementorTool("wp_elementor_export", client, { postId: 12 });
  const importResult = await executeElementorTool("wp_elementor_import", client, { postId: 12, data: [] });

  assert.equal(initResult.initialized, true);
  assert.deepEqual(exportResult.json, []);
  assert.equal(importResult.imported, true);
});

/** Elementor 初始化不能覆盖已经存在的元素树，应引导调用方显式使用 import。 */
test("initializeElementorPage refuses to overwrite an existing page", async () => {
  let writes = 0;
  const existingTree = [{ id: "existing", elType: "container", settings: {}, elements: [] }];
  const client = {
    /** 返回已经包含 Elementor 元素的页面。 */
    async request() {
      return { data: elementorEntity(existingTree), pagination: { total: 0, totalPages: 0 } };
    },
    /** 记录所有不应发生的覆盖写入。 */
    async update() {
      writes += 1;
      return {};
    }
  };

  await assert.rejects(
    () => initializeElementorPage(client, { postId: 12 }),
    /already contains elements.*wp_elementor_import/
  );
  assert.equal(writes, 0);
});

/** Elementor 写入在请求 WordPress 前拒绝畸形节点和超过安全深度的元素树。 */
test("Elementor handlers bound element shape and tree depth", async () => {
  let writes = 0;
  const client = {
    /** 返回尚未包含 Elementor 元素的现有页面。 */
    async request() {
      return { data: elementorEntity([]), pagination: { total: 0, totalPages: 0 } };
    },
    /** 记录所有不应发生的远端写入调用。 */
    async update() {
      writes += 1;
      return {};
    }
  };

  await assert.rejects(
    () => importElementorPage(client, {
      postId: 12,
      data: [{ id: "broken", elType: "widget", settings: {} }]
    }),
    /must have an elements array/
  );

  let nested = { id: "node100", elType: "container", settings: {}, elements: [] };
  for (let index = 99; index >= 0; index -= 1) {
    nested = {
      id: `node${index}`,
      elType: "container",
      settings: {},
      elements: [nested]
    };
  }
  await assert.rejects(
    () => initializeElementorPage(client, { postId: 12, data: [nested] }),
    /maximum tree depth of 100/
  );
  assert.equal(writes, 0);
});

/** Elementor 读取同样拒绝目标站点返回的畸形或无界元素数据。 */
test("Elementor handlers validate remote element trees before traversal", async () => {
  const client = {
    /** 返回缺少必填 settings 的模拟 Elementor 元数据。 */
    async request() {
      return {
        data: elementorEntity([{ id: "broken", elType: "widget", elements: [] }]),
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };

  await assert.rejects(
    () => getElementorStructure(client, { postId: 12 }),
    /must have a settings object/
  );
});
