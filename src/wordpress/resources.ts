/** WordPress post 类型资源名称。 */
export type PostResourceName = "posts" | "pages" | "products";

/** WordPress taxonomy 类型资源名称。 */
export type TaxonomyResourceName = "categories" | "product-categories";

/** 纯 MCP 资源工具支持的全部资源名称。 */
export type ResourceName = PostResourceName | TaxonomyResourceName;

/** 资源请求体的业务类型。 */
export type ResourceType = "post" | "taxonomy";

/** 删除资源时的默认删除模式。 */
export type DeleteMode = "trash" | "force";

/** Post 类型资源目标。 */
export interface PostResourceTarget {
  /** 固定为 post，用于判别 post 类型资源。 */
  type: "post";
  /** 要操作的具体 post 类型资源。 */
  resource: PostResourceName;
}

/** Taxonomy 类型资源目标。 */
export interface TaxonomyResourceTarget {
  /** 固定为 taxonomy，用于判别 taxonomy 类型资源。 */
  type: "taxonomy";
  /** 要操作的具体 taxonomy 类型资源。 */
  resource: TaxonomyResourceName;
}

/** 资源工具使用的判别目标。 */
export type ResourceTarget = PostResourceTarget | TaxonomyResourceTarget;

/** 某类 MCP 资源对应的 WordPress REST 路由和行为配置。 */
export interface ResourceConfig {
  /** 资源所属的业务类型。 */
  type: ResourceType;
  /** WordPress REST route 中 `wp/v2/` 之后的路径。 */
  route: string;
  /** 删除时应进入回收站还是永久删除。 */
  deleteMode: DeleteMode;
}

/** 全部资源的声明式路由、类型和删除策略注册表。 */
export const RESOURCE_DEFINITIONS = {
  posts: { type: "post", route: "posts", deleteMode: "trash" },
  pages: { type: "post", route: "pages", deleteMode: "trash" },
  products: { type: "post", route: "product", deleteMode: "trash" },
  categories: { type: "taxonomy", route: "categories", deleteMode: "force" },
  "product-categories": { type: "taxonomy", route: "product_cat", deleteMode: "force" }
} as const satisfies Record<ResourceName, ResourceConfig>;

/** 判断字符串是否为当前支持的资源名称。 */
export function isResourceName(resourceName: string): resourceName is ResourceName {
  return Object.prototype.hasOwnProperty.call(RESOURCE_DEFINITIONS, resourceName);
}

/** 根据资源名称返回声明式配置，并拒绝未知名称。 */
export function getResourceConfig(resourceName: string): ResourceConfig {
  if (!isResourceName(resourceName)) {
    throw new Error(`Unknown resource: ${resourceName}`);
  }
  return RESOURCE_DEFINITIONS[resourceName];
}

/** 校验资源目标中的 type 与具体资源注册类型一致。 */
export function getResourceTargetConfig(target: ResourceTarget): ResourceConfig {
  if (typeof target !== "object" || target === null) {
    throw new Error("Resource target must be an object.");
  }
  const config = getResourceConfig(target.resource);
  if (target.type !== config.type) {
    throw new Error(`Resource ${target.resource} requires target type ${config.type}, received ${String(target.type)}.`);
  }
  return config;
}
