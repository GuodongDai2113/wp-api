import type { WordPressClient } from "../../lib/wp-client.js";

/** 读取远程 WordPress REST 接口结构时支持的输入。 */
export interface ApiSchemaInput {
  /** `wp-json/` 后的 REST API 路径；省略时读取根路由目录。 */
  apiPath?: string;
  /** 根路由索引的路径或 namespace 筛选文本。 */
  search?: string;
  /** 根路由摘要中跳过的匹配路由数量。 */
  offset?: number;
  /** 根路由摘要最多返回的路由数量。 */
  limit?: number;
  /** 返回摘要或 WordPress 原始完整响应；默认返回摘要。 */
  detail?: "summary" | "full";
}

/** 单条 WordPress REST 路由的轻量摘要。 */
export interface ApiRouteSummary {
  /** 路由在 `wp-json/` 下的绝对路径。 */
  path: string;
  /** 路由注册的 namespace；无法从响应读取时为 null。 */
  namespace: string | null;
  /** 路由支持的去重 HTTP 方法。 */
  methods: string[];
}

/** WordPress REST 根路由索引的分页摘要。 */
export interface ApiRouteIndexSummary {
  /** WordPress 返回的全部 namespace 名称。 */
  namespaces: string[];
  /** 当前分页返回的轻量路由列表。 */
  routes: ApiRouteSummary[];
  /** 应用搜索条件后的路由总数。 */
  total: number;
  /** 当前分页跳过的路由数量。 */
  offset: number;
  /** 当前分页允许返回的最大路由数量。 */
  limit: number;
  /** 是否仍有未返回的匹配路由。 */
  hasMore: boolean;
}

/** 远程 WordPress REST 接口结构工具返回的稳定包装结构。 */
export interface ApiSchemaResult {
  /** 实际请求的 `wp-json/` 相对路径，空字符串表示 REST 根索引。 */
  apiPath: string;
  /** 为获取接口定义而使用的 HTTP 方法。 */
  method: "GET" | "OPTIONS";
  /** 当前响应采用摘要还是完整模式。 */
  detail: "summary" | "full";
  /** WordPress 站点实时返回的路由索引或 OPTIONS schema。 */
  schema: unknown;
}

/** 判断未知值是否为可安全读取属性的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从 WordPress 路由端点数组中收集去重后的 HTTP 方法。 */
function collectRouteMethods(routeDefinition: unknown): string[] {
  if (!isRecord(routeDefinition) || !Array.isArray(routeDefinition.endpoints)) {
    return [];
  }
  const methods = new Set<string>();
  for (const endpoint of routeDefinition.endpoints) {
    if (!isRecord(endpoint) || !Array.isArray(endpoint.methods)) {
      continue;
    }
    for (const method of endpoint.methods) {
      if (typeof method === "string") {
        methods.add(method);
      }
    }
  }
  return [...methods].sort();
}

/** 将 WordPress REST 根索引压缩为可筛选、可分页的轻量路由目录。 */
export function summarizeApiRouteIndex(
  data: unknown,
  input: Pick<ApiSchemaInput, "search" | "offset" | "limit">
): ApiRouteIndexSummary {
  const root = isRecord(data) ? data : {};
  const namespaces = Array.isArray(root.namespaces)
    ? root.namespaces.filter((value): value is string => typeof value === "string")
    : [];
  const routes = isRecord(root.routes) ? root.routes : {};
  if (input.search !== undefined && (typeof input.search !== "string" || input.search.trim() === "")) {
    throw new TypeError("search must be a non-blank string when provided.");
  }
  if (input.offset !== undefined && (!Number.isInteger(input.offset) || input.offset < 0)) {
    throw new TypeError("offset must be a non-negative integer when provided.");
  }
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) {
    throw new TypeError("limit must be an integer between 1 and 100 when provided.");
  }
  const search = input.search?.trim().toLowerCase() ?? "";
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 50;
  const matchingRoutes = Object.entries(routes)
    .map(([path, definition]): ApiRouteSummary => ({
      path,
      namespace: isRecord(definition) && typeof definition.namespace === "string"
        ? definition.namespace
        : null,
      methods: collectRouteMethods(definition)
    }))
    .filter((route) => search === ""
      || route.path.toLowerCase().includes(search)
      || route.namespace?.toLowerCase().includes(search) === true)
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    namespaces,
    routes: matchingRoutes.slice(offset, offset + limit),
    total: matchingRoutes.length,
    offset,
    limit,
    hasMore: offset + limit < matchingRoutes.length
  };
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
  if (input.detail !== undefined && input.detail !== "summary" && input.detail !== "full") {
    throw new TypeError("detail must be summary or full when provided.");
  }
  const apiPath = normalizeApiSchemaPath(input.apiPath);
  const method = apiPath === "" ? "GET" : "OPTIONS";
  const response = await client.requestApiPath(apiPath, { method });
  const detail = apiPath === "" ? input.detail ?? "summary" : "full";
  return {
    apiPath,
    method,
    detail,
    schema: apiPath === "" && detail === "summary"
      ? summarizeApiRouteIndex(response.data, input)
      : response.data
  };
}
