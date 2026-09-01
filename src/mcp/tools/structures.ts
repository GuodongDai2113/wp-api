/** 可通过本地结构目录查询的 WordPress 与 Elementor 结构名称。 */
export const WP_STRUCTURE_NAMES = [
  "post",
  "page",
  "product",
  "category",
  "product-category",
  "media",
  "seo-meta",
  "elementor-page"
] as const;

/** 可通过本地结构目录查询的结构名称联合类型。 */
export type WpStructureName = typeof WP_STRUCTURE_NAMES[number];

/** 本地结构定义可按需返回的片段名称。 */
export const WP_STRUCTURE_SECTIONS = ["overview", "write", "response", "example", "full"] as const;

/** 本地结构定义片段名称联合类型。 */
export type WpStructureSection = typeof WP_STRUCTURE_SECTIONS[number];

/** 本地结构目录工具接收的输入。 */
export interface StructureGetInput {
  /** 要查询的结构名称；省略时返回全部可用结构摘要。 */
  structure?: string;
  /** 要返回的最小结构片段；默认只返回概览。 */
  section?: string;
}

/** 单个结构的稳定说明。 */
export interface StructureDefinition {
  /** 结构目录中的唯一名称。 */
  name: WpStructureName;
  /** 面向 Agent 展示的结构标题。 */
  title: string;
  /** 结构用途和适用边界。 */
  description: string;
  /** 可传给 `wp_rest_api` 的实时 REST 路径；纯本地结构可以为空。 */
  remoteSchemaPath: string | null;
  /** 可操作该结构的 MCP 工具名称。 */
  mcpTools: string[];
  /** MCP 写入输入或结构本体的 JSON 风格字段定义。 */
  writeShape: Record<string, unknown>;
  /** 常见远程响应字段或工具返回字段定义。 */
  responseShape: Record<string, unknown>;
  /** 可直接参考并按实际 ID 和内容修改的调用示例。 */
  example: Record<string, unknown>;
  /** 使用该结构时必须注意的约束和补充说明。 */
  notes: string[];
}

/** 结构目录列表中的轻量摘要。 */
export interface StructureSummary {
  /** 结构目录中的唯一名称。 */
  name: WpStructureName;
  /** 面向 Agent 展示的结构标题。 */
  title: string;
  /** 可用于查询目标站点实时定义的 REST 路径。 */
  remoteSchemaPath: string | null;
}

/** 单个结构默认返回的轻量概览。 */
export interface StructureOverview extends StructureSummary {
  /** 结构用途和适用边界。 */
  description: string;
  /** 使用该结构时必须注意的少量关键约束。 */
  notes: string[];
}

/** 单个按需结构片段的稳定包装。 */
export interface StructureSectionResult {
  /** 结构目录中的唯一名称。 */
  name: WpStructureName;
  /** 当前返回的结构片段名称。 */
  section: Exclude<WpStructureSection, "overview" | "full">;
  /** 片段对应的字段结构或调用示例。 */
  value: Record<string, unknown>;
}

/** 构造 WordPress 内容资源共用的响应字段定义。 */
function createContentResponseShape(): Record<string, unknown> {
  return {
    id: "integer; WordPress resource ID",
    date: "string; local publication date",
    date_gmt: "string; GMT publication date",
    modified: "string; local modification date",
    slug: "string",
    status: "string; for example publish, draft, pending, private, or future",
    link: "string; public permalink",
    title: "{raw?:string, rendered:string}",
    content: "{raw?:string, rendered:string, protected?:boolean}",
    excerpt: "{raw?:string, rendered:string, protected?:boolean}",
    featured_media: "integer; attachment ID",
    meta: "object; fields registered by WordPress and active plugins"
  };
}

/** 构造文章、页面和产品共用的 MCP data 字段定义。 */
function createContentDataShape(): Record<string, unknown> {
  return {
    title: "string",
    slug: "string",
    status: "string",
    excerpt: "string",
    content: "string; inline content takes precedence over contentFile",
    contentFile: "string; local readable file path",
    gutenberg: "boolean; convert resolved HTML to Gutenberg block markup",
    featuredMedia: "non-negative integer; 0 clears the featured image",
    meta: "object; only fields registered with show_in_rest are writable; do not combine with metaFile",
    metaFile: "string; local JSON file containing the complete meta object; use instead of large inline meta"
  };
}

/** 构造 WordPress taxonomy 资源共用的响应字段定义。 */
function createTaxonomyResponseShape(): Record<string, unknown> {
  return {
    id: "integer; term ID",
    count: "integer; assigned resource count",
    description: "string",
    link: "string; public archive URL",
    name: "string",
    slug: "string",
    taxonomy: "string",
    parent: "integer; present for hierarchical taxonomies",
    meta: "object; registered term meta fields"
  };
}

/** 构造标准层级 taxonomy 的 MCP 写入结构定义。 */
function createTaxonomyWriteShape(resource: "categories" | "product-categories"): Record<string, unknown> {
  return {
    target: `{type:"taxonomy",resource:"${resource}"}`,
    id: "required positive integer for update/get/delete; omit for create",
    data: {
      name: "string; required when creating a term",
      slug: "string",
      description: "string",
      parent: "non-negative integer; 0 removes the parent",
      meta: "object; only registered REST term meta fields are writable; do not combine with metaFile",
      metaFile: "string; local JSON file containing the complete term meta object"
    },
    force: "delete only; must be true because taxonomy terms have no trash"
  };
}

/** 返回完整的本地结构定义表。 */
function createStructureCatalog(): Record<WpStructureName, StructureDefinition> {
  const contentResponse = createContentResponseShape();
  const contentData = createContentDataShape();
  const taxonomyResponse = createTaxonomyResponseShape();

  return {
    post: {
      name: "post",
      title: "WordPress post",
      description: "Standard WordPress post resource, including body content, post categories, featured media, and registered meta.",
      remoteSchemaPath: "wp-json/wp/v2/posts",
      mcpTools: ["wp_resource_count", "wp_resource_list", "wp_resource_get", "wp_resource_create", "wp_resource_batch_create", "wp_resource_update", "wp_resource_batch_update", "wp_resource_delete", "wp_post_link", "wp_post_content_replace", "wp_seo_get", "wp_seo_update", "wp_seo_list", "wp_seo_batch_update"],
      writeShape: {
        target: "{type:\"post\",resource:\"posts\"}",
        id: "required positive integer for update/get/delete; omit for create",
        data: {
          ...contentData,
          categories: "positive integer[]; [] clears all post categories"
        }
      },
      responseShape: {
        ...contentResponse,
        categories: "integer[]; post category term IDs",
        tags: "integer[]; native post tag IDs"
      },
      example: {
        target: { type: "post", resource: "posts" },
        data: {
          title: "Article title",
          status: "draft",
          content: "<p>Article body</p>",
          gutenberg: true,
          featuredMedia: 42,
          categories: [3]
        }
      },
      notes: [
        "Use context=edit permissions to receive raw title/content/excerpt fields from WordPress.",
        "Use wp_rest_api with a domain and apiPath wp-json/wp/v2/posts to inspect fields added by active plugins."
      ]
    },
    page: {
      name: "page",
      title: "WordPress page",
      description: "Standard hierarchical WordPress page. Elementor tools also operate on this resource through page meta.",
      remoteSchemaPath: "wp-json/wp/v2/pages",
      mcpTools: ["wp_resource_count", "wp_resource_list", "wp_resource_get", "wp_resource_create", "wp_resource_batch_create", "wp_resource_update", "wp_resource_batch_update", "wp_resource_delete", "wp_seo_get", "wp_seo_update", "wp_seo_list", "wp_seo_batch_update", "wp_elementor_pull", "wp_elementor_inspect", "wp_elementor_edit", "wp_elementor_push"],
      writeShape: {
        target: "{type:\"post\",resource:\"pages\"}",
        id: "required positive integer for update/get/delete; omit for create",
        data: contentData
      },
      responseShape: {
        ...contentResponse,
        parent: "integer; parent page ID",
        menu_order: "integer",
        template: "string; page template filename"
      },
      example: {
        target: { type: "post", resource: "pages" },
        data: {
          title: "Landing page",
          status: "draft",
          content: "<h1>Landing page</h1>",
          featuredMedia: 42
        }
      },
      notes: [
        "Use the Elementor-specific structures before writing _elementor_data.",
        "The current resource tool intentionally exposes a safe common subset; query the live route for parent, template, menu_order, author, and plugin fields."
      ]
    },
    product: {
      name: "product",
      title: "Jelly Catalog product",
      description: "Jelly Catalog product content with product categories, gallery, attributes, FAQ, video, and download attachment meta.",
      remoteSchemaPath: "wp-json/wp/v2/product",
      mcpTools: ["wp_resource_count", "wp_resource_list", "wp_resource_get", "wp_resource_create", "wp_resource_batch_create", "wp_resource_update", "wp_resource_batch_update", "wp_resource_delete", "wp_seo_get", "wp_seo_update", "wp_seo_list", "wp_seo_batch_update"],
      writeShape: {
        target: "{type:\"post\",resource:\"products\"}",
        id: "required positive integer for update/get/delete; omit for create",
        data: {
          ...contentData,
          categories: "positive integer[]; mapped to REST product_cat; [] clears assignments",
          meta: {
            _product_sku: "string; canonical product model/SKU",
            product_sku: "string; legacy import field; prefer _product_sku",
            _product_videourl: "string; absolute video URL",
            product_file: "non-negative integer; download attachment ID; 0 clears it",
            _product_image_gallery: "comma-separated positive attachment IDs; empty string clears it",
            _product_attributes: "{name:string,value:string}[]",
            _product_faqs: "{name:string,value:string}[]; name is question and value is answer"
          }
        }
      },
      responseShape: {
        ...contentResponse,
        product_cat: "integer[]; product category IDs",
        meta: "object matching the Jelly Catalog product meta write shape plus fields registered by other plugins"
      },
      example: {
        target: { type: "post", resource: "products" },
        data: {
          title: "Catalog product",
          status: "draft",
          categories: [8],
          meta: {
            _product_sku: "JC-100",
            _product_image_gallery: "42,43",
            _product_attributes: [{ name: "Material", value: "Steel" }],
            _product_faqs: [{ name: "What is included?", value: "One complete unit." }]
          }
        }
      },
      notes: [
        "Upload media first and use returned attachment IDs for featuredMedia, product_file, and gallery fields.",
        "Jelly Catalog is not WooCommerce; do not send WooCommerce price or inventory fields unless another plugin explicitly registers them."
      ]
    },
    category: {
      name: "category",
      title: "WordPress post category",
      description: "Native hierarchical category assigned to WordPress posts.",
      remoteSchemaPath: "wp-json/wp/v2/categories",
      mcpTools: ["wp_resource_count", "wp_resource_list", "wp_resource_get", "wp_resource_create", "wp_resource_batch_create", "wp_resource_update", "wp_resource_batch_update", "wp_resource_delete", "wp_seo_get", "wp_seo_update", "wp_seo_list", "wp_seo_batch_update"],
      writeShape: createTaxonomyWriteShape("categories"),
      responseShape: taxonomyResponse,
      example: { target: { type: "taxonomy", resource: "categories" }, data: { name: "Guides", slug: "guides", parent: 0 } },
      notes: ["Deletion requires force=true.", "Only meta registered for the category taxonomy can be sent in meta."]
    },
    "product-category": {
      name: "product-category",
      title: "Jelly Catalog product category (product_cat)",
      description: "Hierarchical Jelly Catalog product_cat taxonomy with category marketing content and media meta.",
      remoteSchemaPath: "wp-json/wp/v2/product_cat",
      mcpTools: ["wp_resource_count", "wp_resource_list", "wp_resource_get", "wp_resource_create", "wp_resource_batch_create", "wp_resource_update", "wp_resource_batch_update", "wp_resource_delete", "wp_seo_get", "wp_seo_update", "wp_seo_list", "wp_seo_batch_update"],
      writeShape: {
        ...createTaxonomyWriteShape("product-categories"),
        data: {
          name: "string; required when creating a term",
          slug: "string",
          description: "string",
          parent: "non-negative integer; 0 removes the parent",
          metaFile: "string; local JSON file containing the complete term meta object",
          meta: {
            thumbnail_id: "non-negative integer; category thumbnail attachment ID",
            banner_id: "non-negative integer; category banner attachment ID",
            category_h1_title: "string",
            category_subtitle: "string",
            category_why_choose_title: "string",
            category_why_choose: "string; safe HTML",
            category_advantages: "string; safe HTML",
            category_applications_title: "string",
            category_applications: "{title:string,description:string,image_id:integer,link_url:string}[]",
            category_cta_title: "string",
            category_buying_guide_title: "string",
            category_buying_guide: "string; safe HTML",
            category_faq_title: "string",
            product_cat_faqs: "{name:string,value:string}[]",
            category_inherit_parent_content: "string enum 0 or 1"
          }
        }
      },
      responseShape: taxonomyResponse,
      example: {
        target: { type: "taxonomy", resource: "product-categories" },
        data: {
          name: "Industrial Pumps",
          parent: 0,
          meta: {
            thumbnail_id: 42,
            category_h1_title: "Industrial Pumps",
            category_applications: [{ title: "Chemical plants", description: "Transfer applications", image_id: 43, link_url: "/contact/" }],
            category_inherit_parent_content: "0"
          }
        }
      },
      notes: ["Deletion requires force=true.", "Use empty strings, empty arrays, 0, or string 0 according to each field's declared clearing value."]
    },
    media: {
      name: "media",
      title: "WordPress media attachment",
      description: "WordPress media attachment uploaded from a local bitmap; JPEG and PNG sources are converted to WebP before upload.",
      remoteSchemaPath: "wp-json/wp/v2/media",
      mcpTools: ["wp_media_upload", "wp_rest_api"],
      writeShape: {
        filePath: "required string; local .avif, .gif, .jpeg, .jpg, .png, or .webp path; JPEG/PNG upload as WebP",
        title: "string",
        altText: "string; mapped to REST alt_text",
        caption: "string",
        description: "string"
      },
      responseShape: {
        id: "integer; reuse this attachment ID in featuredMedia and Jelly Catalog media meta",
        date: "string",
        slug: "string",
        status: "string",
        type: "literal attachment",
        link: "string; attachment page URL",
        title: "{raw?:string,rendered:string}",
        caption: "{raw?:string,rendered:string}",
        alt_text: "string",
        media_type: "string",
        mime_type: "string",
        media_details: "object; dimensions, sizes, and file metadata",
        source_url: "string; uploaded file URL"
      },
      example: { filePath: "C:/content/product.jpg", title: "Product front view", altText: "Product front view" },
      notes: ["JPEG and PNG are converted in memory to quality-85 WebP before any network request.", "GIF, AVIF, and existing WebP remain unchanged.", "The MCP tool intentionally rejects SVG and non-bitmap files.", "Upload first, then reuse the returned id in content or taxonomy writes."]
    },
    "seo-meta": {
      name: "seo-meta",
      title: "Rank Math SEO meta",
      description: "Stable Rank Math SEO subset supported by single, list, CSV, and batch tools.",
      remoteSchemaPath: null,
      mcpTools: ["wp_seo_get", "wp_seo_update", "wp_seo_list", "wp_seo_batch_update"],
      writeShape: {
        resource: "posts, pages, products, categories, or product-categories",
        id: "required positive resource ID",
        title: "string; mapped to rank_math_title; empty string clears it",
        description: "string; mapped to rank_math_description; empty string clears it",
        focusKeyword: "string; mapped to rank_math_focus_keyword; empty string clears it"
      },
      responseShape: {
        id: "integer",
        resource: "resource name",
        rank_math_title: "string",
        rank_math_description: "string",
        rank_math_focus_keyword: "string"
      },
      example: { resource: "pages", id: 20, title: "SEO title", description: "SEO description", focusKeyword: "primary keyword" },
      notes: ["Jelly SEO or an equivalent plugin must register these string meta keys with show_in_rest and authenticated write access for the selected resource.", "wp_seo_list can export every match to CSV while keeping its inline result paginated.", "wp_seo_batch_update sends at most 25 updates per batch/v1 request.", "At least one inline update field must be supplied; imported CSV empty cells explicitly clear values."]
    },
    "elementor-page": {
      name: "elementor-page",
      title: "Elementor page content",
      description: "Pull complete Elementor page data into a versioned local JSON file, inspect and edit it with bounded local tools, then safely push the full tree back.",
      remoteSchemaPath: "wp-json/wp/v2/pages",
      mcpTools: ["wp_elementor_pull", "wp_elementor_inspect", "wp_elementor_edit", "wp_elementor_push"],
      writeShape: {
        pull: "postId:positive integer plus optional outputFile:string and overwrite:boolean",
        inspect: "dataFile:string plus optional jsonPointer or elementId/widgetType/searchText filters",
        edit: "dataFile:string, expectedFileSha256:string, and either operations or operationsFile; supports update_settings, replace_element, insert_child, remove_element, and move_element",
        push: "dataFile:string; site, page ID, and baseline revision are read from the file"
      },
      responseShape: {
        pull: "pulled=true plus file path, hashes, source, revision, element count, and byte counts",
        inspect: "file hashes, source, revisions, tree statistics, and bounded pointer or element matches",
        edit: "edited=true plus applied operations, before/after hashes and data revisions, element count, and bytes",
        push: "pushed=true plus remote_updated, cache_refreshed, match, revisions, and updated local file hashes"
      },
      example: {
        pull: { postId: 20, outputFile: "elementor-page-20.json" },
        inspect: { dataFile: "elementor-page-20.json", searchText: "Old heading" },
        edit: { dataFile: "elementor-page-20.json", expectedFileSha256: "<latest file hash>", operations: [{ op: "update_settings", elementId: "a1b2c3d4", settings: { title: "New heading" } }] },
        push: { dataFile: "elementor-page-20.json" }
      },
      notes: ["The pull file uses format wp-api.elementor-page version 1 and embeds normalized site URL, page ID, and baseline revision.", "Inspect and edit are pure local tools and do not require a client; edit requires the latest file hash and atomically validates the complete tree before replacement.", "Push rejects a changed remote revision unless the remote data already equals the local desired data during a safe retry.", "Successful writes verify persisted data, refresh the site-wide Elementor cache, and atomically update the local baseline.", "The default compact data limit is 100 MiB and can be changed with WP_API_MAX_ELEMENTOR_DATA_BYTES.", "The target site must expose _elementor_data through REST."]
    }
  };
}

/** 缓存不会随运行时状态变化的本地结构目录。 */
const STRUCTURE_CATALOG = createStructureCatalog();

/** 判断字符串是否是受支持的本地结构名称。 */
function isWpStructureName(value: string): value is WpStructureName {
  return (WP_STRUCTURE_NAMES as readonly string[]).includes(value);
}

/** 判断字符串是否是受支持的结构片段名称。 */
function isWpStructureSection(value: string): value is WpStructureSection {
  return (WP_STRUCTURE_SECTIONS as readonly string[]).includes(value);
}

/** 查询本地结构目录；默认只返回概览，并允许按需获取写入、响应、示例或完整定义。 */
export function getWpStructure(
  input: StructureGetInput = {}
): StructureDefinition | StructureOverview | StructureSectionResult | { structures: StructureSummary[] } {
  if (input.structure === undefined) {
    if (input.section !== undefined) {
      throw new TypeError("section requires a structure name.");
    }
    return {
      structures: WP_STRUCTURE_NAMES.map((name) => ({
        name,
        title: STRUCTURE_CATALOG[name].title,
        remoteSchemaPath: STRUCTURE_CATALOG[name].remoteSchemaPath
      }))
    };
  }
  if (typeof input.structure !== "string" || !isWpStructureName(input.structure)) {
    throw new Error(`Unknown structure: ${String(input.structure)}. Supported structures: ${WP_STRUCTURE_NAMES.join(", ")}.`);
  }
  if (input.section !== undefined && (typeof input.section !== "string" || !isWpStructureSection(input.section))) {
    throw new TypeError(`Unknown structure section: ${String(input.section)}. Supported sections: ${WP_STRUCTURE_SECTIONS.join(", ")}.`);
  }

  const definition = STRUCTURE_CATALOG[input.structure];
  const section = input.section ?? "overview";
  if (section === "full") {
    return definition;
  }
  if (section === "overview") {
    return {
      name: definition.name,
      title: definition.title,
      description: definition.description,
      remoteSchemaPath: definition.remoteSchemaPath,
      notes: definition.notes
    };
  }

  const values = {
    write: definition.writeShape,
    response: definition.responseShape,
    example: definition.example
  } satisfies Record<Exclude<WpStructureSection, "overview" | "full">, Record<string, unknown>>;
  return {
    name: definition.name,
    section,
    value: values[section]
  };
}
