/** 根据 wp-api 资源名称返回对应的 WordPress REST 路由和行为配置。 */
export function getResourceConfig(resourceName, client) {
    if (resourceName === "posts") {
        return {
            route: "posts",
            kind: "content",
            deleteMode: "trash"
        };
    }
    if (resourceName === "pages") {
        return {
            route: "pages",
            kind: "content",
            deleteMode: "trash"
        };
    }
    if (resourceName === "products") {
        return {
            route: "product",
            kind: "content",
            deleteMode: "trash"
        };
    }
    if (resourceName === "categories") {
        return {
            route: "categories",
            kind: "taxonomy",
            deleteMode: "force"
        };
    }
    if (resourceName === "product-categories") {
        return {
            route: "product_cat",
            kind: "taxonomy",
            deleteMode: "force"
        };
    }
    throw new Error(`Unknown resource: ${resourceName}`);
}
/** 将逗号分隔的 ID 字符串转换为数字数组。 */
function splitCsv(value) {
    return String(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => Number(entry));
}
/** 根据资源类型和 CLI 选项构造 WordPress REST 请求体。 */
export async function buildResourceBody(kind, options, resolveContent, bodyOptions = {}) {
    if (kind === "taxonomy") {
        return compactObject({
            name: options.name,
            slug: options.slug,
            description: options.description,
            parent: options.parent === undefined ? undefined : Number(options.parent)
        });
    }
    const content = await resolveContent();
    return compactObject({
        title: options.title,
        slug: options.slug,
        status: options.status,
        excerpt: options.excerpt,
        content: content === undefined ? undefined : bodyOptions.transformContent?.(content) ?? content,
        categories: options.categories ? splitCsv(options.categories) : undefined
    });
}
/** 根据 CLI 选项构造 WordPress REST 列表查询参数。 */
export function buildListQuery(options) {
    return compactObject({
        search: options.search,
        page: options.page === undefined ? undefined : Number(options.page),
        per_page: options["per-page"] === undefined ? undefined : Number(options["per-page"]),
        status: options.status
    });
}
/** 移除对象中未提供的字段，避免向 WordPress 发送空值。 */
function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""));
}
