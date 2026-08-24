import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { executeWpApiTool, type WpApiToolContext, type WpApiToolInput, type WpApiToolName } from "./wp-api-tools.js";
import { WP_STRUCTURE_NAMES } from "./handlers/structure-tools.js";

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

/** 判断 MCP 分页大小是否符合 WordPress 上限或全量聚合约定。 */
function isValidPerPage(value: number): boolean {
  return value === -1 || (value >= 1 && value <= 100);
}

/** WordPress 站点根地址的 MCP 校验 schema。 */
const siteUrlSchema = z.string().url().refine(
  isSafeSiteUrl,
  "WordPress site URL must use HTTP or HTTPS and cannot contain credentials, a query, or a fragment."
);

/** WordPress 原生 REST 资源名称的 MCP 校验 schema。 */
const resourceSchema = z.enum(["posts", "pages", "products", "categories", "product-categories", "product-tags"]);

/** MCP 工具统一返回结构的 schema。 */
const outputSchema = {
  result: z.unknown()
};

/** 所有 MCP 工具的副作用、幂等性和外部交互提示。 */
export const WP_API_TOOL_ANNOTATIONS = {
  wp_client_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  wp_client_use: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  wp_structure_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  wp_api_schema: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_resource_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_resource_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_resource_create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  wp_resource_update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_resource_delete: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  wp_seo_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_seo_update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_post_link: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  wp_post_content_replace: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  wp_media_upload: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  wp_elementor_init: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  wp_elementor_export: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_elementor_import: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  wp_elementor_structure: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_elementor_get_element: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  wp_elementor_find: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
  client: nonBlankStringSchema.optional().describe("Saved wp-api client name to use for this call."),
  siteUrl: siteUrlSchema.optional().describe("Temporary same-origin site URL override for this call.")
};

/** 内容资源和分类资源 create/update 共用的输入字段。 */
const resourceBodyShape = {
  title: z.string().optional().describe("Post, page, or product title."),
  slug: z.string().optional().describe("Resource slug."),
  status: z.string().optional().describe("Post, page, or product status."),
  excerpt: z.string().optional().describe("Post, page, or product excerpt."),
  content: z.string().optional().describe("Post, page, or product body content."),
  contentFile: z.string().optional().describe("Local content file path readable by the MCP server process."),
  // 是否在上传前把解析出的 HTML 正文转换为 Gutenberg 区块标记。
  gutenberg: z.boolean().optional().describe("Convert resolved HTML content to WordPress Gutenberg block markup before upload."),
  featuredMedia: z.number().int().nonnegative().optional().describe("Featured media attachment ID; use 0 to clear the current featured image."),
  categories: z.array(z.number().int().positive()).optional().describe("Post category IDs; use an empty array to clear all categories."),
  productCategories: z.array(z.number().int().positive()).optional().describe("Jelly Catalog product category IDs; use an empty array to clear all product categories."),
  productTags: z.array(z.number().int().positive()).optional().describe("Jelly Catalog product tag IDs; use an empty array to clear all product tags."),
  meta: z.record(z.unknown()).optional().describe("Registered WordPress REST meta fields. Inspect the resource route with wp_api_schema before writing plugin-specific fields."),
  name: z.string().optional().describe("Taxonomy term name."),
  description: z.string().optional().describe("Taxonomy term description."),
  parent: z.number().int().nonnegative().optional().describe("Parent ID for hierarchical categories and product categories; use 0 to remove the parent. Not supported by product tags.")
};

/** Elementor MCP 工具共用的输入字段。 */
const elementorBaseShape = {
  ...globalInputShape,
  postId: z.number().int().positive().describe("WordPress page ID.")
};

/** Elementor settings 对象 schema。 */
const elementorSettingsSchema = z.record(z.unknown()).describe("Elementor settings object.");

/** Elementor 元素数组 schema。 */
const elementorDataSchema = z.array(z.record(z.unknown())).describe("Elementor element tree array.");

/** 将任意结构化数据包装为 MCP 工具响应。 */
function toToolResult(data: unknown) {
  return {
    structuredContent: {
      result: data
    },
    content: [
      {
        type: "text" as const,
        text: `${JSON.stringify(data, null, 2)}\n`
      }
    ]
  };
}

/** 创建一个绑定具体工具名和上下文的 MCP 工具回调。 */
function createToolCallback(toolName: WpApiToolName, context: WpApiToolContext) {
  return async (input: WpApiToolInput) => toToolResult(await executeWpApiTool(toolName, input, context));
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
      description: "List saved local wp-api clients and the active client.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_client_list,
      inputSchema: {},
      outputSchema
    },
    createToolCallback("wp_client_list", context)
  );

  server.registerTool(
    "wp_client_use",
    {
      title: "Use wp-api client",
      description: "Set the active local wp-api client.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_client_use,
      inputSchema: {
        name: nonBlankStringSchema.describe("Saved client name to make active.")
      },
      outputSchema
    },
    createToolCallback("wp_client_use", context)
  );

  server.registerTool(
    "wp_structure_get",
    {
      title: "Get WordPress data structure",
      description: "Read the local usage catalog for posts, pages, Jelly Catalog resources, media, SEO, and Elementor. Omit structure to list available definitions. Use wp_api_schema afterward when the target site's live schema is needed.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_structure_get,
      inputSchema: {
        structure: z.enum(WP_STRUCTURE_NAMES).optional().describe("Structure to inspect. Omit to list every available structure name.")
      },
      outputSchema
    },
    createToolCallback("wp_structure_get", context)
  );

  server.registerTool(
    "wp_api_schema",
    {
      title: "Inspect WordPress REST API schema",
      description: "Discover the target site's live REST routes, request arguments, supported methods, and resource fields. Omit apiPath for the wp-json route index, or pass a path such as wp/v2/product to read its OPTIONS schema before sending data.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_api_schema,
      inputSchema: {
        ...globalInputShape,
        apiPath: nonBlankStringSchema.optional().describe("Path below wp-json, for example wp/v2/product, wp/v2/product_cat, or jelly-form/v1/settings. Omit to list all registered routes.")
      },
      outputSchema
    },
    createToolCallback("wp_api_schema", context)
  );

  server.registerTool(
    "wp_resource_list",
    {
      title: "List WordPress resources",
      description: "List posts, pages, categories, or Jelly Catalog products, product categories, and product tags through native WordPress REST endpoints.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_list,
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        search: z.string().optional().describe("Search text."),
        page: z.number().int().positive().optional().describe("Page number."),
        perPage: z.number().int().refine(
          isValidPerPage,
          "Items per page must be -1 or between 1 and 100."
        ).optional().describe("Items per page. Use -1 to fetch all pages."),
        status: z.string().optional().describe("Resource status filter.")
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
        resource: resourceSchema,
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
      description: "Create a post, page, category, or Jelly Catalog product, product category, or product tag.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_create,
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        ...resourceBodyShape
      },
      outputSchema
    },
    createToolCallback("wp_resource_create", context)
  );

  server.registerTool(
    "wp_resource_update",
    {
      title: "Update WordPress resource",
      description: "Update a post, page, category, or Jelly Catalog product, product category, or product tag.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_update,
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        id: z.number().int().positive().describe("Resource ID."),
        ...resourceBodyShape
      },
      outputSchema
    },
    createToolCallback("wp_resource_update", context)
  );

  server.registerTool(
    "wp_resource_delete",
    {
      title: "Delete WordPress resource",
      description: "Delete a post, page, category, or Jelly Catalog product or product category. Taxonomy terms require force=true because they are permanently deleted.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_resource_delete,
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        id: z.number().int().positive().describe("Resource ID."),
        force: z.boolean().optional().describe("Force permanent deletion. Required for categories and product categories, which do not support trash.")
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
      description: "Upload a local image file readable by the MCP server process to the WordPress media library.",
      annotations: WP_API_TOOL_ANNOTATIONS.wp_media_upload,
      inputSchema: {
        ...globalInputShape,
        filePath: z.string().min(1).describe("Local image file path readable by the MCP server process."),
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
    "wp_elementor_init",
    "Initialize Elementor page data",
    "Initialize Elementor metadata only when the page has no existing elements; use import for intentional replacement.",
    {
      ...elementorBaseShape,
      data: elementorDataSchema.optional(),
      pageSettings: elementorSettingsSchema.optional()
    }
  );

  registerElementorTool(
    server,
    context,
    "wp_elementor_export",
    "Export Elementor data",
    "Read the raw Elementor element tree from a page.",
    elementorBaseShape
  );

  registerElementorTool(
    server,
    context,
    "wp_elementor_import",
    "Import Elementor data",
    "Replace a page Elementor element tree with a provided array.",
    {
      ...elementorBaseShape,
      data: elementorDataSchema
    }
  );

  registerElementorTool(
    server,
    context,
    "wp_elementor_structure",
    "Get Elementor structure",
    "Read a lightweight Elementor page structure with IDs, element types, widget types, and key settings.",
    elementorBaseShape
  );

  registerElementorTool(
    server,
    context,
    "wp_elementor_get_element",
    "Get Elementor element settings",
    "Read settings for one Elementor element by ID.",
    {
      ...elementorBaseShape,
      elementId: z.string().min(1).describe("Elementor element ID.")
    }
  );

  registerElementorTool(
    server,
    context,
    "wp_elementor_find",
    "Find Elementor elements",
    "Search Elementor elements by element type, widget type, text, setting key, or setting value.",
    {
      ...elementorBaseShape,
      widgetType: z.string().optional().describe("Widget type filter."),
      elementType: z.string().optional().describe("Element type filter."),
      searchText: z.string().optional().describe("Case-insensitive text search across string settings."),
      settingKey: z.string().optional().describe("Required setting key."),
      settingValue: z.string().optional().describe("Required setting value.")
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
    version: "2.0.0"
  });
  registerWpApiTools(server, context);
  return server;
}

/** 使用 stdio transport 启动 wp-api MCP server。 */
export async function startStdioServer(context: WpApiToolContext = {}): Promise<void> {
  const server = createWpApiMcpServer(context);
  await server.connect(new StdioServerTransport());
}
