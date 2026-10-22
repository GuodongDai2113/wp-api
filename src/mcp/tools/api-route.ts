import type { WordPressClient } from "../../wordpress/client.js";

/** 读取远程 WordPress REST 接口结构时支持的输入。 */
export interface ApiRouteInput {
  /** 目标 WordPress 站点的裸域名，不包含协议、端口、路径、查询或 fragment。 */
  domain: string;
  /** REST API 路径；默认为 `wp-json`，也接受省略 `wp-json/` 前缀的简写。 */
  apiPath?: string;
  /** 根路由路径、namespace 或已选参数/字段目录的名称筛选文本。 */
  search?: string;
  /** 路由、参数或字段目录中跳过的匹配条目数量。 */
  offset?: number;
  /** 目录最多返回的条目数量；概览默认 20，兼容摘要默认 50。 */
  limit?: number;
  /** 默认概览不展开定义；summary 保留旧版约束摘要，full 返回完整定义。 */
  detail?: "overview" | "summary" | "full";
  /** 按需展开根路由目录、请求参数或响应字段；不指定时仅返回当前层级。 */
  section?: "routes" | "arguments" | "fields";
  /** 参数目录的 HTTP 方法筛选，例如 POST；仅用于 arguments。 */
  httpMethod?: string;
  /** 精确选择顶层参数或字段名；完整嵌套定义通过 full 按需读取。 */
  names?: string[];
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
export interface ApiRouteResult {
  /** 经过校验和小写规范化的目标域名。 */
  domain: string;
  /** 规范化后的 REST 路径；根索引固定为 `wp-json`。 */
  apiPath: string;
  /** 实际发起只读请求的完整 HTTPS URL。 */
  url: string;
  /** 为获取接口定义而使用的 HTTP 方法。 */
  method: "GET" | "OPTIONS";
  /** 当前响应采用概览、兼容摘要还是完整模式。 */
  detail: "overview" | "summary" | "full";
  /** WordPress 站点实时返回的路由索引或 OPTIONS schema。 */
  schema: unknown;
  /** 当前层级的按需读取提示；兼容摘要和原始完整响应不附加提示。 */
  next?: string;
}

/** 单个 REST 参数或响应字段的紧凑约束说明。 */
export interface ApiValueSummary {
  /** WordPress 声明的 JSON 类型。 */
  type?: unknown;
  /** 参数是否为必填项。 */
  required?: boolean;
  /** 字段是否只读。 */
  readonly?: boolean;
  /** 字符串或数值使用的格式。 */
  format?: string;
  /** 允许使用的枚举值。 */
  enum?: unknown[];
  /** 简单标量默认值。 */
  default?: string | number | boolean | null;
  /** 数值允许的最小值。 */
  minimum?: number;
  /** 数值允许的最大值。 */
  maximum?: number;
  /** 数组元素的紧凑约束。 */
  items?: ApiValueSummary;
  /** 对象直接子字段的紧凑约束。 */
  properties?: Record<string, ApiValueSummary>;
}

/** 单个 REST endpoint 的紧凑方法与参数说明。 */
export interface ApiEndpointSummary {
  /** 该 endpoint 支持的 HTTP 方法。 */
  methods: string[];
  /** 参数名称及必要约束；省略冗长描述文本。 */
  arguments: Record<string, ApiValueSummary>;
}

/** 指定 REST 路径的轻量 OPTIONS 摘要。 */
export interface ApiPathSummary {
  /** 路径所属 namespace；无法读取时为 null。 */
  namespace: string | null;
  /** 路径支持的全部去重 HTTP 方法。 */
  methods: string[];
  /** 各 endpoint 的方法和参数摘要。 */
  endpoints: ApiEndpointSummary[];
  /** 响应 schema 字段及其必要约束。 */
  fields: Record<string, ApiValueSummary>;
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

/** 读取未知数组中的字符串值并去重排序。 */
function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item): item is string => typeof item === "string"))].sort();
}

/** 判断未知值是否是适合保留在摘要中的简单标量。 */
function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** 提取 Agent 做参数选择所需的约束，并限制递归深度以控制输出体积。 */
function summarizeApiValue(value: unknown, depth = 0): ApiValueSummary {
  if (!isRecord(value)) {
    return {};
  }

  const summary: ApiValueSummary = {};
  if (typeof value.type === "string" || Array.isArray(value.type)) {
    summary.type = value.type;
  }
  if (typeof value.required === "boolean") {
    summary.required = value.required;
  }
  if (typeof value.readonly === "boolean") {
    summary.readonly = value.readonly;
  }
  if (typeof value.format === "string") {
    summary.format = value.format;
  }
  if (Array.isArray(value.enum)) {
    summary.enum = value.enum;
  }
  if (isScalar(value.default)) {
    summary.default = value.default;
  }
  if (typeof value.minimum === "number") {
    summary.minimum = value.minimum;
  }
  if (typeof value.maximum === "number") {
    summary.maximum = value.maximum;
  }

  if (depth < 2 && isRecord(value.items)) {
    summary.items = summarizeApiValue(value.items, depth + 1);
  }
  if (depth < 2 && isRecord(value.properties)) {
    summary.properties = Object.fromEntries(
      Object.entries(value.properties).map(([name, definition]) => [name, summarizeApiValue(definition, depth + 1)])
    );
  }
  return summary;
}

/** 将参数或字段定义表压缩为不含描述文本和链接信息的必要约束。 */
function summarizeApiValueMap(value: unknown): Record<string, ApiValueSummary> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, definition]) => [name, summarizeApiValue(definition)])
  );
}

/** 将指定 REST 路径的 OPTIONS 响应压缩为方法、参数和字段摘要。 */
export function summarizeApiPathSchema(data: unknown): ApiPathSummary {
  const root = isRecord(data) ? data : {};
  const endpoints = Array.isArray(root.endpoints)
    ? root.endpoints.filter(isRecord).map((endpoint): ApiEndpointSummary => ({
      methods: readStringArray(endpoint.methods),
      arguments: summarizeApiValueMap(endpoint.args)
    }))
    : [];
  const methods = new Set(readStringArray(root.methods));
  for (const endpoint of endpoints) {
    for (const method of endpoint.methods) {
      methods.add(method);
    }
  }
  const responseSchema = isRecord(root.schema) ? root.schema : {};

  return {
    namespace: typeof root.namespace === "string" ? root.namespace : null,
    methods: [...methods].sort(),
    endpoints,
    fields: summarizeApiValueMap(responseSchema.properties)
  };
}

/** 将 WordPress REST 根索引压缩为可筛选、可分页的轻量路由目录。 */
export function summarizeApiRouteIndex(
  data: unknown,
  input: Pick<ApiRouteInput, "search" | "offset" | "limit">
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

/** 校验并规范化目标站点裸域名，确保工具只能自行拼接 HTTPS 地址。 */
export function normalizeRestApiDomain(domain: unknown): string {
  if (typeof domain !== "string" || domain.trim() === "") {
    throw new TypeError("domain is required and must be a non-blank hostname such as example.com.");
  }

  const candidate = domain.trim().toLowerCase();
  if (
    candidate.length > 253
    || candidate.includes(":")
    || candidate.includes("/")
    || candidate.includes("?")
    || candidate.includes("#")
    || candidate.includes("@")
    || candidate.includes("\\")
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\.?$/.test(candidate)
  ) {
    throw new TypeError("domain must be a bare hostname without a protocol, port, credentials, path, query, or fragment.");
  }
  return candidate.replace(/\.$/, "");
}

/** 校验 REST 路径并移除可选的 `wp-json/` 前缀，返回供 WordPress client 请求的相对路径。 */
export function normalizeApiRoutePath(apiPath: unknown): string {
  if (apiPath === undefined) {
    return "";
  }
  if (typeof apiPath !== "string" || apiPath.trim() === "") {
    throw new TypeError("apiPath must be a non-blank string when provided.");
  }

  let normalized = apiPath.trim().replace(/^\/+|\/+$/g, "");
  if (
    normalized === ""
    || normalized.includes("%")
    || normalized.includes("?")
    || normalized.includes("#")
    || normalized.includes("\\")
    || normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError("apiPath must be a safe unencoded REST path without a query, fragment, backslash, or dot segment.");
  }
  if (normalized === "wp-json") {
    return "";
  }
  if (normalized.startsWith("wp-json/")) {
    normalized = normalized.slice("wp-json/".length);
  }
  return normalized;
}

/** 在发起请求前检查披露层级与筛选组合，避免无效输入触发下载或静默忽略筛选。 */
function validateDisclosureInput(input: ApiRouteInput, requestPath: string): void {
  if (input.detail !== undefined && !["overview", "summary", "full"].includes(input.detail)) {
    throw new TypeError("detail must be overview, summary or full when provided.");
  }
  if (input.section !== undefined && !["routes", "arguments", "fields"].includes(input.section)) {
    throw new TypeError("section must be routes, arguments or fields.");
  }
  if (input.search !== undefined && (typeof input.search !== "string" || input.search.trim() === "")) {
    throw new TypeError("search must be a non-blank string when provided.");
  }
  if (input.offset !== undefined && (!Number.isInteger(input.offset) || input.offset < 0)) {
    throw new TypeError("offset must be a non-negative integer when provided.");
  }
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) {
    throw new TypeError("limit must be an integer between 1 and 100 when provided.");
  }
  if (input.section === "routes" && requestPath !== ""
    || (input.section === "arguments" || input.section === "fields") && requestPath === "") {
    throw new TypeError("routes requires the root index; arguments and fields require a specific apiPath.");
  }
  if (input.httpMethod !== undefined && (input.section !== "arguments"
    || typeof input.httpMethod !== "string" || !/^[A-Za-z]+$/.test(input.httpMethod))) {
    throw new TypeError("httpMethod requires section arguments and an HTTP method such as POST.");
  }
  if (input.names !== undefined && ((input.section !== "arguments" && input.section !== "fields")
    || !Array.isArray(input.names) || input.names.length === 0 || input.names.length > 100
    || input.names.some((name) => typeof name !== "string" || name.trim() === ""))) {
    throw new TypeError("names requires section arguments or fields and 1 to 100 non-blank exact names.");
  }
  if (requestPath !== "" && input.section === undefined
    && (input.search !== undefined || input.offset !== undefined || input.limit !== undefined)) {
    throw new TypeError("Select section arguments or fields before filtering or paging a specific apiPath.");
  }
}

/** 仅在选定参数或字段分区后构建分页目录；完整模式保留所有原始约束，不截断嵌套定义。 */
function selectApiDefinitions(data: unknown, input: ApiRouteInput): unknown {
  const root = isRecord(data) ? data : {};
  const responseSchema = isRecord(root.schema) ? root.schema : {};
  const endpoints = Array.isArray(root.endpoints) ? root.endpoints.filter(isRecord) : [];
  const httpMethod = input.httpMethod?.toUpperCase();
  const entries = input.section === "fields"
    ? Object.entries(isRecord(responseSchema.properties) ? responseSchema.properties : {})
      .map(([name, definition]) => ({ name, methods: [] as string[], definition }))
    : endpoints.flatMap((endpoint) => {
      const methods = readStringArray(endpoint.methods);
      return httpMethod && !methods.includes(httpMethod) ? []
        : Object.entries(isRecord(endpoint.args) ? endpoint.args : {})
          .map(([name, definition]) => ({ name, methods, definition }));
    });
  if (httpMethod && !endpoints.some((endpoint) => readStringArray(endpoint.methods).includes(httpMethod))) {
    throw new TypeError(`No endpoint defines HTTP method ${httpMethod}.`);
  }
  const missing = input.names?.filter((name) => !entries.some((entry) => entry.name === name)) ?? [];
  if (missing.length > 0) {
    throw new TypeError(`Unknown ${input.section} names: ${missing.join(", ")}.`);
  }
  const search = input.search?.trim().toLowerCase() ?? "";
  const matching = entries.filter((entry) => (!input.names || input.names.includes(entry.name))
    && entry.name.toLowerCase().includes(search));
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  return {
    section: input.section,
    items: matching.slice(offset, offset + limit).map((entry) => ({
      name: entry.name,
      ...(input.section === "arguments" ? { methods: entry.methods } : {}),
      ...(input.detail === "full" ? { definition: entry.definition }
        : input.detail === "summary" ? { definition: summarizeApiValue(entry.definition) } : {})
    })),
    total: matching.length,
    offset,
    limit,
    hasMore: offset + limit < matching.length
  };
}

/** 默认仅披露 namespace、方法及条目数量；下一层目录和完整约束由调用方显式选择。 */
function describeApiOverview(data: unknown, input: ApiRouteInput, requestPath: string): unknown {
  const root = isRecord(data) ? data : {};
  if (requestPath === "") {
    if (input.section === "routes" || input.search !== undefined || input.offset !== undefined || input.limit !== undefined) {
      const { namespaces: _namespaces, ...directory } = summarizeApiRouteIndex(data, { ...input, limit: input.limit ?? 20 });
      return directory;
    }
    return {
      namespaces: readStringArray(root.namespaces),
      routeCount: isRecord(root.routes) ? Object.keys(root.routes).length : 0
    };
  }
  const endpoints = Array.isArray(root.endpoints) ? root.endpoints.filter(isRecord) : [];
  const responseSchema = isRecord(root.schema) ? root.schema : {};
  return {
    namespace: typeof root.namespace === "string" ? root.namespace : null,
    methods: [...new Set([...readStringArray(root.methods), ...collectRouteMethods(root)])].sort(),
    endpoints: endpoints.map((endpoint) => ({
      methods: readStringArray(endpoint.methods),
      argumentCount: isRecord(endpoint.args) ? Object.keys(endpoint.args).length : 0
    })),
    fieldCount: isRecord(responseSchema.properties) ? Object.keys(responseSchema.properties).length : 0
  };
}

/** 从目标站点读取公开 REST 元数据，默认逐层披露，并保留显式摘要及原始完整读取能力。 */
export async function getApiRoute(
  client: WordPressClient,
  input: ApiRouteInput
): Promise<ApiRouteResult> {
  const domain = normalizeRestApiDomain(input.domain);
  const requestPath = normalizeApiRoutePath(input.apiPath);
  validateDisclosureInput(input, requestPath);
  const apiPath = requestPath === "" ? "wp-json" : `wp-json/${requestPath}`;
  const method = requestPath === "" ? "GET" : "OPTIONS";
  const response = await client.requestApiPath(requestPath, { method });
  const detail = input.detail ?? "overview";
  const selected = input.section === "arguments" || input.section === "fields";
  return {
    domain,
    apiPath,
    url: `https://${domain}/${apiPath}${requestPath === "" ? "/" : ""}`,
    method,
    detail,
    schema: selected ? selectApiDefinitions(response.data, input)
      : input.section === "routes" ? describeApiOverview(response.data, input, requestPath)
      : detail === "overview" ? describeApiOverview(response.data, input, requestPath)
      : detail === "full"
      ? response.data
      : requestPath === ""
        ? summarizeApiRouteIndex(response.data, input)
        : summarizeApiPathSchema(response.data),
    ...(detail === "overview" || selected ? {
      next: selected
        ? "Use names + detail=full for exact definitions (including nested constraints); use offset/limit for more entries."
        : requestPath === ""
          ? "Use search or section=routes with offset/limit to find routes; if the path is known, query apiPath directly. Replace route regex placeholders with concrete values."
          : "Use section=arguments + httpMethod, or section=fields, to list names; add names + detail=full for exact definitions."
    } : {})
  };
}
