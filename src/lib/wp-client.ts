import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

/** WordPress REST 错误响应携带的扩展数据。 */
export type WordPressErrorData = Record<string, unknown> | null;

/** WordPress API 错误构造参数。 */
export interface WordPressApiErrorOptions {
  /** HTTP 状态码。 */
  status: number;
  /** WordPress 错误码。 */
  code?: string;
  /** WordPress 错误消息。 */
  message: string;
  /** WordPress 错误附加数据。 */
  data?: WordPressErrorData;
}

/** WordPress 网络错误构造参数。 */
export interface WordPressNetworkErrorOptions {
  /** HTTP 方法。 */
  method: string;
  /** 请求 URL。 */
  url: string;
  /** fetch 抛出的底层错误。 */
  cause: unknown;
}

/** WordPress 请求选项。 */
export interface RequestOptions {
  /** HTTP 方法。 */
  method?: string;
  /** 查询参数。 */
  query?: QueryParams;
  /** JSON 请求体。 */
  body?: unknown;
}

/** WordPress 媒体上传选项。 */
export interface UploadMediaOptions {
  /** 写入 WordPress 媒体库的标题。 */
  title?: string;
  /** 写入 WordPress 媒体库的替代文本。 */
  altText?: string;
  /** 写入 WordPress 媒体库的说明文字。 */
  caption?: string;
  /** 写入 WordPress 媒体库的描述。 */
  description?: string;
  /** 覆盖根据文件扩展名推断出的 MIME 类型。 */
  contentType?: string;
  /** 覆盖上传时发送给 WordPress 的文件名。 */
  filename?: string;
}

/** WordPress 媒体上传请求选项。 */
interface MediaUploadRequestOptions {
  /** HTTP 方法。 */
  method?: string;
  /** 额外请求头。 */
  headers?: Record<string, string>;
  /** 二进制请求体。 */
  body: BodyInit;
}

/** WordPress REST 查询参数。 */
export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/** WordPress 分页信息。 */
export interface Pagination {
  /** 匹配当前查询的总条目数。 */
  total: number;
  /** 匹配当前查询的总页数。 */
  totalPages: number;
}

/** WordPress REST 请求返回的底层结构。 */
export interface RequestResult<T = unknown> {
  /** WordPress 返回的数据。 */
  data: T;
  /** WordPress 分页响应头解析结果。 */
  pagination: Pagination;
}

/** WordPress 列表请求返回结构。 */
export interface ListResult<T = unknown> {
  /** 当前请求返回或聚合后的条目。 */
  items: T[];
  /** WordPress 分页响应头解析结果。 */
  pagination: Pagination;
}

/** WordPress client 构造参数。 */
export interface WordPressClientOptions {
  /** WordPress 站点根地址。 */
  baseUrl: string;
  /** WordPress 用户名。 */
  username: string;
  /** WordPress Application Password。 */
  appPassword: string;
  /** 可注入的 fetch 实现。 */
  fetchImpl?: typeof fetch;
  /** 是否输出请求日志。 */
  verbose?: boolean;
  /** 日志对象。 */
  logger?: Pick<Console, "error">;
}

/** WordPress REST 错误响应的常见 JSON 结构。 */
interface WordPressErrorPayload {
  /** WordPress 错误码。 */
  code?: string;
  /** WordPress 错误消息。 */
  message?: string;
  /** WordPress 错误附加数据。 */
  data?: WordPressErrorData;
}

/** 带可选 code 和 cause 字段的错误对象。 */
interface ErrorWithCauseDetails {
  /** 错误消息。 */
  message?: string;
  /** 错误码。 */
  code?: string;
  /** 底层错误。 */
  cause?: ErrorWithCauseDetails;
}

/** WordPress 媒体上传后需要读取 ID 的最小结构。 */
interface MediaWithId {
  /** WordPress 媒体附件 ID。 */
  id?: number;
}

/** 规范化站点根地址，移除末尾斜杠。 */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** 拼接 WordPress REST API URL，并附加查询参数。 */
function joinApiUrl(baseUrl: string, apiPath: string, query?: QueryParams): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/wp-json/${apiPath}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** 创建 WordPress Application Password Basic 认证头。 */
function createAuthHeader(username: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
}

/** 根据文件扩展名推断常见图片 MIME 类型。 */
function inferImageContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
  };

  return contentTypes[extension] ?? "application/octet-stream";
}

/** 转义 Content-Disposition 文件名中的特殊字符。 */
function escapeContentDispositionFilename(filename: string): string {
  return filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** 判断未知值是否是对象。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 判断未知 payload 是否像 WordPress 错误响应。 */
function asWordPressErrorPayload(payload: unknown): WordPressErrorPayload {
  return isObject(payload) ? payload : {};
}

/** 将未知错误缩窄为可读取消息、错误码和 cause 的结构。 */
function asErrorWithCauseDetails(error: unknown): ErrorWithCauseDetails {
  return isObject(error) ? error : { message: String(error) };
}

/** 从媒体上传结果中读取附件 ID，缺失时抛出明确错误。 */
function readMediaId(media: unknown): number {
  const id = isObject(media) ? (media as MediaWithId).id : undefined;
  if (typeof id !== "number" || !Number.isFinite(id)) {
    throw new Error("WordPress media upload response did not include a numeric id.");
  }
  return id;
}

/** 构造媒体附件元数据更新请求体。 */
function buildMediaMetadataBody(options: UploadMediaOptions): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      title: options.title,
      alt_text: options.altText,
      caption: options.caption,
      description: options.description
    }).filter(([, value]) => value !== undefined && value !== "")
  ) as Record<string, string>;
}

/** 读取 HTTP 响应体，并将空 JSON 响应规范化为 null。 */
async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return text;
  }
  return text === "" ? null : JSON.parse(text) as unknown;
}

/** 表示 WordPress REST API 返回的非 2xx 错误。 */
export class WordPressApiError extends Error {
  /** HTTP 状态码。 */
  status: number;
  /** WordPress 错误码。 */
  code: string;
  /** WordPress 错误附加数据。 */
  data: WordPressErrorData;

  /** 创建一个 WordPress API 错误对象。 */
  constructor({ status, code, message, data }: WordPressApiErrorOptions) {
    super(message);
    this.name = "WordPressApiError";
    this.status = status;
    this.code = code ?? "unknown_error";
    this.data = data ?? null;
  }
}

/** 表示 fetch 层面的网络或 TLS 错误。 */
export class WordPressNetworkError extends Error {
  /** HTTP 方法。 */
  method: string;
  /** 请求 URL。 */
  url: string;

  /** 创建一个带请求上下文的网络错误对象。 */
  constructor({ method, url, cause }: WordPressNetworkErrorOptions) {
    super(buildNetworkErrorMessage({ method, url, cause }));
    this.name = "WordPressNetworkError";
    this.method = method;
    this.url = url;
    this.cause = cause;
  }
}

/** 根据请求上下文和底层错误生成可读网络错误消息。 */
function buildNetworkErrorMessage({ method, url, cause }: WordPressNetworkErrorOptions): string {
  const normalizedCause = asErrorWithCauseDetails(cause);
  const parts = [`Request failed: ${method} ${url}`];

  if (normalizedCause.message) {
    parts.push(`Reason: ${normalizedCause.message}`);
  }

  if (normalizedCause.cause?.code || normalizedCause.code) {
    parts.push(`Code: ${normalizedCause.cause?.code ?? normalizedCause.code}`);
  }

  if (normalizedCause.cause?.message) {
    parts.push(`Cause: ${normalizedCause.cause.message}`);
  }

  if ((normalizedCause.cause?.code ?? normalizedCause.code)?.includes("CERT")) {
    parts.push("Hint: self-signed or untrusted TLS certificate. Try `NODE_OPTIONS=--use-system-ca` if the site CA is installed locally.");
  }

  return parts.join(" | ");
}

/** 使用原生 WordPress REST API 执行内容管理请求的 client。 */
export class WordPressClient {
  /** WordPress 站点根地址。 */
  baseUrl: string;
  /** WordPress 用户名。 */
  username: string;
  /** WordPress Application Password。 */
  appPassword: string;
  /** 实际使用的 fetch 实现。 */
  fetchImpl: typeof fetch;
  /** 是否输出请求日志。 */
  verbose: boolean;
  /** 日志对象。 */
  logger: Pick<Console, "error">;

  /** 创建一个绑定到指定 WordPress 站点的 API client。 */
  constructor({ baseUrl, username, appPassword, fetchImpl, verbose = false, logger = console }: WordPressClientOptions) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.username = username;
    this.appPassword = appPassword;
    this.fetchImpl = fetchImpl ?? fetch;
    this.verbose = verbose;
    this.logger = logger;
  }

  /** 直接请求 `wp-json/` 下的指定 API path。 */
  async requestApiPath<T = unknown>(apiPath: string, { method = "GET", query, body }: RequestOptions = {}): Promise<RequestResult<T>> {
    const url = joinApiUrl(this.baseUrl, apiPath, query);
    const headers: Record<string, string> = {
      Authorization: createAuthHeader(this.username, this.appPassword),
      Accept: "application/json"
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (this.verbose) {
      this.logger.error?.(`[wp-api] ${method} ${url}`);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new WordPressNetworkError({ method, url, cause: error });
    }

    const payload = await readResponsePayload(response);

    if (!response.ok) {
      const errorPayload = asWordPressErrorPayload(payload);
      throw new WordPressApiError({
        status: response.status,
        code: errorPayload.code,
        message: errorPayload.message ?? `Request failed with HTTP ${response.status}`,
        data: errorPayload.data
      });
    }

    return {
      data: payload as T,
      pagination: {
        total: Number(response.headers.get("x-wp-total") ?? 0),
        totalPages: Number(response.headers.get("x-wp-totalpages") ?? 0)
      }
    };
  }

  /** 直接请求 `wp-json/` 下的指定 API path，并发送非 JSON 请求体。 */
  async requestApiPathWithRawBody<T = unknown>(
    apiPath: string,
    { method = "POST", headers: extraHeaders, body }: MediaUploadRequestOptions
  ): Promise<RequestResult<T>> {
    const url = joinApiUrl(this.baseUrl, apiPath);
    const headers: Record<string, string> = {
      Authorization: createAuthHeader(this.username, this.appPassword),
      Accept: "application/json",
      ...extraHeaders
    };

    if (this.verbose) {
      this.logger.error?.(`[wp-api] ${method} ${url}`);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body
      });
    } catch (error) {
      throw new WordPressNetworkError({ method, url, cause: error });
    }

    const payload = await readResponsePayload(response);

    if (!response.ok) {
      const errorPayload = asWordPressErrorPayload(payload);
      throw new WordPressApiError({
        status: response.status,
        code: errorPayload.code,
        message: errorPayload.message ?? `Request failed with HTTP ${response.status}`,
        data: errorPayload.data
      });
    }

    return {
      data: payload as T,
      pagination: {
        total: Number(response.headers.get("x-wp-total") ?? 0),
        totalPages: Number(response.headers.get("x-wp-totalpages") ?? 0)
      }
    };
  }

  /** 请求 WordPress `wp/v2` route。 */
  async request<T = unknown>(route: string, options: RequestOptions = {}): Promise<RequestResult<T>> {
    return this.requestApiPath<T>(`wp/v2/${route}`, options);
  }

  /** 列出某个 WordPress route 的资源，支持 `per_page=-1` 自动聚合全部分页。 */
  async list<T = unknown>(route: string, query?: QueryParams): Promise<ListResult<T>> {
    if (query?.per_page === -1) {
      const baseQuery = { ...query };
      delete baseQuery.page;

      const firstPage = await this.request<T[]>(route, {
        method: "GET",
        query: {
          ...baseQuery,
          page: 1,
          per_page: 100
        }
      });

      const items = Array.isArray(firstPage.data) ? [...firstPage.data] : [];

      for (let page = 2; page <= firstPage.pagination.totalPages; page += 1) {
        const nextPage = await this.request<T[]>(route, {
          method: "GET",
          query: {
            ...baseQuery,
            page,
            per_page: 100
          }
        });

        if (Array.isArray(nextPage.data)) {
          items.push(...nextPage.data);
        }
      }

      return {
        items,
        pagination: firstPage.pagination
      };
    }

    const result = await this.request<T[]>(route, { method: "GET", query });
    return {
      items: Array.isArray(result.data) ? result.data : [],
      pagination: result.pagination
    };
  }

  /** 读取指定 ID 的单个资源。 */
  async get<T = unknown>(route: string, id: number): Promise<T> {
    const result = await this.request<T>(`${route}/${id}`);
    return result.data;
  }

  /** 创建资源。 */
  async create<T = unknown>(route: string, body: unknown): Promise<T> {
    const result = await this.request<T>(route, { method: "POST", body });
    return result.data;
  }

  /** 从本地路径读取文件，并上传到 WordPress 媒体库。 */
  async uploadMediaFromFile<T = unknown>(filePath: string, options: UploadMediaOptions = {}): Promise<T> {
    const fileBytes = await readFile(filePath);
    const filename = options.filename ?? basename(filePath);
    const result = await this.requestApiPathWithRawBody<T>("wp/v2/media", {
      method: "POST",
      headers: {
        "Content-Type": options.contentType ?? inferImageContentType(filePath),
        "Content-Disposition": `attachment; filename="${escapeContentDispositionFilename(filename)}"`
      },
      body: fileBytes
    });
    const metadataBody = buildMediaMetadataBody(options);

    if (Object.keys(metadataBody).length === 0) {
      return result.data;
    }

    const mediaId = readMediaId(result.data);
    const updated = await this.update<T>("media", mediaId, metadataBody);
    return updated;
  }

  /** 更新指定 ID 的资源。 */
  async update<T = unknown>(route: string, id: number, body: unknown): Promise<T> {
    const result = await this.request<T>(`${route}/${id}`, { method: "POST", body });
    return result.data;
  }

  /** 删除指定 ID 的资源。 */
  async delete<T = unknown>(route: string, id: number, { force = false }: { force?: boolean } = {}): Promise<T> {
    const result = await this.request<T>(`${route}/${id}`, {
      method: "DELETE",
      query: force ? { force: true } : undefined
    });
    return result.data;
  }
}
