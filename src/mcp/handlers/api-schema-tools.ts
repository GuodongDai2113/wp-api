import type { WordPressClient } from "../../lib/wp-client.js";

/** 读取远程 WordPress REST 接口结构时支持的输入。 */
export interface ApiSchemaInput {
  /** `wp-json/` 后的 REST API 路径；省略时读取完整 REST 路由索引。 */
  apiPath?: string;
}

/** 远程 WordPress REST 接口结构工具返回的稳定包装结构。 */
export interface ApiSchemaResult {
  /** 实际请求的 `wp-json/` 相对路径，空字符串表示 REST 根索引。 */
  apiPath: string;
  /** 为获取接口定义而使用的 HTTP 方法。 */
  method: "GET" | "OPTIONS";
  /** WordPress 站点实时返回的路由索引或 OPTIONS schema。 */
  schema: unknown;
}

/** 校验并规范化仅允许位于 `wp-json/` 内部的相对 API 路径。 */
export function normalizeApiSchemaPath(apiPath: unknown): string {
  if (apiPath === undefined) {
    return "";
  }
  if (typeof apiPath !== "string" || apiPath.trim() === "") {
    throw new TypeError("apiPath must be a non-blank string when provided.");
  }

  const normalized = apiPath.trim().replace(/^\/+|\/+$/g, "");
  if (
    normalized === ""
    || normalized.includes("%")
    || normalized.includes("?")
    || normalized.includes("#")
    || normalized.includes("\\")
    || normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError("apiPath must be a safe unencoded wp-json relative path without a query, fragment, backslash, or dot segment.");
  }
  return normalized;
}

/** 从目标站点读取 REST 路由索引，或读取指定路由的 OPTIONS 接口定义。 */
export async function getApiSchema(
  client: WordPressClient,
  input: ApiSchemaInput
): Promise<ApiSchemaResult> {
  const apiPath = normalizeApiSchemaPath(input.apiPath);
  const method = apiPath === "" ? "GET" : "OPTIONS";
  const response = await client.requestApiPath(apiPath, { method });
  return {
    apiPath,
    method,
    schema: response.data
  };
}
