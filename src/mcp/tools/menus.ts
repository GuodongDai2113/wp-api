import { WordPressClient, type Pagination } from "../../wordpress/client.js";

/** WordPress 菜单列表查询输入。 */
export interface MenuListInput {
  /** 菜单名称搜索文本。 */
  search?: string;
  /** 当前页码。 */
  page?: number;
  /** 每页菜单数量。 */
  perPage?: number;
}

/** 单个菜单读取输入。 */
export interface MenuGetInput {
  /** 菜单 term ID。 */
  id: number;
}

/** 菜单可写字段。 */
export interface MenuDataInput {
  /** 菜单名称。 */
  name?: string;
  /** 菜单别名。 */
  slug?: string;
  /** 菜单说明。 */
  description?: string;
  /** 分配给菜单的主题位置；更新时传空数组可清除该菜单的全部位置。 */
  locations?: string[];
  /** 是否自动把新建的顶级页面加入菜单。 */
  autoAdd?: boolean;
}

/** 菜单创建输入。 */
export interface MenuCreateInput {
  /** 要创建的菜单字段。 */
  data: MenuDataInput;
}

/** 菜单更新输入。 */
export interface MenuUpdateInput {
  /** 菜单 term ID。 */
  id: number;
  /** 仅包含要修改的菜单字段。 */
  data: MenuDataInput;
}

/** 菜单删除输入。 */
export interface MenuDeleteInput {
  /** 菜单 term ID。 */
  id: number;
  /** 菜单没有回收站，必须显式传 true 确认永久删除。 */
  force?: boolean;
}

/** WordPress 菜单项支持的来源类型。 */
export type MenuItemType = "custom" | "post_type" | "taxonomy" | "post_type_archive";

/** 菜单项可写字段。 */
export interface MenuItemDataInput {
  /** 菜单项所属菜单的 term ID。 */
  menuId?: number;
  /** 菜单项标题。 */
  title?: string;
  /** 菜单项来源类型。 */
  type?: MenuItemType;
  /** 自定义菜单项目标 URL。 */
  url?: string;
  /** 来源对象类型，例如 page、post、product 或 product_cat。 */
  object?: string;
  /** 来源文章或分类的 ID。 */
  objectId?: number;
  /** 父菜单项 ID；0 表示顶级。 */
  parent?: number;
  /** 菜单内排序位置，从 1 开始。 */
  menuOrder?: number;
  /** 链接打开目标。 */
  target?: "" | "_blank";
  /** 链接元素的 CSS 类名。 */
  classes?: string[];
  /** 链接的 XFN 关系值。 */
  xfn?: string[];
  /** 菜单项说明。 */
  description?: string;
  /** 链接 title 属性文本。 */
  attrTitle?: string;
  /** 菜单项发布状态。 */
  status?: "publish" | "draft";
  /** 已注册并通过 REST 开放的菜单项 Meta。 */
  meta?: Record<string, unknown>;
}

/** 菜单项创建输入。 */
export interface MenuItemCreateInput {
  /** 要创建的菜单项字段。 */
  data: MenuItemDataInput;
}

/** 菜单项更新输入。 */
export interface MenuItemUpdateInput {
  /** 菜单项 post ID。 */
  id: number;
  /** 仅包含要修改的菜单项字段。 */
  data: MenuItemDataInput;
}

/** 菜单项删除输入。 */
export interface MenuItemDeleteInput {
  /** 菜单项 post ID。 */
  id: number;
  /** 是否跳过回收站并永久删除；默认 false。 */
  force?: boolean;
}

/** WordPress 菜单列表的组合返回结果。 */
export interface MenuListResult {
  /** 当前分页的菜单。 */
  menus: unknown[];
  /** 菜单分页信息。 */
  pagination: Pagination;
  /** 当前主题注册的菜单位置及其已分配菜单 ID。 */
  locations: unknown;
}

/** 单个菜单及其完整菜单项的组合返回结果。 */
export interface MenuGetResult {
  /** 菜单实体。 */
  menu: unknown;
  /** 按 menu_order 升序排列的全部菜单项。 */
  items: unknown[];
}

/** 断言数值为正整数 ID。 */
function assertPositiveId(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
}

/** 把未定义字段从对象中移除，同时保留空字符串、空数组、false 和 0。 */
function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

/** 校验菜单分页参数。 */
function assertMenuPagination(input: MenuListInput): void {
  if (input.page !== undefined) assertPositiveId(input.page, "Menu page");
  if (input.perPage !== undefined && (!Number.isInteger(input.perPage) || input.perPage < 1 || input.perPage > 100)) {
    throw new TypeError("Menu perPage must be between 1 and 100.");
  }
}

/** 将 MCP 菜单字段映射为 WordPress 原生 REST 字段。 */
function buildMenuBody(data: MenuDataInput): Record<string, unknown> {
  return compactObject({
    name: data.name,
    slug: data.slug,
    description: data.description,
    locations: data.locations,
    auto_add: data.autoAdd
  });
}

/** 将 MCP 菜单项字段映射为 WordPress 原生 REST 字段。 */
function buildMenuItemBody(data: MenuItemDataInput): Record<string, unknown> {
  return compactObject({
    menus: data.menuId,
    title: data.title,
    type: data.type,
    url: data.url,
    object: data.object,
    object_id: data.objectId,
    parent: data.parent,
    menu_order: data.menuOrder,
    target: data.target,
    classes: data.classes,
    xfn: data.xfn,
    description: data.description,
    attr_title: data.attrTitle,
    status: data.status,
    meta: data.meta
  });
}

/** 校验新建菜单项的来源字段组合，提前返回比 WordPress 更清晰的错误。 */
function assertCreatableMenuItem(data: MenuItemDataInput): void {
  assertPositiveId(data.menuId, "Menu item menuId");
  const type = data.type ?? "custom";
  if (type === "custom") {
    if (typeof data.title !== "string" || data.title.trim() === "") {
      throw new TypeError("Custom menu items require a non-blank title.");
    }
    if (typeof data.url !== "string" || data.url.trim() === "") {
      throw new TypeError("Custom menu items require a non-blank url.");
    }
    return;
  }
  if (typeof data.object !== "string" || data.object.trim() === "") {
    throw new TypeError(`${type} menu items require a non-blank object.`);
  }
  if (type !== "post_type_archive") {
    assertPositiveId(data.objectId, "Menu item objectId");
  }
}

/** 读取菜单列表，并同时返回主题注册的菜单位置。 */
export async function listMenus(client: WordPressClient, input: MenuListInput): Promise<MenuListResult> {
  assertMenuPagination(input);
  const [menus, locations] = await Promise.all([
    client.list("menus", compactObject({ search: input.search, page: input.page, per_page: input.perPage })),
    client.request<Record<string, unknown>>("menu-locations")
  ]);
  return { menus: menus.items, pagination: menus.pagination, locations: locations.data };
}

/** 读取一个菜单，并聚合该菜单按顺序排列的全部菜单项。 */
export async function getMenu(client: WordPressClient, input: MenuGetInput): Promise<MenuGetResult> {
  assertPositiveId(input.id, "Menu id");
  const menu = await client.get("menus", input.id, { context: "edit" });
  const items: unknown[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await client.list("menu-items", {
      menus: input.id,
      context: "edit",
      order: "asc",
      orderby: "menu_order",
      page,
      per_page: 100
    });
    items.push(...result.items);
    totalPages = result.pagination.totalPages;
    page += 1;
  } while (page <= totalPages);
  return { menu, items };
}

/** 创建 WordPress 导航菜单。 */
export async function createMenu(client: WordPressClient, input: MenuCreateInput): Promise<unknown> {
  const body = buildMenuBody(input.data);
  if (typeof input.data.name !== "string" || input.data.name.trim() === "") {
    throw new TypeError("Menu creation requires a non-blank name.");
  }
  return client.create("menus", body);
}

/** 更新 WordPress 导航菜单及其主题位置分配。 */
export async function updateMenu(client: WordPressClient, input: MenuUpdateInput): Promise<unknown> {
  assertPositiveId(input.id, "Menu id");
  const body = buildMenuBody(input.data);
  if (Object.keys(body).length === 0) throw new Error("No menu update fields were provided.");
  return client.update("menus", input.id, body);
}

/** 永久删除 WordPress 导航菜单。 */
export async function deleteMenu(client: WordPressClient, input: MenuDeleteInput): Promise<unknown> {
  assertPositiveId(input.id, "Menu id");
  if (input.force !== true) {
    throw new Error("Menus do not support trash; set force to true to confirm permanent deletion.");
  }
  return client.delete("menus", input.id, { force: true });
}

/** 创建 WordPress 导航菜单项。 */
export async function createMenuItem(client: WordPressClient, input: MenuItemCreateInput): Promise<unknown> {
  assertCreatableMenuItem(input.data);
  return client.create("menu-items", buildMenuItemBody(input.data));
}

/** 更新 WordPress 导航菜单项，并支持调整父级、顺序或所属菜单。 */
export async function updateMenuItem(client: WordPressClient, input: MenuItemUpdateInput): Promise<unknown> {
  assertPositiveId(input.id, "Menu item id");
  if (input.data.menuId !== undefined) assertPositiveId(input.data.menuId, "Menu item menuId");
  const body = buildMenuItemBody(input.data);
  if (Object.keys(body).length === 0) throw new Error("No menu item update fields were provided.");
  return client.update("menu-items", input.id, body);
}

/** 删除 WordPress 导航菜单项；可选择移入回收站或永久删除。 */
export async function deleteMenuItem(client: WordPressClient, input: MenuItemDeleteInput): Promise<unknown> {
  assertPositiveId(input.id, "Menu item id");
  return client.delete("menu-items", input.id, { force: input.force === true });
}
