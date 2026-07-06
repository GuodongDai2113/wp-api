/** wp-api 支持的资源名称。 */
export type ResourceName = "posts" | "pages" | "products" | "categories" | "product-categories";

/** 资源请求体的类型分类。 */
export type ResourceKind = "content" | "taxonomy";

/** 删除资源时的默认删除模式。 */
export type DeleteMode = "trash" | "force";

/** 某类资源对应的 WordPress REST 路由和行为配置。 */
export interface ResourceConfig {
  /** WordPress REST route 中 `wp/v2/` 之后的路径。 */
  route: string;
  /** 构造请求体时使用的资源类型。 */
  kind: ResourceKind;
  /** 删除时是否默认永久删除。 */
  deleteMode: DeleteMode;
}

/** CLI 解析后的资源参数集合。 */
export type ResourceOptions = Record<string, string | boolean | undefined>;

/** 资源创建或更新时提交给 WordPress REST API 的请求体。 */
export type ResourceBody = Record<string, string | number | boolean | number[] | undefined>;

/** 资源列表查询提交给 WordPress REST API 的查询参数。 */
export type ListQuery = Record<string, string | number | boolean | undefined>;

/** 构造资源请求体时可选的内容后处理配置。 */
export interface BuildResourceBodyOptions {
  /** 在正文来源解析完成后对正文内容执行的转换函数。 */
  transformContent?: (content: string) => string;
}

/** 根据 wp-api 资源名称返回对应的 WordPress REST 路由和行为配置。 */
export function getResourceConfig(resourceName: string, client?: unknown): ResourceConfig {
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
function splitCsv(value: string | boolean): number[] {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number(entry));
}

/** 根据资源类型和 CLI 选项构造 WordPress REST 请求体。 */
export async function buildResourceBody(
  kind: ResourceKind,
  options: ResourceOptions,
  resolveContent: () => Promise<string | undefined>,
  bodyOptions: BuildResourceBodyOptions = {}
): Promise<ResourceBody> {
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
export function buildListQuery(options: ResourceOptions): ListQuery {
  return compactObject({
    search: options.search,
    page: options.page === undefined ? undefined : Number(options.page),
    per_page: options["per-page"] === undefined ? undefined : Number(options["per-page"]),
    status: options.status
  });
}

/** 移除对象中未提供的字段，避免向 WordPress 发送空值。 */
function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")
  ) as Partial<T>;
}
