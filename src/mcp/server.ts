import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { executeWpApiTool, type WpApiToolContext, type WpApiToolInput, type WpApiToolName } from "./wp-api-tools.js";
import { normalizeRestApiDomain } from "./handlers/api-schema-tools.js";
import { WP_STRUCTURE_NAMES, WP_STRUCTURE_SECTIONS } from "./handlers/structure-tools.js";

/** 判断站点地址是否是适合作为 WordPress 根地址的 HTTP(S) URL。 */
function isSafeSiteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:")
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

/** 判断 MCP 分页大小是否符合 WordPress REST 的单页上限。 */
function isValidPerPage(value: number): boolean {
  return value >= 1 && value <= 100;
}

/** WordPress 站点根地址的 MCP 校验 schema。 */
const siteUrlSchema = z.string().url().refine(
  isSafeSiteUrl,
  "WordPress site URL must use HTTP or HTTPS and cannot contain credentials, a query, or a fragment."
);

/** `wp_rest_api` 使用的裸域名 schema，固定由服务端拼接 HTTPS 和 REST 路径。 */
const restApiDomainSchema = z.string().refine(
  (value) => {
    try {
      normalizeRestApiDomain(value);
      return true;
    } catch {
      return false;
    }
  },
  "Domain must be a bare hostname such as example.com, without https://, a port, credentials, path, query, or fragment."
);

/** WordPress 原生 REST 资源名称的 MCP 校验 schema。 */
const resourceSchema = z.enum(["posts", "pages", "products", "categories", "product-categories"]);

/** WordPress post 类型资源名称 schema。 */
const postResourceSchema = z.enum(["posts", "pages", "products"]);

/** WordPress taxonomy 类型资源名称 schema。 */
const taxonomyResourceSchema = z.enum(["categories", "product-categories"]);

/** 使用 type 判别 post 与 taxonomy 的资源目标 schema。 */
const resourceTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("post"),
    resource: postResourceSchema
  }).strict(),
  z.object({
    type: z.literal("taxonomy"),
    resource: taxonomyResourceSchema
  }).strict()
]);

/** MCP 工具统一返回结构的 schema。 */
const outputSchema = {
  result: z.unknown()
};

/** 所有 MCP 工具的副作用、幂等性和外部交互提示。 */
export const WP_API_TOOL_ANNOTATIONS = {
  wp_client_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  wp_client_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  wp_structure_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  wp_rest_api: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_resource_count: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_resource_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_resource_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_resource_create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  wp_resource_batch_create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  wp_resource_update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_resource_batch_update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_resource_delete: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  wp_seo_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_seo_update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_seo_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_seo_batch_update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_post_link: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  wp_post_content_replace: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  wp_media_upload: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  wp_elementor_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_elementor_update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_elementor_import: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_package_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_package_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_package_install: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  wp_package_update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_package_activate: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_package_deactivate: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_package_pack_theme: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  wp_package_pack_plugin: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  wp_jelly_form_settings_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_jelly_form_settings_update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_jelly_form_inquiry_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_jelly_form_inquiry_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
} satisfies Record<WpApiToolName, ToolAnnotations>;

/** 不执行 trim 转换、但拒绝空字符串和纯空白字符串的 MCP schema。 */
const nonBlankStringSchema = z.string().min(1).refine(
  (value) => value.trim().length > 0,
  "Value must contain at least one non-whitespace character."
);

/** 所有需要连接 WordPress 站点的工具都支持的通用输入字段。 */
const globalInputShape = {
  client: nonBlankStringSchema.describe("Required saved wp-api client name to use for this call."),
  siteUrl: siteUrlSchema.optional().describe("Temporary same-origin site URL override for this call.")
};

/** Post 类型资源 create/update 使用的输入字段。 */
const postResourceBodyShape = {
  title: z.string().optional().describe("Post, page, or product title."),
  slug: z.string().optional().describe("Resource slug."),
  status: z.string().optional().describe("Post, page, or product status."),
  excerpt: z.string().optional().describe("Post, page, or product excerpt."),
  content: z.string().optional().describe("Post, page, or product body content."),
  contentFile: z.string().optional().describe("Local content file path readable by the MCP server process."),
  // 是否在上传前把解析出的 HTML 正文转换为 Gutenberg 区块标记。
  gutenberg: z.boolean().optional().describe("Convert resolved HTML content to WordPress Gutenberg block markup before upload."),
  featuredMedia: z.number().int().nonnegative().optional().describe("Featured media attachment ID; use 0 to clear the current featured image."),
  categories: z.array(z.number().int().positive()).optional().describe("Category IDs. Maps to categories for posts and product_cat for products; use an empty array to clear assignments. Not supported by pages."),
  meta: z.record(z.unknown()).optional().describe("Registered WordPress REST meta fields. Inspect the resource route with wp_rest_api before writing plugin-specific fields."),
  metaFile: nonBlankStringSchema.optional().describe("Local JSON file containing the complete registered WordPress REST meta object. Do not provide together with meta.")
};

/** Taxonomy 类型资源 create/update 使用的输入字段。 */
const taxonomyResourceBodyShape = {
  name: z.string().optional().describe("Taxonomy term name."),
  slug: z.string().optional().describe("Taxonomy term slug."),
  description: z.string().optional().describe("Taxonomy term description."),
  parent: z.number().int().nonnegative().optional().describe("Parent ID for hierarchical categories and product categories; use 0 to remove the parent. Not supported by product tags."),
  meta: z.record(z.unknown()).optional().describe("Registered WordPress REST term meta fields."),
  metaFile: nonBlankStringSchema.optional().describe("Local JSON file containing the complete registered WordPress REST term meta object. Do not provide together with meta.")
};

/** Post 类型资源直接写入数据 schema。 */
const postResourceDataSchema = z.object(postResourceBodyShape).strict();

/** Taxonomy 类型资源直接写入数据 schema。 */
const taxonomyResourceDataSchema = z.object(taxonomyResourceBodyShape).strict();

/** 两类资源直接写入数据联合 schema。 */
const resourceDataSchema = z.union([postResourceDataSchema, taxonomyResourceDataSchema]);

/** Post 批量条目数据 schema，不包含逐项本地文件。 */
const postResourceBatchDataSchema = postResourceDataSchema.omit({ contentFile: true, metaFile: true });

/** Taxonomy 批量条目数据 schema，不包含逐项本地文件。 */
const taxonomyResourceBatchDataSchema = taxonomyResourceDataSchema.omit({ metaFile: true });

/** 两类资源批量条目数据联合 schema。 */
const resourceBatchDataSchema = z.union([postResourceBatchDataSchema, taxonomyResourceBatchDataSchema]);

/** Elementor MCP 工具共用的输入字段。 */
const elementorBaseShape = {
  ...globalInputShape,
  postId: z.number().int().positive().describe("WordPress page ID.")
};

/** Elementor settings 对象 schema。 */
const elementorSettingsSchema = z.record(z.unknown()).describe("Elementor settings object.");

/** Elementor 单元素局部正文修改 schema。 */
const elementorContentChangeSchema = z.object({
  elementId: nonBlankStringSchema.describe("Element ID copied from wp_elementor_get."),
  settings: elementorSettingsSchema.describe("Only changed content keys already shown by wp_elementor_get for this element.")
}).strict();

/** MCP 工具结果允许直接进入会话的最大紧凑 JSON 字节数。 */
const MAX_INLINE_RESULT_BYTES = 8 * 1024;

/** 超过内联阈值后返回给 MCP host 的本地结果文件引用。 */
interface StoredToolResult {
  /** 表示完整结果已保存在本地文件中。 */
  stored: true;
  /** 保存完整 JSON 结果的绝对路径。 */
  file_path: string;
  /** 本地结果文件的 UTF-8 字节数。 */
  bytes: number;
  /** 本地结果文件内容的 SHA-256。 */
  sha256: string;
  /** 本地结果文件的媒体类型。 */
  media_type: "application/json";
}

/** 将大型 MCP 结果保存到本地目录，并返回不包含原始数据的小型引用。 */
async function storeLargeToolResult(
  toolName: WpApiToolName,
  serializedJson: string,
  context: WpApiToolContext
): Promise<StoredToolResult> {
  const resultDirectory = resolve(context.resultDirectory ?? resolve(process.cwd(), ".wp-api-results"));
  await mkdir(resultDirectory, { recursive: true });
  const filePath = resolve(resultDirectory, `${toolName}-${Date.now()}-${randomUUID()}.json`);
  const fileContents = `${serializedJson}\n`;
  await writeFile(filePath, fileContents, { encoding: "utf8", flag: "wx" });
  return {
    stored: true,
    file_path: filePath,
    bytes: Buffer.byteLength(fileContents, "utf8"),
    sha256: createHash("sha256").update(fileContents).digest("hex"),
    media_type: "application/json"
  };
}

/**
 * 将任意结构化数据包装为 MCP 工具响应。
 * 超过 8 KiB 的完整结果和 Elementor 完整 data 视图只写入本地文件，避免 structuredContent 再次占用会话上下文。
 */
async function toToolResult(
  toolName: WpApiToolName,
  data: unknown,
  context: WpApiToolContext,
  structuredOnly = false
) {
  const serializedJson = JSON.stringify(data);
  if (serializedJson === undefined) {
    throw new Error(`MCP tool ${toolName} returned a value that cannot be serialized as JSON.`);
  }
  const serializedBytes = Buffer.byteLength(serializedJson, "utf8");
  const isElementorDataResult = toolName === "wp_elementor_get"
    && typeof data === "object"
    && data !== null
    && "view" in data
    && data.view === "data";
  if (serializedBytes > MAX_INLINE_RESULT_BYTES || isElementorDataResult) {
    const storedResult = await storeLargeToolResult(toolName, serializedJson, context);
    return {
      structuredContent: {
        result: storedResult
      },
      content: [
        {
          type: "text" as const,
          text: `Result is ${serializedBytes} bytes and was stored locally at ${storedResult.file_path}.\n`
        }
      ]
    };
  }

  if (structuredOnly) {
    return {
      structuredContent: {
        result: data
      },
      content: [
        {
          type: "text" as const,
          text: "Compact result is available in structuredContent.result.\n"
        }
      ]
    };
  }
  const formattedJson = `${JSON.stringify(data, null, 2)}\n`;
  return {
    structuredContent: {
      result: data
    },
    content: [
      {
        type: "text" as const,
        text: formattedJson
      }
    ]
  };
}

/** 创建绑定具体工具名和上下文的 MCP 回调，并为结构查询及 Elementor 读取启用单份结构化输出。 */
function createToolCallback(toolName: WpApiToolName, context: WpApiToolContext) {
  const structuredOnly = toolName === "wp_structure_get"
    || toolName === "wp_rest_api"
    || toolName === "wp_elementor_get";
  return async (input: WpApiToolInput) => toToolResult(
    toolName,
    await executeWpApiTool(toolName, input, context),
    context,
    structuredOnly
  );
}

/** 注册一个 Elementor MCP 工具。 */
function registerElementorTool(
  server: McpServer,
  context: WpApiToolContext,
  toolName: WpApiToolName,
  title: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>
): void {
  server.registerTool(
    toolName,
    {
      title,
      description,
      inputSchema,
      outputSchema,
      annotations: WP_API_TOOL_ANNOTATIONS[toolName]
    },
    createToolCallback(toolName, context)
  );
}

/** 在 MCP server 上注册 wp-api 的全部工具。 */
export function registerWpApiTools(server: McpServer, context: WpApiToolContext = {}): void {
  server.registerTool(
    "wp_client_list",
    {
      title: "List wp-api clients",
      description: "List the names and site URLs of all saved local wp-api clients.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_client_list,
      inputSchema: {},
      outputSchema
    },
    createToolCallback("wp_client_list", context)
  );

  server.registerTool(
    "wp_client_get",
    {
      title: "Get wp-api client",
      description: "Get one saved local wp-api client's name and site URL. Missing clients return an error.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_client_get,
      inputSchema: {
        name: nonBlankStringSchema.describe("Saved client name to find.")
      },
      outputSchema
    },
    createToolCallback("wp_client_get", context)
  );

  server.registerTool(
    "wp_structure_get",
    {
      title: "Get WordPress data structure",
      description: "Read a small local usage guide for posts, pages, Jelly Catalog resources, media, SEO, and Elementor. Query the needed structure and section directly; use full only for compatibility or exhaustive inspection.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_structure_get,
      inputSchema: {
        structure: z.enum(WP_STRUCTURE_NAMES).optional().describe("Structure to inspect. Omit only when the available names are unknown."),
        section: z.enum(WP_STRUCTURE_SECTIONS).optional().describe("Smallest section needed: overview (default), write, response, example, or full.")
      },
      outputSchema
    },
    createToolCallback("wp_structure_get", context)
  );

  server.registerTool(
    "wp_rest_api",
    {
      title: "Query public WordPress REST API metadata",
      description: "Inspect a site's live public WordPress REST API without using saved clients or credentials. Provide a bare domain. Start with apiPath wp-json and optional search to discover routes, then query an exact path such as wp-json/wp/v2/posts to read its OPTIONS methods, arguments, and fields. Summary is the compact default; request full only when the summary omits a required constraint.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_rest_api,
      inputSchema: {
        domain: restApiDomainSchema.describe("Required bare domain only, for example example.com. The tool always requests https://{domain}/... and never uses saved WordPress credentials."),
        apiPath: nonBlankStringSchema.optional().describe("REST path beginning with wp-json, for example wp-json, wp-json/wp/v2/posts, or wp-json/jelly-form/v1/settings. Defaults to wp-json. The shorter wp/v2/posts form is also accepted."),
        search: nonBlankStringSchema.optional().describe("Case-insensitive route path or namespace filter. Use only with the wp-json root index to find the exact route before querying it."),
        offset: z.number().int().nonnegative().optional().describe("Root-index pagination offset. Use only with apiPath wp-json; defaults to 0."),
        limit: z.number().int().min(1).max(100).optional().describe("Root-index page size from 1 to 100. Use only with apiPath wp-json; defaults to 50."),
        detail: z.enum(["summary", "full"]).optional().describe("Output detail. Keep the default summary for route discovery and field constraints; use full only when exact raw WordPress metadata is necessary.")
      },
      outputSchema
    },
    createToolCallback("wp_rest_api", context)
  );

  server.registerTool(
    "wp_resource_count",
    {
      title: "Count WordPress resources",
      description: "Read X-WP-Total and X-WP-TotalPages for a filtered WordPress resource collection without loading every matching entity.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_count,
      inputSchema: {
        ...globalInputShape,
        target: resourceTargetSchema,
        search: z.string().optional().describe("Search text."),
        status: z.string().optional().describe("Resource status filter."),
        include: z.array(z.number().int().positive()).optional().describe("Optional resource ID whitelist."),
        perPage: z.number().int().refine(isValidPerPage, "Items per page must be between 1 and 100.").optional().describe("Page size used to calculate totalPages; defaults to 100.")
      },
      outputSchema
    },
    createToolCallback("wp_resource_count", context)
  );

  server.registerTool(
    "wp_resource_list",
    {
      title: "List WordPress resources",
      description: "List one page of WordPress resources and optionally export every matching editable resource to a type-specific CSV file.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_list,
      inputSchema: {
        ...globalInputShape,
        target: resourceTargetSchema,
        search: z.string().optional().describe("Search text."),
        page: z.number().int().positive().optional().describe("Page number."),
        perPage: z.number().int().refine(isValidPerPage, "Items per page must be between 1 and 100.").optional().describe("Inline items per page, between 1 and 100."),
        status: z.string().optional().describe("Resource status filter."),
        include: z.array(z.number().int().positive()).optional().describe("Optional resource ID whitelist."),
        outputFile: nonBlankStringSchema.optional().describe("Optional post or taxonomy CSV output path. Exports every match independently of page and perPage.")
      },
      outputSchema
    },
    createToolCallback("wp_resource_list", context)
  );

  server.registerTool(
    "wp_resource_get",
    {
      title: "Get WordPress resource",
      description: "Get one WordPress or Jelly Catalog resource by ID.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_get,
      inputSchema: {
        ...globalInputShape,
        target: resourceTargetSchema,
        id: z.number().int().positive().describe("Resource ID.")
      },
      outputSchema
    },
    createToolCallback("wp_resource_get", context)
  );

  server.registerTool(
    "wp_resource_create",
    {
      title: "Create WordPress resource",
      description: "Create a post, page, category, or Jelly Catalog product or product category.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_create,
      inputSchema: {
        ...globalInputShape,
        target: resourceTargetSchema,
        data: resourceDataSchema.describe("Resource fields matching target.type.")
      },
      outputSchema
    },
    createToolCallback("wp_resource_create", context)
  );

  /** 批量创建条目的严格 MCP schema。 */
  const resourceBatchCreateItemSchema = z.object({
    id: z.number().int().positive().optional().describe("Optional source ID used only to correlate a CSV export with the created result."),
    data: resourceBatchDataSchema.describe("Direct resource fields matching target.type.")
  }).strict();

  server.registerTool(
    "wp_resource_batch_create",
    {
      title: "Batch create WordPress resources",
      description: "Create resources through WordPress batch/v1 using inline items or a type-specific resource CSV file. Requests are split at 25 items or 8 MiB of serialized JSON, with a 25 MiB total call limit.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_batch_create,
      inputSchema: {
        ...globalInputShape,
        target: resourceTargetSchema,
        items: z.array(resourceBatchCreateItemSchema).min(1).optional().describe("Inline resource creates. Provide exactly one of items or csvFile."),
        csvFile: nonBlankStringSchema.optional().describe("Post or taxonomy CSV path matching target.type. Provide exactly one of csvFile or items.")
      },
      outputSchema
    },
    createToolCallback("wp_resource_batch_create", context)
  );

  server.registerTool(
    "wp_resource_update",
    {
      title: "Update WordPress resource",
      description: "Update a post, page, category, or Jelly Catalog product or product category.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_update,
      inputSchema: {
        ...globalInputShape,
        target: resourceTargetSchema,
        id: z.number().int().positive().describe("Resource ID."),
        data: resourceDataSchema.describe("Resource fields matching target.type.")
      },
      outputSchema
    },
    createToolCallback("wp_resource_update", context)
  );

  /** 批量更新条目的严格 MCP schema。 */
  const resourceBatchUpdateItemSchema = z.object({
    id: z.number().int().positive().describe("Resource ID used to select the update target."),
    data: resourceBatchDataSchema.describe("Direct resource fields matching target.type.")
  }).strict();

  server.registerTool(
    "wp_resource_batch_update",
    {
      title: "Batch update WordPress resources",
      description: "Update resources by ID through WordPress batch/v1 using inline items or a type-specific resource CSV file. Requests are split at 25 items or 8 MiB of serialized JSON, with a 25 MiB total call limit.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_batch_update,
      inputSchema: {
        ...globalInputShape,
        target: resourceTargetSchema,
        items: z.array(resourceBatchUpdateItemSchema).min(1).optional().describe("Inline resource updates. Provide exactly one of items or csvFile."),
        csvFile: nonBlankStringSchema.optional().describe("Post or taxonomy CSV path matching target.type. Provide exactly one of csvFile or items.")
      },
      outputSchema
    },
    createToolCallback("wp_resource_batch_update", context)
  );

  server.registerTool(
    "wp_resource_delete",
    {
      title: "Delete WordPress resource",
      description: "Delete a post, page, category, or Jelly Catalog product or product category. Taxonomy terms require force=true because they are permanently deleted.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_delete,
      inputSchema: {
        ...globalInputShape,
        target: resourceTargetSchema,
        id: z.number().int().positive().describe("Resource ID."),
        force: z.boolean().optional().describe("Force permanent deletion. Required for every taxonomy target because taxonomy terms do not support trash.")
      },
      outputSchema
    },
    createToolCallback("wp_resource_delete", context)
  );

  server.registerTool(
    "wp_seo_get",
    {
      title: "Get Rank Math SEO fields",
      description: "Read Rank Math REST meta fields from a supported WordPress resource.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_seo_get,
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        id: z.number().int().positive().describe("Resource ID.")
      },
      outputSchema
    },
    createToolCallback("wp_seo_get", context)
  );

  server.registerTool(
    "wp_seo_update",
    {
      title: "Update Rank Math SEO fields",
      description: "Update Rank Math REST meta fields through the resource's native WordPress REST endpoint.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_seo_update,
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        id: z.number().int().positive().describe("Resource ID."),
        title: z.string().optional().describe("Rank Math SEO title."),
        description: z.string().optional().describe("Rank Math SEO description."),
        focusKeyword: z.string().optional().describe("Rank Math focus keyword.")
      },
      outputSchema
    },
    createToolCallback("wp_seo_update", context)
  );

  server.registerTool(
    "wp_seo_list",
    {
      title: "List and export Rank Math SEO fields",
      description: "List one page of Rank Math REST meta and optionally export every matching resource to CSV.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_seo_list,
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        search: z.string().optional().describe("Optional WordPress full-text search."),
        status: z.string().optional().describe("Optional WordPress resource status filter."),
        page: z.number().int().positive().optional().describe("Inline result page number."),
        perPage: z.number().int().refine(isValidPerPage, "SEO items per page must be between 1 and 100.").optional().describe("Inline results per page, between 1 and 100."),
        include: z.array(z.number().int().positive()).optional().describe("Optional resource ID whitelist."),
        outputFile: nonBlankStringSchema.optional().describe("Optional local CSV output path. Exports every match, independently of page and perPage.")
      },
      outputSchema
    },
    createToolCallback("wp_seo_list", context)
  );

  const seoBatchItemSchema = z.object({
    id: z.number().int().positive().describe("Resource ID."),
    title: z.string().optional().describe("Rank Math SEO title; empty string clears it."),
    description: z.string().optional().describe("Rank Math SEO description; empty string clears it."),
    focusKeyword: z.string().optional().describe("Rank Math focus keyword; empty string clears it.")
  }).strict();

  server.registerTool(
    "wp_seo_batch_update",
    {
      title: "Batch update Rank Math SEO fields",
      description: "Update multiple Rank Math REST meta records through WordPress batch/v1 using inline items or a local CSV file.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_seo_batch_update,
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        items: z.array(seoBatchItemSchema).min(1).optional().describe("Inline SEO updates. Provide exactly one of items or csvFile."),
        csvFile: nonBlankStringSchema.optional().describe("Local SEO CSV import path. Provide exactly one of csvFile or items.")
      },
      outputSchema
    },
    createToolCallback("wp_seo_batch_update", context)
  );

  server.registerTool(
    "wp_post_link",
    {
      title: "Manage links in WordPress post content",
      description: "List, add, update, or remove links in the editable raw content of a WordPress post.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_post_link,
      inputSchema: {
        ...globalInputShape,
        action: z.enum(["list", "add", "update", "remove"]).describe("Link operation to perform."),
        postId: z.number().int().positive().describe("Post ID."),
        text: z.string().min(1).optional().describe("Add: exact visible text to link. Update/remove: optional anchor text filter."),
        href: z.string().min(1).optional().describe("Add: new link URL. Update/remove: existing link URL to locate."),
        newHref: z.string().min(1).optional().describe("Update: replacement link URL."),
        newText: z.string().min(1).optional().describe("Update: replacement anchor text.")
      },
      outputSchema
    },
    createToolCallback("wp_post_link", context)
  );

  server.registerTool(
    "wp_post_content_replace",
    {
      title: "Replace text in WordPress post content",
      description: "Replace every exact occurrence of text in a post's content, for example to fix a misspelled word.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_post_content_replace,
      inputSchema: {
        ...globalInputShape,
        postId: z.number().int().positive().describe("Post ID."),
        text: z.string().min(1).describe("Exact text to find in the post content."),
        replacement: z.string().describe("Text that replaces every exact match; use an empty string to remove matches.")
      },
      outputSchema
    },
    createToolCallback("wp_post_content_replace", context)
  );

  server.registerTool(
    "wp_media_upload",
    {
      title: "Upload WordPress media",
      description: "Upload a local bitmap readable by the MCP server process. JPEG and PNG inputs are compressed to WebP in memory before upload; GIF, AVIF, and existing WebP files remain unchanged.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_media_upload,
      inputSchema: {
        ...globalInputShape,
        filePath: z.string().min(1).describe("Local .avif, .gif, .jpeg, .jpg, .png, or .webp path readable by the MCP server process. JPEG and PNG are uploaded as WebP."),
        title: z.string().optional().describe("Media title."),
        altText: z.string().optional().describe("Media alt text."),
        caption: z.string().optional().describe("Media caption."),
        description: z.string().optional().describe("Media description.")
      },
      outputSchema
    },
    createToolCallback("wp_media_upload", context)
  );

  registerElementorTool(
    server,
    context,
    "wp_elementor_get",
    "Read Elementor page content",
    "Read editable content from a WordPress page. The default content view returns only element IDs and existing content settings, plus update guidance. Use searchText to locate text or view data only for a full backup before import.",
    {
      ...elementorBaseShape,
      view: z.enum(["content", "data"]).optional().describe("content (default) returns editable text/content fields; data returns the complete element tree for backup or import."),
      searchText: nonBlankStringSchema.optional().describe("Case-insensitive filter across editable content values; only valid with the content view.")
    }
  );

  registerElementorTool(
    server,
    context,
    "wp_elementor_update",
    "Update Elementor page content",
    "Partially update existing page content by element ID. First call wp_elementor_get, then copy each elementId and send only changed setting keys. Layout, style, new elements, and unknown settings are rejected; all changes are saved once and the site-wide Elementor cache is refreshed automatically.",
    {
      ...elementorBaseShape,
      expectedRevision: nonBlankStringSchema.describe("Revision copied from the latest wp_elementor_get result. The update is rejected if the page changed meanwhile."),
      changes: z.array(elementorContentChangeSchema).min(1).max(100).optional().describe("One or more content-only element updates applied in a single page save. Do not provide together with changesFile."),
      changesFile: nonBlankStringSchema.optional().describe("Local JSON file containing the changes array. Use for large batches; do not provide together with changes.")
    }
  );

  registerElementorTool(
    server,
    context,
    "wp_elementor_import",
    "Replace Elementor page data",
    "Replace the complete Elementor element tree of an existing WordPress page from a local JSON file, then verify persistence and refresh the site-wide Elementor cache automatically. The file may contain a raw element array or a saved wp_elementor_get data result.",
    {
      ...elementorBaseShape,
      dataFile: nonBlankStringSchema.describe("Local JSON file containing a raw Elementor element array or a saved wp_elementor_get data result.")
    }
  );

  const jellyFormSmtpSchema = z.object({
    host: z.string().optional().describe("SMTP host name."),
    port: z.number().int().min(1).max(65535).optional().describe("SMTP port."),
    encryption: z.enum(["none", "ssl", "tls"]).optional().describe("SMTP encryption mode."),
    username: z.string().optional().describe("SMTP login username."),
    password: z.string().optional().describe("New SMTP password; omit or leave empty to preserve the saved password."),
    clearPassword: z.boolean().optional().describe("Explicitly clear the saved SMTP password."),
    fromEmail: z.string().email().or(z.literal("")).optional().describe("SMTP from email; use an empty string to clear it."),
    fromName: z.string().optional().describe("SMTP from name.")
  }).strict();

  server.registerTool(
    "wp_jelly_form_settings_get",
    {
      title: "Get Jelly Form settings",
      description: "Read Jelly Form recipient email, notification, redirect, and redacted SMTP settings.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_jelly_form_settings_get,
      inputSchema: { ...globalInputShape },
      outputSchema
    },
    createToolCallback("wp_jelly_form_settings_get", context)
  );

  server.registerTool(
    "wp_jelly_form_settings_update",
    {
      title: "Update Jelly Form settings",
      description: "Update selected Jelly Form recipient email, notification, redirect, or SMTP settings.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_jelly_form_settings_update,
      inputSchema: {
        ...globalInputShape,
        recipientEmail: z.string().email().optional().describe("Email address that receives inquiry notifications."),
        emailEnabled: z.boolean().optional().describe("Enable inquiry notification emails."),
        popupEnabled: z.boolean().optional().describe("Enable the front-end popup."),
        ipinfoToken: z.string().regex(/^[a-zA-Z0-9]*$/).optional().describe("IPInfo token; use an empty string to clear it."),
        redirectSlug: z.string().optional().describe("Success redirect path; use an empty string to disable redirects."),
        smtpEnabled: z.boolean().optional().describe("Enable custom SMTP delivery."),
        smtp: jellyFormSmtpSchema.optional().describe("Selected SMTP fields to update.")
      },
      outputSchema
    },
    createToolCallback("wp_jelly_form_settings_update", context)
  );

  server.registerTool(
    "wp_jelly_form_inquiry_list",
    {
      title: "List Jelly Form inquiries",
      description: "Read a filtered page of non-spam Jelly Form inquiry submissions. This tool is read-only.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_jelly_form_inquiry_list,
      inputSchema: {
        ...globalInputShape,
        search: z.string().optional().describe("Search submission content, page title, or country."),
        page: z.number().int().positive().optional().describe("Page number."),
        perPage: z.number().int().min(1).max(100).optional().describe("Items per page."),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive start date in YYYY-MM-DD format."),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive end date in YYYY-MM-DD format."),
        orderBy: z.enum(["id", "created_at", "page_title", "country"]).optional().describe("Sort field."),
        order: z.enum(["ASC", "DESC"]).optional().describe("Sort direction.")
      },
      outputSchema
    },
    createToolCallback("wp_jelly_form_inquiry_list", context)
  );

  server.registerTool(
    "wp_jelly_form_inquiry_get",
    {
      title: "Get Jelly Form inquiry",
      description: "Read one non-spam Jelly Form inquiry submission by ID. This tool is read-only.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_jelly_form_inquiry_get,
      inputSchema: {
        ...globalInputShape,
        id: z.number().int().positive().describe("Inquiry ID.")
      },
      outputSchema
    },
    createToolCallback("wp_jelly_form_inquiry_get", context)
  );

  const packageTypeSchema = z.enum(["plugin", "theme"]).describe("WordPress package type.");

  server.registerTool(
    "wp_package_list",
    {
      title: "List WordPress packages",
      description: "List installed plugins or themes.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_package_list,
      inputSchema: {
        ...globalInputShape,
        packageType: packageTypeSchema,
        status: z.enum(["active", "inactive"]).optional().describe("Optional activation status filter."),
        search: z.string().optional().describe("Optional plugin search text; ignored for themes.")
      },
      outputSchema
    },
    createToolCallback("wp_package_list", context)
  );

  server.registerTool(
    "wp_package_get",
    {
      title: "Get WordPress package",
      description: "Get an installed plugin or theme.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_package_get,
      inputSchema: {
        ...globalInputShape,
        packageType: packageTypeSchema,
        package: nonBlankStringSchema.describe("Plugin file slug or theme stylesheet slug.")
      },
      outputSchema
    },
    createToolCallback("wp_package_get", context)
  );

  for (const [toolName, title, description] of [
    ["wp_package_install", "Install WordPress package", "Install a plugin or theme from a local zip file."],
    ["wp_package_update", "Update WordPress package", "Update a plugin or theme from a local zip file."]
  ] as const) {
    server.registerTool(
      toolName,
      {
        title,
        description,
        annotations: WP_API_TOOL_ANNOTATIONS[toolName],
        inputSchema: {
          ...globalInputShape,
          packageType: packageTypeSchema,
          file: nonBlankStringSchema.describe("Local .zip path readable by the MCP server process.")
        },
        outputSchema
      },
      createToolCallback(toolName, context)
    );
  }

  server.registerTool(
    "wp_package_activate",
    {
      title: "Activate WordPress package",
      description: "Activate an installed plugin or switch to an installed theme.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_package_activate,
      inputSchema: {
        ...globalInputShape,
        packageType: packageTypeSchema,
        package: nonBlankStringSchema.describe("Plugin file slug or theme stylesheet slug.")
      },
      outputSchema
    },
    createToolCallback("wp_package_activate", context)
  );

  server.registerTool(
    "wp_package_deactivate",
    {
      title: "Deactivate WordPress plugin",
      description: "Deactivate an installed plugin. Themes are not supported by this operation.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_package_deactivate,
      inputSchema: {
        ...globalInputShape,
        packageType: z.literal("plugin").describe("Must be plugin; themes do not support deactivation."),
        package: nonBlankStringSchema.describe("Plugin file slug.")
      },
      outputSchema
    },
    createToolCallback("wp_package_deactivate", context)
  );

  for (const [toolName, title, description] of [
    ["wp_package_pack_theme", "Package WordPress theme", "Package a local theme folder as a WordPress-installable zip file."],
    ["wp_package_pack_plugin", "Package WordPress plugin", "Package a local plugin folder as a WordPress-installable zip file."]
  ] as const) {
    server.registerTool(
      toolName,
      {
        title,
        description,
        annotations: WP_API_TOOL_ANNOTATIONS[toolName],
        inputSchema: {
          folderPath: z.string().min(1).describe("Local theme or plugin folder path readable by the MCP server process."),
          outputPath: z.string().min(1).optional().describe("Optional output .zip path. Defaults to <folder-name>.zip beside the source folder.")
        },
        outputSchema
      },
      createToolCallback(toolName, context)
    );
  }
}

/** 创建已经注册 wp-api 工具的 MCP server 实例。 */
export function createWpApiMcpServer(context: WpApiToolContext = {}): McpServer {
  const server = new McpServer({
    name: "wp-api",
    version: "2.1.0"
  });
  registerWpApiTools(server, context);
  return server;
}

/** 使用 stdio transport 启动 wp-api MCP server。 */
export async function startStdioServer(context: WpApiToolContext = {}): Promise<void> {
  const server = createWpApiMcpServer(context);
  await server.connect(new StdioServerTransport());
}
