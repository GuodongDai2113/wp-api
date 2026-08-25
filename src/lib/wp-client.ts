import { open } from "node:fs/promises";
import { lookup as lookupHostname } from "node:dns/promises";
import { isIP } from "node:net";
import { basename, extname } from "node:path";

import { prepareMediaImage } from "./image-compression.js";

/** 单次 WordPress 请求默认允许等待的最长时间。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** 单个 WordPress REST 响应体默认允许占用的最大字节数。 */
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

/** 单个本地媒体文件默认允许读取的最大字节数。 */
const DEFAULT_MAX_MEDIA_FILE_BYTES = 50 * 1024 * 1024;

/** 单个本地或远程插件、主题包默认允许读取的最大字节数。 */
const DEFAULT_MAX_PACKAGE_FILE_BYTES = 100 * 1024 * 1024;

/** 远程插件下载默认允许跟随的最大重定向次数。 */
const DEFAULT_MAX_REMOTE_REDIRECTS = 3;

/** `per_page=-1` 聚合模式默认允许请求的最大分页数。 */
const DEFAULT_MAX_PAGINATION_PAGES = 100;

/** `per_page=-1` 聚合模式默认允许保留的近似 JSON 字节数。 */
const DEFAULT_MAX_AGGREGATED_LIST_BYTES = 50 * 1024 * 1024;

/** 媒体上传允许使用的常见位图扩展名及对应 MIME 类型。 */
const ALLOWED_MEDIA_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
});

/** WordPress REST 错误响应携带的扩展数据。 */
export type WordPressErrorData = Record<string, unknown> | null;

/** DNS 解析器返回的单个地址记录。 */
export interface ResolvedHostnameAddress {
  /** 解析得到的 IPv4 或 IPv6 地址。 */
  address: string;
  /** 地址族，通常为 4 或 6。 */
  family: number;
}

/** 远程插件下载使用的主机名解析函数。 */
export type RemoteHostnameResolver = (hostname: string) => Promise<readonly ResolvedHostnameAddress[]>;

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
  /** 自定义请求头，与默认头合并。 */
  headers?: Record<string, string>;
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
  /** 覆盖根据文件扩展名推断出的源 MIME 类型；JPEG/PNG 转换后固定使用 image/webp。 */
  contentType?: string;
  /** 覆盖上传时发送给 WordPress 的文件名；JPEG/PNG 转换后扩展名固定为 .webp。 */
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
  /** WordPress 应用密码。 */
  appPassword: string;
  /** 可注入的 fetch 实现。 */
  fetchImpl?: typeof fetch;
  /** 是否输出请求日志。 */
  verbose?: boolean;
  /** 日志对象。 */
  logger?: Pick<Console, "error">;
  /** 单次网络请求的超时时间（毫秒），默认 30 秒。 */
  requestTimeoutMs?: number;
  /** 单个 WordPress REST 响应体允许读取的最大字节数，默认 25 MiB。 */
  maxResponseBytes?: number;
  /** 单个本地媒体文件允许读取的最大字节数，默认 50 MiB。 */
  maxMediaFileBytes?: number;
  /** 单个本地或远程插件、主题包允许读取的最大字节数，默认 100 MiB。 */
  maxPackageFileBytes?: number;
  /** 远程插件下载允许跟随的最大重定向次数，默认 3 次。 */
  maxRemoteRedirects?: number;
  /** `per_page=-1` 聚合模式允许请求的最大分页数，默认 100 页。 */
  maxPaginationPages?: number;
  /** `per_page=-1` 聚合结果允许保留的近似 JSON 字节数，默认 50 MiB。 */
  maxAggregatedListBytes?: number;
  /** 远程插件下载使用的可注入 DNS 解析器，主要用于受控网络策略和测试。 */
  remoteHostnameResolver?: RemoteHostnameResolver;
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

/** 校验并规范化 WordPress 站点根地址，允许 HTTP 或 HTTPS。 */
export function normalizeWordPressBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError(`WordPress base URL is invalid: ${baseUrl}`);
  }

  if (url.username || url.password) {
    throw new TypeError("WordPress base URL must not include embedded credentials.");
  }
  if (url.search || url.hash) {
    throw new TypeError("WordPress base URL must not include a query string or fragment.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("WordPress base URL must use HTTP or HTTPS.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

/** 拼接 WordPress REST API URL，并附加查询参数。 */
function joinApiUrl(baseUrl: string, apiPath: string, query?: QueryParams): string {
  const apiRoot = new URL(`${normalizeWordPressBaseUrl(baseUrl)}/wp-json/`);
  const url = new URL(`${apiRoot.toString()}${apiPath}`);
  if (url.origin !== apiRoot.origin || !url.pathname.startsWith(apiRoot.pathname)) {
    throw new TypeError("WordPress API path must remain inside the wp-json root.");
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** 创建 WordPress 应用密码的 Basic 认证头。 */
function createAuthHeader(username: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
}

/** 构造认证请求头，并阻止额外请求头以任意大小写覆盖凭据和固定的响应类型。 */
function buildAuthenticatedHeaders(
  username: string,
  appPassword: string,
  extraHeaders: Record<string, string> | undefined,
  jsonBody: boolean
): Record<string, string> {
  const headers = Object.fromEntries(
    Object.entries(extraHeaders ?? {}).filter(([name]) => {
      const normalizedName = name.toLowerCase();
      return normalizedName !== "authorization"
        && normalizedName !== "accept"
        && !(jsonBody && normalizedName === "content-type");
    })
  );
  headers.Authorization = createAuthHeader(username, appPassword);
  headers.Accept = "application/json";
  if (jsonBody) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

/**
 * 构造 Jelly Core 旧版协议要求的兼容请求头。
 * 该值不包含秘密，不能替代 WordPress 应用密码与服务端权限校验。
 */
function buildJellyCompatibilityHeaders(): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "X-Jelly-Timestamp": timestamp,
    "X-Jelly-Signature": Buffer.from(`jellycore${timestamp}`).toString("base64")
  };
}

/** 根据白名单内的位图扩展名返回 MIME 类型，拒绝 SVG 和其他未知文件。 */
function inferImageContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  const contentType = ALLOWED_MEDIA_CONTENT_TYPES[extension];
  if (!contentType) {
    throw new Error("Media file must use one of these bitmap extensions: .avif, .gif, .jpeg, .jpg, .png, .webp.");
  }
  return contentType;
}

/** 校验显式媒体 MIME 覆盖仍属于允许的位图类型，避免把附件作为主动内容提供。 */
function validateMediaContentType(contentType: string | undefined, inferredContentType: string): string {
  if (contentType === undefined) {
    return inferredContentType;
  }
  if (!Object.values(ALLOWED_MEDIA_CONTENT_TYPES).includes(contentType.toLowerCase())) {
    throw new Error("Media content type must be a supported bitmap image MIME type.");
  }
  return contentType;
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

/** 校验并规范化要求为正整数的 client 限额选项。 */
function normalizePositiveInteger(value: number | undefined, fallback: number, optionName: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${optionName} must be a positive safe integer.`);
  }
  return normalized;
}

/** 校验并规范化允许为零的非负整数 client 限额选项。 */
function normalizeNonNegativeInteger(value: number | undefined, fallback: number, optionName: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${optionName} must be a non-negative safe integer.`);
  }
  return normalized;
}

/** 为不直接接受 AbortSignal 的异步操作附加超时拒绝，避免 DNS 等准备阶段无限等待。 */
async function waitWithinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return new Promise<T>((resolve, reject) => {
    /** 在超时触发时使用平台提供的 TimeoutError 拒绝等待。 */
    const handleTimeout = (): void => reject(timeoutSignal.reason);
    timeoutSignal.addEventListener("abort", handleTimeout, { once: true });
    operation.then(
      (value) => {
        timeoutSignal.removeEventListener("abort", handleTimeout);
        resolve(value);
      },
      (error: unknown) => {
        timeoutSignal.removeEventListener("abort", handleTimeout);
        reject(error);
      }
    );
  });
}

/** 将 WordPress 分页响应头解析为非负安全整数，缺失时返回零。 */
function parsePaginationHeader(value: string | null, headerName: string): number {
  if (value === null || value === "") {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`WordPress returned an invalid ${headerName} pagination header.`);
  }
  return parsed;
}

/** 判断 HTTP 状态码是否表示可能触发 fetch 自动跳转的重定向。 */
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** 判断规范化后的 IPv4 地址是否属于不可用于远程包下载的非公网范围。 */
function isNonPublicIpv4Address(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

/** 判断规范化后的 IPv6 地址是否属于不可用于远程包下载的非公网范围。 */
function isNonPublicIpv6Address(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:")) {
    return true;
  }

  const firstHextet = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  return (firstHextet & 0xfe00) === 0xfc00
    || (firstHextet & 0xffc0) === 0xfe80
    || (firstHextet & 0xff00) === 0xff00;
}

/** 判断 URL 主机是否显然指向 localhost、局域网名称或非公网 IP。 */
function isObviouslyPrivateHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (
    normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".lan")
    || normalized === "home.arpa"
    || normalized.endsWith(".home.arpa")
  ) {
    return true;
  }

  const ipVersion = isIP(normalized);
  return (ipVersion === 4 && isNonPublicIpv4Address(normalized))
    || (ipVersion === 6 && isNonPublicIpv6Address(normalized));
}

/** 使用系统 DNS 获取主机的全部地址，以便在下载前执行网络边界检查。 */
async function defaultRemoteHostnameResolver(hostname: string): Promise<readonly ResolvedHostnameAddress[]> {
  return lookupHostname(hostname, { all: true, verbatim: true });
}

/** 解析并校验远程插件包 URL 的协议、凭据和显然不安全的目标主机。 */
function validateRemotePackageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Remote plugin URL is invalid: ${value}`);
  }

  if (url.protocol !== "https:") {
    throw new TypeError("Remote plugin URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new TypeError("Remote plugin URL must not include embedded credentials.");
  }
  if (isObviouslyPrivateHostname(url.hostname)) {
    throw new TypeError("Remote plugin URL must not target localhost or a private network address.");
  }
  return url;
}

/** 校验本地插件或主题包的文件名必须使用 `.zip` 扩展名。 */
function assertZipFilename(filePath: string, packageKind: string): void {
  if (extname(filePath).toLowerCase() !== ".zip") {
    throw new Error(`${packageKind} package must be a .zip file.`);
  }
}

/** 校验插件或主题包的内容具有常见 ZIP 文件头，避免仅依赖扩展名。 */
function assertZipSignature(data: Buffer, packageKind: string): void {
  const hasZipSignature = data.length >= 4
    && data[0] === 0x50
    && data[1] === 0x4b
    && (
      (data[2] === 0x03 && data[3] === 0x04)
      || (data[2] === 0x05 && data[3] === 0x06)
      || (data[2] === 0x07 && data[3] === 0x08)
    );
  if (!hasZipSignature) {
    throw new Error(`${packageKind} package is not a valid ZIP file.`);
  }
}

/** 在读取前后检查本地普通文件大小，并返回不超过指定上限的字节。 */
async function readLocalFileWithinLimit(filePath: string, maxBytes: number, fileKind: string): Promise<Buffer> {
  const fileHandle = await open(filePath, "r");
  try {
    const fileStats = await fileHandle.stat();
    if (!fileStats.isFile()) {
      throw new Error(`${fileKind} path must point to a regular file: ${filePath}`);
    }
    if (fileStats.size > maxBytes) {
      throw new Error(`${fileKind} exceeds the maximum allowed size of ${maxBytes} bytes.`);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithOverflowByte = maxBytes - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remainingWithOverflowByte));
      const { bytesRead } = await fileHandle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) {
        return Buffer.concat(chunks, totalBytes);
      }
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new Error(`${fileKind} exceeds the maximum allowed size of ${maxBytes} bytes.`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await fileHandle.close();
  }
}

/** 从 URL 路径中提取安全的 ZIP 文件名，无法提取时使用固定后备名称。 */
function readRemotePackageFilename(url: URL): string {
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // URL 路径包含不可解码的转义序列时保留规范化后的原始路径。
  }
  const filename = basename(pathname);
  return extname(filename).toLowerCase() === ".zip" ? filename : "plugin.zip";
}

/** 在内容长度头和实际流读取两个层面限制 HTTP 响应体大小。 */
async function readResponseBytes(response: Response, maxBytes: number, bodyKind: string): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`${bodyKind} exceeds the maximum allowed size of ${maxBytes} bytes.`);
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // 超限错误优先于取消响应流时产生的次要错误。
        }
        throw new Error(`${bodyKind} exceeds the maximum allowed size of ${maxBytes} bytes.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

/** 主动取消不需要读取的 HTTP 响应体，并忽略连接回收阶段的次要错误。 */
async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 调用方即将报告更明确的状态码或重定向错误。
  }
}

/** 受限读取 HTTP 响应体，并将空 JSON 响应规范化为 null。 */
async function readResponsePayload(response: Response, maxBytes: number): Promise<unknown> {
  const text = (await readResponseBytes(response, maxBytes, "WordPress response body")).toString("utf8");
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
  /** WordPress 应用密码。 */
  appPassword: string;
  /** 实际使用的 fetch 实现。 */
  fetchImpl: typeof fetch;
  /** 是否输出请求日志。 */
  verbose: boolean;
  /** 日志对象。 */
  logger: Pick<Console, "error">;
  /** 单次网络请求的超时时间（毫秒）。 */
  requestTimeoutMs: number;
  /** 单个 WordPress REST 响应体允许读取的最大字节数。 */
  maxResponseBytes: number;
  /** 单个本地媒体文件允许读取的最大字节数。 */
  maxMediaFileBytes: number;
  /** 单个本地或远程插件、主题包允许读取的最大字节数。 */
  maxPackageFileBytes: number;
  /** 远程插件下载允许跟随的最大重定向次数。 */
  maxRemoteRedirects: number;
  /** `per_page=-1` 聚合模式允许请求的最大分页数。 */
  maxPaginationPages: number;
  /** `per_page=-1` 聚合结果允许保留的近似 JSON 字节数。 */
  maxAggregatedListBytes: number;
  /** 远程插件下载使用的主机名解析函数。 */
  remoteHostnameResolver: RemoteHostnameResolver;

  /** 创建一个绑定到指定 WordPress 站点的 API client。 */
  constructor({
    baseUrl,
    username,
    appPassword,
    fetchImpl,
    verbose = false,
    logger = console,
    requestTimeoutMs,
    maxResponseBytes,
    maxMediaFileBytes,
    maxPackageFileBytes,
    maxRemoteRedirects,
    maxPaginationPages,
    maxAggregatedListBytes,
    remoteHostnameResolver
  }: WordPressClientOptions) {
    this.baseUrl = normalizeWordPressBaseUrl(baseUrl);
    this.username = username;
    this.appPassword = appPassword;
    this.fetchImpl = fetchImpl ?? fetch;
    this.verbose = verbose;
    this.logger = logger;
    this.requestTimeoutMs = normalizePositiveInteger(requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, "requestTimeoutMs");
    this.maxResponseBytes = normalizePositiveInteger(maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, "maxResponseBytes");
    this.maxMediaFileBytes = normalizePositiveInteger(maxMediaFileBytes, DEFAULT_MAX_MEDIA_FILE_BYTES, "maxMediaFileBytes");
    this.maxPackageFileBytes = normalizePositiveInteger(maxPackageFileBytes, DEFAULT_MAX_PACKAGE_FILE_BYTES, "maxPackageFileBytes");
    this.maxRemoteRedirects = normalizeNonNegativeInteger(maxRemoteRedirects, DEFAULT_MAX_REMOTE_REDIRECTS, "maxRemoteRedirects");
    this.maxPaginationPages = normalizePositiveInteger(maxPaginationPages, DEFAULT_MAX_PAGINATION_PAGES, "maxPaginationPages");
    this.maxAggregatedListBytes = normalizePositiveInteger(
      maxAggregatedListBytes,
      DEFAULT_MAX_AGGREGATED_LIST_BYTES,
      "maxAggregatedListBytes"
    );
    this.remoteHostnameResolver = remoteHostnameResolver ?? defaultRemoteHostnameResolver;
  }

  /** 使用统一超时和手动重定向策略执行单次网络请求。 */
  private async fetchWithLimits(url: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(this.requestTimeoutMs)
    });
  }

  /** 拒绝认证请求收到的重定向，确保 Authorization 不会被自动带到其他 origin。 */
  private async assertAuthenticatedRequestDidNotRedirect(response: Response, url: string): Promise<void> {
    if (!isRedirectStatus(response.status)) {
      return;
    }
    await discardResponseBody(response);
    throw new WordPressApiError({
      status: response.status,
      code: "unsafe_redirect",
      message: "Authenticated WordPress requests do not follow redirects. Configure the canonical site URL instead.",
      data: {
        requestUrl: url,
        location: response.headers.get("location")
      }
    });
  }

  /**
   * 在每次远程包请求前确认 DNS 当前解析结果均为公网地址。
   * 该检查能阻止常见 SSRF 目标，但 fetch 会独立进行 DNS 解析，因此无法完全消除解析与连接之间的 DNS 重绑定竞态。
   */
  private async assertRemotePackageHostIsPublic(url: URL): Promise<void> {
    let addresses: readonly ResolvedHostnameAddress[];
    try {
      addresses = await waitWithinTimeout(
        this.remoteHostnameResolver(url.hostname.replace(/^\[|\]$/g, "")),
        this.requestTimeoutMs
      );
    } catch (error) {
      throw new WordPressNetworkError({ method: "DNS", url: url.toString(), cause: error });
    }
    if (addresses.length === 0) {
      throw new Error(`Remote plugin host did not resolve to an IP address: ${url.hostname}`);
    }
    for (const { address } of addresses) {
      if (isIP(address) === 0 || isObviouslyPrivateHostname(address)) {
        throw new Error(`Remote plugin host resolved to a non-public address: ${address}`);
      }
    }
  }

  /** 直接请求 `wp-json/` 下的指定 API path。 */
  async requestApiPath<T = unknown>(apiPath: string, { method = "GET", query, body, headers: extraHeaders }: RequestOptions = {}): Promise<RequestResult<T>> {
    const url = joinApiUrl(this.baseUrl, apiPath, query);
    const headers = buildAuthenticatedHeaders(this.username, this.appPassword, extraHeaders, body !== undefined);

    if (this.verbose) {
      this.logger.error?.(`[wp-api] ${method} ${url}`);
    }

    let response: Response;
    try {
      response = await this.fetchWithLimits(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new WordPressNetworkError({ method, url, cause: error });
    }

    await this.assertAuthenticatedRequestDidNotRedirect(response, url);
    const payload = await readResponsePayload(response, this.maxResponseBytes);

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
        total: parsePaginationHeader(response.headers.get("x-wp-total"), "X-WP-Total"),
        totalPages: parsePaginationHeader(response.headers.get("x-wp-totalpages"), "X-WP-TotalPages")
      }
    };
  }

  /** 直接请求 `wp-json/` 下的指定 API path，并发送非 JSON 请求体。 */
  async requestApiPathWithRawBody<T = unknown>(
    apiPath: string,
    { method = "POST", headers: extraHeaders, body }: MediaUploadRequestOptions
  ): Promise<RequestResult<T>> {
    const url = joinApiUrl(this.baseUrl, apiPath);
    const headers = buildAuthenticatedHeaders(this.username, this.appPassword, extraHeaders, false);

    if (this.verbose) {
      this.logger.error?.(`[wp-api] ${method} ${url}`);
    }

    let response: Response;
    try {
      response = await this.fetchWithLimits(url, {
        method,
        headers,
        body
      });
    } catch (error) {
      throw new WordPressNetworkError({ method, url, cause: error });
    }

    await this.assertAuthenticatedRequestDidNotRedirect(response, url);
    const payload = await readResponsePayload(response, this.maxResponseBytes);

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
        total: parsePaginationHeader(response.headers.get("x-wp-total"), "X-WP-Total"),
        totalPages: parsePaginationHeader(response.headers.get("x-wp-totalpages"), "X-WP-TotalPages")
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
      let aggregatedBytes = Buffer.byteLength(JSON.stringify(items), "utf8");
      if (aggregatedBytes > this.maxAggregatedListBytes) {
        throw new Error(
          `WordPress aggregated list exceeds the configured limit of ${this.maxAggregatedListBytes} bytes.`
        );
      }

      if (firstPage.pagination.totalPages > this.maxPaginationPages) {
        throw new Error(
          `WordPress pagination requires ${firstPage.pagination.totalPages} pages, exceeding the configured limit of ${this.maxPaginationPages}.`
        );
      }

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
          aggregatedBytes += Buffer.byteLength(JSON.stringify(nextPage.data), "utf8");
          if (aggregatedBytes > this.maxAggregatedListBytes) {
            throw new Error(
              `WordPress aggregated list exceeds the configured limit of ${this.maxAggregatedListBytes} bytes.`
            );
          }
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

  /** 读取指定 ID 的单个资源，并允许传入上下文等查询参数。 */
  async get<T = unknown>(route: string, id: number, query?: QueryParams): Promise<T> {
    const result = await this.request<T>(`${route}/${id}`, { query });
    return result.data;
  }

  /** 创建资源。 */
  async create<T = unknown>(route: string, body: unknown): Promise<T> {
    const result = await this.request<T>(route, { method: "POST", body });
    return result.data;
  }

  /** 从本地路径读取图片，按需压缩为 WebP 后上传到 WordPress 媒体库。 */
  async uploadMediaFromFile<T = unknown>(filePath: string, options: UploadMediaOptions = {}): Promise<T> {
    const filename = options.filename ?? basename(filePath);
    const inferredContentType = inferImageContentType(filePath);
    inferImageContentType(filename);
    const contentType = validateMediaContentType(options.contentType, inferredContentType);
    const fileBytes = await readLocalFileWithinLimit(filePath, this.maxMediaFileBytes, "Media file");
    const preparedImage = await prepareMediaImage(fileBytes, filename, inferredContentType);
    const result = await this.requestApiPathWithRawBody<T>("wp/v2/media", {
      method: "POST",
      headers: {
        "Content-Type": preparedImage.convertedToWebp ? preparedImage.contentType : contentType,
        "Content-Disposition": `attachment; filename="${escapeContentDispositionFilename(preparedImage.filename)}"`
      },
      body: preparedImage.bytes as BodyInit
    });
    const metadataBody = buildMediaMetadataBody(options);

    if (Object.keys(metadataBody).length === 0) {
      return result.data;
    }

    const mediaId = readMediaId(result.data);
    try {
      return await this.update<T>("media", mediaId, metadataBody);
    } catch (error) {
      try {
        await this.delete("media", mediaId, { force: true });
      } catch {
        // 元数据更新错误优先于清理孤立附件时产生的次要错误。
      }
      throw error;
    }
  }

  /** 使用 jelly-core REST API 从远程包 URL 安装或更新插件。 */
  async jellyCorePluginInstall<T = unknown>(pluginSlug: string, packageUrl: string): Promise<T> {
    const result = await this.requestApiPath<T>("jelly-core/v1/plugins/update", {
      method: "POST",
      body: { plugin_name: pluginSlug, package_url: packageUrl },
      headers: buildJellyCompatibilityHeaders()
    });
    return result.data;
  }

  /** 从本地 .zip 文件上传到媒体库，再通过 jelly-core 安装或更新插件。 */
  async uploadPluginFromFile<T = unknown>(filePath: string): Promise<T> {
    assertZipFilename(filePath, "Plugin");
    const fileBytes = await readLocalFileWithinLimit(filePath, this.maxPackageFileBytes, "Plugin package");
    assertZipSignature(fileBytes, "Plugin");
    const filename = basename(filePath);
    return this.installPluginZipViaMedia<T>(fileBytes, filename);
  }

  /** 读取本地主题 ZIP 文件并直接推送到 jelly-core 安装或覆盖更新。 */
  async uploadThemeFromFile<T = unknown>(filePath: string): Promise<T> {
    assertZipFilename(filePath, "Theme");
    const fileBytes = await readLocalFileWithinLimit(filePath, this.maxPackageFileBytes, "Theme package");
    assertZipSignature(fileBytes, "Theme");
    const filename = basename(filePath);

    const themeSlug = filename.replace(/\.zip$/i, "");
    const result = await this.requestApiPathWithRawBody<T>("jelly-core/v1/themes/install", {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${escapeContentDispositionFilename(filename)}"`,
        "X-Jelly-Theme-Slug": themeSlug,
        ...buildJellyCompatibilityHeaders()
      },
      body: fileBytes as BodyInit
    });

    return result.data;
  }

  /** 通过 jelly-core 激活或切换主题状态。 */
  async updateThemeStatus<T = unknown>(
    themeSlug: string,
    status: "active" | "inactive",
    replacementTheme?: string
  ): Promise<T> {
    const result = await this.requestApiPath<T>(
      `jelly-core/v1/themes/${encodeURIComponent(themeSlug)}/status`,
      {
        method: "POST",
        body: {
          status,
          ...(replacementTheme ? { replacement_theme: replacementTheme } : {})
        },
        headers: buildJellyCompatibilityHeaders()
      }
    );

    return result.data;
  }

  /** 从远程 URL 下载 .zip 文件，再通过 jelly-core 安装或更新插件。 */
  async installPluginFromUrl<T = unknown>(url: string): Promise<T> {
    let currentUrl = validateRemotePackageUrl(url);
    let redirectCount = 0;

    while (true) {
      await this.assertRemotePackageHostIsPublic(currentUrl);
      let response: Response;
      try {
        response = await this.fetchWithLimits(currentUrl.toString(), {
          method: "GET",
          headers: { Accept: "application/zip" }
        });
      } catch (error) {
        throw new WordPressNetworkError({ method: "GET", url: currentUrl.toString(), cause: error });
      }

      if (isRedirectStatus(response.status)) {
        await discardResponseBody(response);
        if (redirectCount >= this.maxRemoteRedirects) {
          throw new Error(`Remote plugin download exceeded ${this.maxRemoteRedirects} redirects.`);
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Remote plugin download returned HTTP ${response.status} without a Location header.`);
        }
        currentUrl = validateRemotePackageUrl(new URL(location, currentUrl).toString());
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        await discardResponseBody(response);
        throw new Error(`Failed to download plugin from ${currentUrl.toString()}: HTTP ${response.status}`);
      }

      const fileBytes = await readResponseBytes(response, this.maxPackageFileBytes, "Remote plugin package");
      assertZipSignature(fileBytes, "Plugin");
      const filename = readRemotePackageFilename(currentUrl);
      return this.installPluginZipViaMedia<T>(fileBytes, filename);
    }
  }

  /** 上传 zip 到媒体库获取 URL，再调用 jelly-core 安装。 */
  private async installPluginZipViaMedia<T = unknown>(data: Buffer, filename: string): Promise<T> {
    assertZipFilename(filename, "Plugin");
    assertZipSignature(data, "Plugin");
    if (data.byteLength > this.maxPackageFileBytes) {
      throw new Error(`Plugin package exceeds the maximum allowed size of ${this.maxPackageFileBytes} bytes.`);
    }
    const mediaResult = await this.requestApiPathWithRawBody<{ id: number; source_url?: string }>("wp/v2/media", {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${escapeContentDispositionFilename(filename)}"`
      },
      body: data as BodyInit
    });
    const media = mediaResult.data;
    const mediaId = media.id;
    const packageUrl = media.source_url;

    if (!packageUrl) {
      throw new Error("Media upload did not return a source URL.");
    }

    const pluginSlug = filename.replace(/\.zip$/i, "");

    try {
      return await this.jellyCorePluginInstall<T>(pluginSlug, packageUrl);
    } finally {
      try {
        await this.delete("media", mediaId, { force: true });
      } catch {
        // 忽略媒体清理错误
      }
    }
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
