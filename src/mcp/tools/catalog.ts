import type { WordPressClient } from "../../wordpress/client.js";

/** Jelly Catalog 实时字段目录的查询参数。 */
export interface CatalogFieldsInput {
  /** 查询产品字段或产品分类字段，不允许传入任意 REST 路径。 */
  target: "product" | "product_cat";
}

/**
 * 使用所选站点的认证连接读取实时字段目录，完整保留说明、选项及嵌套 schema。
 * 不跟随响应中的 endpoint 发起请求，避免把认证信息发送到远端指定的其他地址。
 * @param client 已解析且带认证的 WordPress 客户端。
 * @param input 产品或分类字段目标。
 * @returns 插件原始字段目录；权限错误及缺失路由由客户端原样抛出。
 */
export async function getCatalogFields(client: WordPressClient, input: CatalogFieldsInput): Promise<unknown> {
  if (input.target !== "product" && input.target !== "product_cat") {
    throw new TypeError("target must be product or product_cat.");
  }
  const result = await client.requestApiPath(
    `jelly-catalog/v1/fields/${input.target}`,
    { method: "GET" }
  );
  return result.data;
}
