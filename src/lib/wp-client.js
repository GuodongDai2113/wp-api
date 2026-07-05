function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function joinUrl(baseUrl, route, query) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/wp-json/wp/v2/${route}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function createAuthHeader(username, appPassword) {
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
}

export class WordPressApiError extends Error {
  constructor({ status, code, message, data }) {
    super(message);
    this.name = "WordPressApiError";
    this.status = status;
    this.code = code ?? "unknown_error";
    this.data = data ?? null;
  }
}

export class WordPressClient {
  constructor({ baseUrl, username, appPassword, fetchImpl, verbose = false, logger = console }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.username = username;
    this.appPassword = appPassword;
    this.fetchImpl = fetchImpl ?? fetch;
    this.verbose = verbose;
    this.logger = logger;
  }

  async request(route, { method = "GET", query, body } = {}) {
    const url = joinUrl(this.baseUrl, route, query);
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

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      throw new WordPressApiError({
        status: response.status,
        code: payload?.code,
        message: payload?.message ?? `Request failed with HTTP ${response.status}`,
        data: payload?.data
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

  async list(route, query) {
    const result = await this.request(route, { method: "GET", query });
    return {
      items: Array.isArray(result.data) ? result.data : [],
      pagination: result.pagination
    };
  }

  async get(route, id) {
    const result = await this.request(`${route}/${id}`);
    return result.data;
  }

  async create(route, body) {
    const result = await this.request(route, { method: "POST", body });
    return result.data;
  }

  async update(route, id, body) {
    const result = await this.request(`${route}/${id}`, { method: "POST", body });
    return result.data;
  }

  async delete(route, id, { force = false } = {}) {
    const result = await this.request(`${route}/${id}`, {
      method: "DELETE",
      query: force ? { force: true } : undefined
    });
    return result.data;
  }
}
