import assert from "node:assert/strict";
import test from "node:test";

import {
  createMenu,
  createMenuItem,
  deleteMenu,
  deleteMenuItem,
  getMenu,
  listMenus,
  updateMenu,
  updateMenuItem
} from "../build/mcp/tools/menus.js";
import { executeWpApiTool } from "../build/mcp/tool-router.js";

/** 菜单列表同时返回分页菜单和当前主题位置。 */
test("menu list returns menus and active-theme locations", async () => {
  const calls = [];
  const client = {
    /** 记录菜单分页查询。 */
    async list(route, query) {
      calls.push({ method: "list", route, query });
      return { items: [{ id: 12, name: "Primary" }], pagination: { total: 1, totalPages: 1 } };
    },
    /** 记录菜单位置查询。 */
    async request(route) {
      calls.push({ method: "request", route });
      return { data: { primary: { name: "primary", description: "Primary", menu: 12 } } };
    }
  };

  const result = await listMenus(client, { search: "Primary", page: 1, perPage: 20 });

  assert.deepEqual(result, {
    menus: [{ id: 12, name: "Primary" }],
    pagination: { total: 1, totalPages: 1 },
    locations: { primary: { name: "primary", description: "Primary", menu: 12 } }
  });
  assert.equal(calls.some((call) => call.method === "list" && call.route === "menus"), true);
  assert.equal(calls.some((call) => call.method === "request" && call.route === "menu-locations"), true);
});

/** 菜单详情按分页聚合全部可编辑菜单项。 */
test("menu get aggregates every ordered menu item page", async () => {
  const calls = [];
  const client = {
    /** 返回模拟菜单。 */
    async get(route, id, query) {
      calls.push({ method: "get", route, id, query });
      return { id, name: "Primary" };
    },
    /** 返回两页模拟菜单项。 */
    async list(route, query) {
      calls.push({ method: "list", route, query });
      return query.page === 1
        ? { items: [{ id: 1 }], pagination: { total: 2, totalPages: 2 } }
        : { items: [{ id: 2 }], pagination: { total: 2, totalPages: 2 } };
    }
  };

  const result = await getMenu(client, { id: 12 });

  assert.deepEqual(result, { menu: { id: 12, name: "Primary" }, items: [{ id: 1 }, { id: 2 }] });
  assert.deepEqual(calls[0], { method: "get", route: "menus", id: 12, query: { context: "edit" } });
  assert.deepEqual(calls[1].query, { menus: 12, context: "edit", order: "asc", orderby: "menu_order", page: 1, per_page: 100 });
  assert.equal(calls[2].query.page, 2);
});

/** 菜单写入映射主题位置与自动添加字段，并保护永久删除。 */
test("menu mutations map fields and require permanent-delete confirmation", async () => {
  const calls = [];
  const client = {
    /** 记录菜单创建请求。 */
    async create(route, body) {
      calls.push({ method: "create", route, body });
      return { id: 12, ...body };
    },
    /** 记录菜单更新请求。 */
    async update(route, id, body) {
      calls.push({ method: "update", route, id, body });
      return { id, ...body };
    },
    /** 记录菜单删除请求。 */
    async delete(route, id, options) {
      calls.push({ method: "delete", route, id, options });
      return { deleted: true };
    }
  };

  await createMenu(client, { data: { name: "Primary", locations: ["primary"], autoAdd: false } });
  await updateMenu(client, { id: 12, data: { locations: [], description: "" } });
  await assert.rejects(() => deleteMenu(client, { id: 12 }), /force to true/);
  await deleteMenu(client, { id: 12, force: true });

  assert.deepEqual(calls[0], { method: "create", route: "menus", body: { name: "Primary", locations: ["primary"], auto_add: false } });
  assert.deepEqual(calls[1], { method: "update", route: "menus", id: 12, body: { description: "", locations: [] } });
  assert.deepEqual(calls[2], { method: "delete", route: "menus", id: 12, options: { force: true } });
});

/** 菜单项写入映射来源、层级和排序字段，并保留显式清空值。 */
test("menu item mutations map source hierarchy and clearing values", async () => {
  const calls = [];
  const client = {
    /** 记录菜单项创建请求。 */
    async create(route, body) {
      calls.push({ method: "create", route, body });
      return { id: 31, ...body };
    },
    /** 记录菜单项更新请求。 */
    async update(route, id, body) {
      calls.push({ method: "update", route, id, body });
      return { id, ...body };
    },
    /** 记录菜单项删除请求。 */
    async delete(route, id, options) {
      calls.push({ method: "delete", route, id, options });
      return { id, deleted: true };
    }
  };

  await createMenuItem(client, {
    data: { menuId: 12, title: "Pumps", type: "taxonomy", object: "product_cat", objectId: 8, parent: 0, menuOrder: 2 }
  });
  await updateMenuItem(client, { id: 31, data: { title: "All pumps", parent: 0, classes: [], target: "" } });
  await deleteMenuItem(client, { id: 31 });

  assert.deepEqual(calls[0], {
    method: "create",
    route: "menu-items",
    body: { menus: 12, title: "Pumps", type: "taxonomy", object: "product_cat", object_id: 8, parent: 0, menu_order: 2 }
  });
  assert.deepEqual(calls[1], { method: "update", route: "menu-items", id: 31, body: { title: "All pumps", parent: 0, target: "", classes: [] } });
  assert.deepEqual(calls[2], { method: "delete", route: "menu-items", id: 31, options: { force: false } });
});

/** 菜单项创建会在发起请求前拒绝缺失的类型必填字段。 */
test("menu item creation validates source-specific required fields", async () => {
  const client = {
    /** 校验失败时不应发出创建请求。 */
    async create() {
      throw new Error("Unexpected create call.");
    }
  };

  await assert.rejects(() => createMenuItem(client, { data: { menuId: 12, type: "custom", title: "Contact" } }), /require a non-blank url/);
  await assert.rejects(() => createMenuItem(client, { data: { menuId: 12, type: "taxonomy", object: "product_cat" } }), /objectId/);
});

/** MCP 路由器把菜单工具分发到已解析的认证客户端。 */
test("menu MCP tools dispatch through the authenticated client", async () => {
  const calls = [];
  const client = {
    /** 返回模拟菜单列表。 */
    async list(route, query) {
      calls.push({ method: "list", route, query });
      return { items: [], pagination: { total: 0, totalPages: 0 } };
    },
    /** 返回模拟菜单位置。 */
    async request(route) {
      calls.push({ method: "request", route });
      return { data: {} };
    },
    /** 记录菜单更新。 */
    async update(route, id, body) {
      calls.push({ method: "update", route, id, body });
      return { id, ...body };
    }
  };
  const context = {
    /** 为菜单工具返回同一个模拟认证客户端。 */
    async resolveClientImpl() {
      return client;
    }
  };

  await executeWpApiTool("wp_menu_list", { client: "local" }, context);
  await executeWpApiTool("wp_menu_item_update", { client: "local", id: 31, data: { parent: 0 } }, context);

  assert.equal(calls.some((call) => call.method === "list" && call.route === "menus"), true);
  assert.deepEqual(calls.at(-1), { method: "update", route: "menu-items", id: 31, body: { parent: 0 } });
});
