import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { executeWpApiTool, type WpApiToolContext, type WpApiToolInput, type WpApiToolName } from "./wp-api-tools.js";

/** WordPress 原生 REST 资源名称的 MCP 校验 schema。 */
const resourceSchema = z.enum(["posts", "pages", "products", "categories", "product-categories"]);

/** MCP 工具统一返回结构的 schema。 */
const outputSchema = {
  result: z.unknown()
};

/** 所有需要连接 WordPress 站点的工具都支持的通用输入字段。 */
const globalInputShape = {
  client: z.string().optional().describe("Saved wp-api client name to use for this call."),
  siteUrl: z.string().url().optional().describe("Temporary site URL override for this call.")
};

/** 内容资源和分类资源 create/update 共用的输入字段。 */
const resourceBodyShape = {
  title: z.string().optional().describe("Post, page, or product title."),
  slug: z.string().optional().describe("Resource slug."),
  status: z.string().optional().describe("Post, page, or product status."),
  excerpt: z.string().optional().describe("Post, page, or product excerpt."),
  content: z.string().optional().describe("Post, page, or product body content."),
  contentFile: z.string().optional().describe("Local content file path readable by the MCP server process."),
  categories: z.array(z.number()).optional().describe("Post category IDs."),
  name: z.string().optional().describe("Taxonomy term name."),
  description: z.string().optional().describe("Taxonomy term description."),
  parent: z.number().optional().describe("Parent taxonomy term ID.")
};

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

/** 在 MCP server 上注册 wp-api 的全部工具。 */
export function registerWpApiTools(server: McpServer, context: WpApiToolContext = {}): void {
  server.registerTool(
    "wp_client_list",
    {
      title: "List wp-api clients",
      description: "List saved local wp-api clients and the active client.",
      inputSchema: {},
      outputSchema
    },
    createToolCallback("wp_client_list", context)
  );

  server.registerTool(
    "wp_client_add",
    {
      title: "Add wp-api client",
      description: "Save a local wp-api client using a WordPress Application Password.",
      inputSchema: {
        name: z.string().describe("Client name to save locally."),
        siteUrl: z.string().url().describe("WordPress site URL."),
        username: z.string().describe("WordPress username."),
        appPassword: z.string().describe("WordPress Application Password.")
      },
      outputSchema
    },
    createToolCallback("wp_client_add", context)
  );

  server.registerTool(
    "wp_client_use",
    {
      title: "Use wp-api client",
      description: "Set the active local wp-api client.",
      inputSchema: {
        name: z.string().describe("Saved client name to make active.")
      },
      outputSchema
    },
    createToolCallback("wp_client_use", context)
  );

  server.registerTool(
    "wp_resource_list",
    {
      title: "List WordPress resources",
      description: "List posts, pages, products, categories, or product categories through native WordPress REST endpoints.",
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        search: z.string().optional().describe("Search text."),
        page: z.number().int().positive().optional().describe("Page number."),
        perPage: z.number().int().optional().describe("Items per page. Use -1 to fetch all pages."),
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
      description: "Get one WordPress resource by ID.",
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
      description: "Create a post, page, product, category, or product category.",
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
      description: "Update a post, page, product, category, or product category.",
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
      description: "Delete a post, page, product, category, or product category.",
      inputSchema: {
        ...globalInputShape,
        resource: resourceSchema,
        id: z.number().int().positive().describe("Resource ID."),
        force: z.boolean().optional().describe("Force permanent deletion when supported.")
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
    "wp_post_link_add",
    {
      title: "Add link to WordPress post",
      description: "Replace the first exact matching text in a post with an anchor tag.",
      inputSchema: {
        ...globalInputShape,
        postId: z.number().int().positive().describe("Post ID."),
        text: z.string().min(1).describe("Exact text to link."),
        href: z.string().min(1).describe("Link href.")
      },
      outputSchema
    },
    createToolCallback("wp_post_link_add", context)
  );
}

/** 创建已经注册 wp-api 工具的 MCP server 实例。 */
export function createWpApiMcpServer(context: WpApiToolContext = {}): McpServer {
  const server = new McpServer({
    name: "wp-api",
    version: "0.1.0"
  });
  registerWpApiTools(server, context);
  return server;
}

/** 使用 stdio transport 启动 wp-api MCP server。 */
export async function startStdioServer(context: WpApiToolContext = {}): Promise<void> {
  const server = createWpApiMcpServer(context);
  await server.connect(new StdioServerTransport());
}
