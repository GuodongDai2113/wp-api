function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

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

export class WordPressNetworkError extends Error {
  constructor({ method, url, cause }) {
    super(buildNetworkErrorMessage({ method, url, cause }));
    this.name = "WordPressNetworkError";
    this.method = method;
    this.url = url;
    this.cause = cause;
  }
}

function buildNetworkErrorMessage({ method, url, cause }) {
  const parts = [`Request failed: ${method} ${url}`];

  if (cause?.message) {
    parts.push(`Reason: ${cause.message}`);
  }

  if (cause?.cause?.code || cause?.code) {
    parts.push(`Code: ${cause.cause?.code ?? cause.code}`);
  }

  if (cause?.cause?.message) {
    parts.push(`Cause: ${cause.cause.message}`);
  }

  if ((cause?.cause?.code ?? cause?.code)?.includes("CERT")) {
    parts.push("Hint: self-signed or untrusted TLS certificate. Try `NODE_OPTIONS=--use-system-ca` if the site CA is installed locally.");
  }

  return parts.join(" | ");
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
    } catch (error) {
      throw new WordPressNetworkError({ method, url, cause: error });
    }

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

  async request(route, options) {
    return this.requestApiPath(`wp/v2/${route}`, options);
  }

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
