/** 固定合成文章，不包含真实站点或用户数据。 */
export function makePost(id = 1, content = "<p>短文章</p>", meta = {}) {
  return { id, title: { raw: `文章 ${id}`, rendered: `文章 ${id}` }, slug: `post-${id}`,
    status: "publish", content: { raw: content, rendered: content }, excerpt: { raw: "摘要", rendered: "摘要" }, meta };
}

/** 固定复杂 Catalog 目录，保留枚举真实值、嵌套字段和清空语义。 */
export const catalog = {
  dynamic_fields: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`spec_${index}`, {
    input_type: "repeater", label: `规格 ${index}`, description: "固定说明".repeat(30),
    schema: { type: "array", items: { type: "object", additionalProperties: false,
      properties: { title: { type: "string" }, unit: { type: "string", enum: ["kg", "mm", "m"] } } } }
  }])),
  update_semantics: "null deletes; arrays replace; omitted keys preserved"
};

/** 创建隔离的模拟 HTTP 服务，支持分页、字段投影和写后读取，不访问网络。 */
export function makeFixtureFetch({ body = "<p>短文章</p>", meta = {}, total = 100, partialFailure = false } = {}) {
  const posts = Array.from({ length: total }, (_, i) => makePost(i + 1, body, meta));
  const menuItems = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, menus: 7, parent: i ? 1 : 0,
    menu_order: i + 1, title: { raw: `菜单 ${i + 1}` }, url: `https://example.test/${i + 1}`,
    type: "custom", object: "custom", object_id: 0, status: "publish", meta: {} }));
  /** 按请求模拟真实 REST 响应；未知路径直接失败，避免掩盖错误调用。 */
  return async (input, init) => {
    const url = new URL(input);
    const route = url.pathname.split("/wp-json/")[1];
    const data = init.body ? JSON.parse(init.body) : undefined;
    let payload;
    let totalCount = 0;
    let totalPages = 0;
    if (route === "jelly-catalog/v1/fields/product") payload = catalog;
    else if (route === "batch/v1") payload = { responses: data.requests.map((request, index) => {
      if (partialFailure && index % 5 === 0) return { status: 400, body: { code: "invalid_field", message: "Synthetic failure" } };
      const childUrl = new URL(request.path, "https://example.test");
      const id = Number(childUrl.pathname.split("/").at(-1)) || index + 1;
      const entity = makePost(id, body, meta);
      const selected = childUrl.searchParams.get("_fields")?.split(",");
      return { status: 200, body: selected ? Object.fromEntries(selected.filter((key) => Object.hasOwn(entity, key)).map((key) => [key, entity[key]])) : entity };
    }) };
    else if (route === "wp/v2/menus/7") payload = { id: 7, name: "主导航" };
    else if (/^wp\/v2\/menu-items\/\d+$/.test(route)) {
      const item = menuItems.find((entry) => entry.id === Number(route.split("/").at(-1)));
      Object.assign(item, data);
      payload = item;
    } else if (/^wp\/v2\/(posts|product)\/\d+$/.test(route)) {
      const post = posts.find((entry) => entry.id === Number(route.split("/").at(-1)));
      if (!post) throw new Error("Unknown fixture ID");
      if (data) {
        Object.assign(post, data, data.content === undefined ? {} : { content: { raw: data.content, rendered: data.content } });
      }
      payload = post;
    } else if (["wp/v2/posts", "wp/v2/menu-items"].includes(route)) {
      const collection = route.endsWith("menu-items") ? menuItems : posts;
      const page = Number(url.searchParams.get("page") ?? 1);
      const perPage = Number(url.searchParams.get("per_page") ?? 10);
      totalCount = collection.length;
      totalPages = Math.ceil(totalCount / perPage);
      payload = collection.slice((page - 1) * perPage, page * perPage);
    } else throw new Error(`Unexpected fixture route: ${route}`);
    const fields = url.searchParams.get("_fields")?.split(",");
    if (fields) {
      /** 模拟 WordPress 顶层字段选择，防止把本地裁剪误算为网络收益。 */
      const project = (item) => Object.fromEntries(fields.filter((key) => Object.hasOwn(item, key)).map((key) => [key, item[key]]));
      payload = Array.isArray(payload) ? payload.map(project) : project(payload);
    }
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json",
      "x-wp-total": String(totalCount), "x-wp-totalpages": String(totalPages) } });
  };
}

/** 资源目标在所有合成任务中保持一致。 */
const target = { type: "post", resource: "posts" };
/** 构造固定 MCP 调用，保留显式 client 参数。 */
function call(name, args) { return { name, arguments: { client: "synthetic", ...args } }; }

/** 基准样本与完整任务链；每次运行均重新创建服务数据。 */
export function makeScenarios(directory) {
  return [
    { name: "short-post", steps: [call("wp_resource_get", { target, id: 1 })] },
    { name: "long-post", fixture: { body: "长正文".repeat(10000) }, steps: [call("wp_resource_get", { target, id: 1, context: "edit" })] },
    { name: "large-meta", fixture: { meta: { description: "元数据".repeat(10000) } }, steps: [call("wp_resource_get", { target, id: 1 })] },
    { name: "100-resources", steps: [call("wp_resource_list", { target, perPage: 100 })] },
    { name: "large-menu", steps: [call("wp_menu_get", { id: 7 })] },
    { name: "complex-catalog", fixture: { meta: catalog.dynamic_fields }, steps: [call("wp_resource_get", {
      target: { type: "post", resource: "products" }, id: 1, context: "edit" })] },
    { name: "batch-partial-failure", fixture: { partialFailure: true, body: "正文".repeat(1000) }, steps: [call("wp_resource_batch_update", { target,
      items: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, data: { status: "draft" } })) })] },
    { name: "find-and-edit", steps: [call("wp_resource_list", { target, search: "文章", perPage: 10 }),
      call("wp_resource_update", { target, id: 1, data: { status: "draft" } }), call("wp_resource_get", { target, id: 1 })] },
    { name: "catalog-and-meta", steps: [call("wp_resource_get", { target: { type: "post", resource: "products" }, id: 1, context: "edit" }),
      call("wp_resource_update", { target: { type: "post", resource: "products" }, id: 1, data: { meta: { spec_0: [{ title: "重量", unit: "kg" }] } } }),
      call("wp_resource_get", { target: { type: "post", resource: "products" }, id: 1, context: "edit" })] },
    { name: "locate-and-edit-menu", steps: [call("wp_menu_get", { id: 7 }),
      call("wp_menu_item_update", { id: 2, data: { title: "已更新" } }), call("wp_menu_get", { id: 7 })] },
    { name: "csv-export", fixture: { total: 205 }, steps: [call("wp_resource_list", { target, outputFile: `${directory}/export.csv` })] },
    { name: "long-link-update", fixture: { body: `<p><a href="/old">${"原文".repeat(4000)}</a></p>` }, steps: [call("wp_link", {
      resource: "posts", id: 1, action: "update", href: "/old", newHref: "/new" })] },
    { name: "many-links", fixture: { body: Array.from({ length: 300 }, (_, i) => `<a href="https://example.test/${i}">链接 ${i}</a>`).join("") },
      steps: [call("wp_link", { resource: "posts", id: 1, action: "list" })] }
  ];
}
