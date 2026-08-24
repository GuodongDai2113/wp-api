/** 纯 MCP 内容工具支持的 WordPress 资源名称。 */
export type ResourceName = "posts" | "pages" | "products" | "categories" | "product-categories" | "product-tags";

/** 资源请求体的业务分类。 */
export type ResourceKind = "content" | "taxonomy";

/** 删除资源时的默认删除模式。 */
export type DeleteMode = "trash" | "force";

/** 某类 MCP 资源对应的 WordPress REST 路由和行为配置。 */
export interface ResourceConfig {
  /** WordPress REST route 中 `wp/v2/` 之后的路径。 */
  route: string;
  /** 构造请求体时使用的资源类型。 */
  kind: ResourceKind;
  /** 删除时应进入回收站还是永久删除。 */
  deleteMode: DeleteMode;
}

/** 根据 MCP 资源名称返回对应的 WordPress REST 路由和行为配置。 */
export function getResourceConfig(resourceName: string): ResourceConfig {
  switch (resourceName) {
    case "posts":
      return { route: "posts", kind: "content", deleteMode: "trash" };
    case "pages":
      return { route: "pages", kind: "content", deleteMode: "trash" };
    case "products":
      return { route: "product", kind: "content", deleteMode: "trash" };
    case "categories":
      return { route: "categories", kind: "taxonomy", deleteMode: "force" };
    case "product-categories":
      return { route: "product_cat", kind: "taxonomy", deleteMode: "force" };
    case "product-tags":
      return { route: "product_tag", kind: "taxonomy", deleteMode: "force" };
    default:
      throw new Error(`Unknown resource: ${resourceName}`);
  }
}
