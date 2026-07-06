/** 规范化站点根地址，移除末尾斜杠。 */
function normalizeBaseUrl(baseUrl) {
    return baseUrl.replace(/\/+$/, "");
}
/** 拼接 WordPress REST API URL，并附加查询参数。 */
function joinApiUrl(baseUrl, apiPath, query) {
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
function createAuthHeader(username, appPassword) {
    return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
}
/** 判断未知值是否是对象。 */
function isObject(value) {
    return typeof value === "object" && value !== null;
}
/** 判断未知 payload 是否像 WordPress 错误响应。 */
function asWordPressErrorPayload(payload) {
    return isObject(payload) ? payload : {};
}
/** 将未知错误缩窄为可读取消息、错误码和 cause 的结构。 */
function asErrorWithCauseDetails(error) {
    return isObject(error) ? error : { message: String(error) };
}
/** 表示 WordPress REST API 返回的非 2xx 错误。 */
export class WordPressApiError extends Error {
    /** HTTP 状态码。 */
    status;
    /** WordPress 错误码。 */
    code;
    /** WordPress 错误附加数据。 */
    data;
    /** 创建一个 WordPress API 错误对象。 */
    constructor({ status, code, message, data }) {
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
    method;
    /** 请求 URL。 */
    url;
    /** 创建一个带请求上下文的网络错误对象。 */
    constructor({ method, url, cause }) {
        super(buildNetworkErrorMessage({ method, url, cause }));
        this.name = "WordPressNetworkError";
        this.method = method;
        this.url = url;
        this.cause = cause;
    }
}
/** 根据请求上下文和底层错误生成可读网络错误消息。 */
function buildNetworkErrorMessage({ method, url, cause }) {
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
    baseUrl;
    /** WordPress 用户名。 */
    username;
    /** WordPress Application Password。 */
    appPassword;
    /** 实际使用的 fetch 实现。 */
    fetchImpl;
    /** 是否输出请求日志。 */
    verbose;
    /** 日志对象。 */
    logger;
    /** 创建一个绑定到指定 WordPress 站点的 API client。 */
    constructor({ baseUrl, username, appPassword, fetchImpl, verbose = false, logger = console }) {
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.username = username;
        this.appPassword = appPassword;
        this.fetchImpl = fetchImpl ?? fetch;
        this.verbose = verbose;
        this.logger = logger;
    }
    /** 直接请求 `wp-json/` 下的指定 API path。 */
    async requestApiPath(apiPath, { method = "GET", query, body } = {}) {
        const url = joinApiUrl(this.baseUrl, apiPath, query);
        const headers = {
            Authorization: createAuthHeader(this.username, this.appPassword),
            Accept: "application/json"
        };
        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
        }
        if (this.verbose) {
            this.logger.error?.(`[wp-api] ${method} ${url}`);
        }
        let response;
        try {
            response = await this.fetchImpl(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        }
        catch (error) {
            throw new WordPressNetworkError({ method, url, cause: error });
        }
        const contentType = response.headers.get("content-type") ?? "";
        const isJson = contentType.includes("application/json");
        const payload = isJson ? await response.json() : await response.text();
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
            data: payload,
            pagination: {
                total: Number(response.headers.get("x-wp-total") ?? 0),
                totalPages: Number(response.headers.get("x-wp-totalpages") ?? 0)
            }
        };
    }
    /** 请求 WordPress `wp/v2` route。 */
    async request(route, options = {}) {
        return this.requestApiPath(`wp/v2/${route}`, options);
    }
    /** 列出某个 WordPress route 的资源，支持 `per_page=-1` 自动聚合全部分页。 */
    async list(route, query) {
        if (query?.per_page === -1) {
            const baseQuery = { ...query };
            delete baseQuery.page;
            const firstPage = await this.request(route, {
                method: "GET",
                query: {
                    ...baseQuery,
                    page: 1,
                    per_page: 100
                }
            });
            const items = Array.isArray(firstPage.data) ? [...firstPage.data] : [];
            for (let page = 2; page <= firstPage.pagination.totalPages; page += 1) {
                const nextPage = await this.request(route, {
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
        const result = await this.request(route, { method: "GET", query });
        return {
            items: Array.isArray(result.data) ? result.data : [],
            pagination: result.pagination
        };
    }
    /** 读取指定 ID 的单个资源。 */
    async get(route, id) {
        const result = await this.request(`${route}/${id}`);
        return result.data;
    }
    /** 创建资源。 */
    async create(route, body) {
        const result = await this.request(route, { method: "POST", body });
        return result.data;
    }
    /** 更新指定 ID 的资源。 */
    async update(route, id, body) {
        const result = await this.request(`${route}/${id}`, { method: "POST", body });
        return result.data;
    }
    /** 删除指定 ID 的资源。 */
    async delete(route, id, { force = false } = {}) {
        const result = await this.request(`${route}/${id}`, {
            method: "DELETE",
            query: force ? { force: true } : undefined
        });
        return result.data;
    }
}
