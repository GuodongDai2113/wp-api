import { ConfigStore, type StoredClient } from "./lib/config-store.js";
import { resolveContentInput } from "./lib/content-input.js";
import {
  buildElementorMeta,
  countElements,
  findElementById,
  findElements,
  readElementorDataFromEntity,
  simplifyElementorStructure,
  type ElementorElement,
  type ElementorSettings
} from "./lib/elementor.js";
import { convertHtmlToGutenberg } from "./lib/html-to-gutenberg.js";
import { addLinkToContent, extractPostContent, type AddLinkResult } from "./lib/links.js";
import { getResourceConfig, buildListQuery, buildResourceBody } from "./lib/resources.js";
import { WordPressApiError, WordPressClient, type UploadMediaOptions } from "./lib/wp-client.js";

/** CLI 参数解析后的选项字典。 */
export type CliOptions = Record<string, string | boolean | undefined>;

/** CLI 参数解析后的结构。 */
export interface ParsedArgs {
  /** 位置参数列表。 */
  positionals: string[];
  /** 命名选项字典。 */
  options: CliOptions;
}

/** 完整命令行解析结果。 */
export interface ParsedCommandLine {
  /** 顶层命令名称。 */
  command: string | undefined;
  /** 命令参数。 */
  args: ParsedArgs;
}

/** CLI 命令执行结果。 */
export interface CliResult<T = unknown> {
  /** 进程语义退出码。 */
  exitCode: number;
  /** 标准输出文本。 */
  stdout: string;
  /** 标准错误文本。 */
  stderr: string;
  /** 结构化返回数据。 */
  data?: T;
}

/** runCli 可注入的运行时选项。 */
export interface RunCliOptions {
  /** 覆盖本地配置目录。 */
  configDir?: string;
  /** 从标准输入读取到的正文文本。 */
  stdinText?: string;
  /** 可注入的 fetch 实现。 */
  fetchImpl?: typeof fetch;
  /** 日志对象。 */
  logger?: Pick<Console, "error">;
}

/** WordPress REST 实体中渲染标题的最小结构。 */
interface RenderedTitle {
  /** 已渲染的标题文本。 */
  rendered?: string;
}

/** CLI 渲染实体时需要读取的最小字段集合。 */
interface RenderableEntity {
  /** 实体 ID。 */
  id?: number;
  /** WordPress 标题对象。 */
  title?: RenderedTitle;
  /** taxonomy 名称。 */
  name?: string;
  /** 实体 slug。 */
  slug?: string;
  /** REST meta 字段。 */
  meta?: Record<string, unknown>;
  /** WordPress 正文对象。 */
  content?: {
    /** 未渲染的原始正文。 */
    raw?: string;
    /** 已渲染的 HTML 正文。 */
    rendered?: string;
  };
}

/** WordPress 列表响应在 CLI 中使用的结构。 */
interface ListPayload {
  /** 当前页或聚合后的资源条目。 */
  items: RenderableEntity[];
  /** 分页统计。 */
  pagination: {
    /** 总条目数。 */
    total: number;
    /** 总页数。 */
    totalPages: number;
  };
}

/** SEO 命令返回给 CLI 和 MCP 的结构化字段。 */
interface SeoPayload {
  /** 资源 ID。 */
  id: number;
  /** 资源名称。 */
  resource: string;
  /** Rank Math SEO 标题。 */
  rank_math_title: string;
  /** Rank Math SEO 描述。 */
  rank_math_description: string;
  /** Rank Math 焦点关键词。 */
  rank_math_focus_keyword: string;
}

/** links add 命令返回给 CLI 和 MCP 的结构化字段。 */
interface LinksPayload {
  /** 文章 ID。 */
  id: number;
  /** 固定资源名称。 */
  resource: "posts";
  /** 固定动作名称。 */
  action: "links.add";
  /** 是否实际更新文章。 */
  updated: boolean;
  /** 链接添加结果状态。 */
  status: AddLinkResult["status"];
  /** 被匹配的文本。 */
  text: string;
  /** 链接目标地址。 */
  href: string;
  /** 替换次数。 */
  replacements: number;
}

/** media upload 命令返回给 CLI 和 MCP 的最小结构。 */
interface MediaPayload {
  /** WordPress 媒体附件 ID。 */
  id?: number;
  /** WordPress 媒体附件源文件 URL。 */
  source_url?: string;
  /** WordPress 媒体附件标题。 */
  title?: RenderedTitle;
  /** WordPress 媒体附件 slug。 */
  slug?: string;
}

/** Elementor 操作读取到的实体和数据树。 */
interface ElementorReadPayload {
  /** WordPress REST 实体。 */
  entity: RenderableEntity;
  /** 解析后的 Elementor 元素树。 */
  tree: ElementorElement[];
}

/** Elementor 命令返回的通用 payload。 */
interface ElementorPayload {
  /** WordPress 页面 ID。 */
  post_id: number;
  /** WordPress 资源名称。 */
  resource: "pages";
  /** 其他命令特定字段。 */
  [key: string]: unknown;
}

/** links add 结构化结果构造参数。 */
interface BuildLinksPayloadOptions {
  /** 文章 ID。 */
  id: number;
  /** 被匹配的文本。 */
  text: string;
  /** 链接目标地址。 */
  href: string;
  /** 链接添加底层结果。 */
  result: AddLinkResult;
}

/** 将 argv token 解析为位置参数和命名选项。 */
function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { positionals, options };
}

/** 解析完整命令行，把顶层命令前的选项视为全局选项。 */
function parseCommandLine(argv: string[]): ParsedCommandLine {
  const booleanOptions = new Set(["json", "verbose", "force", "gutenberg"]);
  const commandTokens: string[] = [];
  const localTokens: string[] = [];
  let command: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!command && token.startsWith("--")) {
      commandTokens.push(token);
      const key = token.slice(2);
      if (!booleanOptions.has(key)) {
        const value = argv[index + 1];
        if (value !== undefined) {
          commandTokens.push(value);
          index += 1;
        }
      }
      continue;
    }

    if (!command) {
      command = token;
      continue;
    }

    localTokens.push(token);
  }

  if (!command) {
    return { command: undefined, args: parseArgs([]) };
  }

  const globalOptions = parseArgs(commandTokens).options;
  const local = parseArgs(localTokens);

  return {
    command,
    args: {
      positionals: local.positionals,
      options: { ...globalOptions, ...local.options }
    }
  };
}

/** 构造成功的 CLI 执行结果。 */
function ok<T>(stdout: string, data: T): CliResult<T> {
  return { exitCode: 0, stdout, stderr: "", data };
}

/** 构造失败的 CLI 执行结果。 */
function fail(message: string): CliResult {
  return { exitCode: 1, stdout: "", stderr: `${message}\n` };
}

/** 把 CLI 选项值作为字符串读取。 */
function optionString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** 处理 client 命令组。 */
async function handleClientCommand(args: ParsedArgs, store: ConfigStore): Promise<CliResult> {
  const [subcommand, name] = args.positionals;

  if (!subcommand) {
    const client = await store.getActiveClient();
    if (!client) {
      return fail("No active client selected. Use `client add` and `client use` first.");
    }

    return args.options.json
      ? ok(`${JSON.stringify(client, null, 2)}\n`, client)
      : ok(`Active client: ${client.name}`, client);
  }

  if (subcommand === "add") {
    if (!name) {
      return fail("Client name is required.");
    }
    if (!args.options["site-url"] || !args.options.username || !args.options["app-password"]) {
      return fail("Missing required flags: --site-url, --username, --app-password");
    }

    const client = await store.saveClient({
      name,
      siteUrl: String(args.options["site-url"]),
      username: String(args.options.username),
      appPassword: String(args.options["app-password"])
    });

    return ok(`Saved client "${client.name}".\n`, client);
  }

  if (subcommand === "list") {
    const clients = await store.listClients();
    const active = await store.getActiveClient();
    const payload = {
      activeClient: active?.name ?? null,
      clients
    };

    if (args.options.json) {
      return ok(`${JSON.stringify(payload, null, 2)}\n`, payload);
    }

    const lines = [
      `Active client: ${payload.activeClient ?? "(none)"}`,
      ...clients.map((client) => {
        const marker = payload.activeClient === client.name ? "*" : "-";
        return `${marker} ${client.name}`;
      })
    ];

    return ok(`${lines.join("\n")}\n`, payload);
  }

  if (subcommand === "use") {
    if (!name) {
      return fail("Client name is required.");
    }

    const client = await store.setActiveClient(name);
    return ok(`Active client set to "${client.name}".\n`, client);
  }

  if (subcommand === "remove") {
    if (!name) {
      return fail("Client name is required.");
    }

    await store.removeClient(name);
    return ok(`Removed client "${name}".\n`, null);
  }

  return fail(`Unknown client subcommand: ${subcommand ?? "(missing)"}`);
}

/** 将任意数据渲染为 JSON 输出。 */
function renderJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** 将单个资源实体渲染为人类可读的一行文本。 */
function renderEntity(resourceName: string, entity: RenderableEntity): string {
  const label = resourceName.slice(0, -1);
  const title = entity.title?.rendered ?? entity.name ?? entity.slug ?? `(id:${entity.id})`;
  return `${label} ${entity.id}: ${title}\n`;
}

/** 从 WordPress 实体中提取 Rank Math SEO 字段。 */
function extractSeoPayload(resourceName: string, entity: RenderableEntity, id: number): SeoPayload {
  const meta = entity?.meta ?? {};
  return {
    id: entity?.id ?? id,
    resource: resourceName,
    rank_math_title: String(meta.rank_math_title ?? ""),
    rank_math_description: String(meta.rank_math_description ?? ""),
    rank_math_focus_keyword: String(meta.rank_math_focus_keyword ?? "")
  };
}

/** 将 SEO 结构化结果渲染为人类可读文本。 */
function renderSeoPayload(payload: SeoPayload, { updated = false }: { updated?: boolean } = {}): string {
  const header = updated
    ? `SEO updated for ${payload.resource} ${payload.id}`
    : `SEO for ${payload.resource} ${payload.id}`;
  return [
    header,
    `Title: ${payload.rank_math_title}`,
    `Description: ${payload.rank_math_description}`,
    `Focus keyword: ${payload.rank_math_focus_keyword}`
  ].join("\n") + "\n";
}

/** 根据链接添加结果构造结构化 payload。 */
function buildLinksPayload({ id, text, href, result }: BuildLinksPayloadOptions): LinksPayload {
  return {
    id,
    resource: "posts",
    action: "links.add",
    updated: result.updated,
    status: result.status,
    text,
    href,
    replacements: result.replacements
  };
}

/** 将 links add 结构化结果渲染为人类可读文本。 */
function renderLinksPayload(payload: LinksPayload): string {
  if (payload.status === "updated") {
    return `Link added to post ${payload.id}: ${payload.text} -> ${payload.href}\n`;
  }

  if (payload.status === "skipped_existing_link") {
    return `Matching text is already inside a link in post ${payload.id}: ${payload.text}\n`;
  }

  return `No matching text found in post ${payload.id}: ${payload.text}\n`;
}

/** 根据 CLI 选项构造媒体上传元数据选项。 */
function buildMediaUploadOptions(options: CliOptions): UploadMediaOptions {
  return Object.fromEntries(
    Object.entries({
      title: optionString(options.title),
      altText: optionString(options.alt),
      caption: optionString(options.caption),
      description: optionString(options.description)
    }).filter(([, value]) => value !== undefined && value !== "")
  ) as UploadMediaOptions;
}

/** 将媒体上传结果渲染为人类可读文本。 */
function renderMediaPayload(payload: MediaPayload): string {
  const label = payload.title?.rendered ?? payload.slug ?? payload.source_url ?? `(id:${payload.id})`;
  return `media ${payload.id}: ${label}\n`;
}

/** 读取必填 CLI 选项字符串。 */
function requiredOptionString(options: CliOptions, key: string): string {
  const value = optionString(options[key]);
  if (!value) {
    throw new Error(`Missing required flag: --${key}`);
  }
  return value;
}

/** 解析 JSON 字符串选项。 */
function parseJsonOption(value: string | boolean | undefined, fallback: unknown): unknown {
  const text = optionString(value);
  if (text === undefined) {
    return fallback;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON option: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 解析必须为对象的 JSON 选项。 */
function parseJsonObjectOption(value: string | boolean | undefined, fallback: ElementorSettings = {}): ElementorSettings {
  const parsed = parseJsonOption(value, fallback);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JSON option must be an object.");
  }
  return parsed as ElementorSettings;
}

/** 解析必须为数组的 JSON 选项。 */
function parseJsonArrayOption(value: string | boolean | undefined, fallback: unknown[] = []): unknown[] {
  const parsed = parseJsonOption(value, fallback);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON option must be an array.");
  }
  return parsed;
}

/** 校验 Elementor 命令不接受资源参数。 */
function rejectElementorResourceOption(args: ParsedArgs): void {
  if (args.options.resource !== undefined) {
    throw new Error("Elementor commands do not accept --resource; pages is always used.");
  }
}

/** 读取 Elementor 命令中的页面 ID。 */
function readElementorPostId(rawId: string | undefined): number {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Post id must be a positive integer.");
  }
  return id;
}

/** 使用 edit 上下文读取 Elementor 页面数据和对应 REST 实体，确保 REST 返回 edit-only 的 Elementor meta。 */
async function readElementorPayload(
  client: WordPressClient,
  route: string,
  postId: number
): Promise<ElementorReadPayload> {
  const result = await client.request<RenderableEntity>(`${route}/${postId}`, {
    query: {
      context: "edit"
    }
  });
  const entity = result.data;
  return {
    entity,
    tree: readElementorDataFromEntity(entity)
  };
}

/** 保存 Elementor 元素树到 WordPress REST meta。 */
async function saveElementorTree(
  client: WordPressClient,
  route: string,
  postId: number,
  tree: ElementorElement[],
  pageSettings?: ElementorSettings
): Promise<RenderableEntity> {
  return client.update<RenderableEntity>(
    route,
    postId,
    buildElementorMeta(tree, {
      templateType: "wp-page",
      pageSettings
    })
  );
}

/** 将 Elementor payload 渲染为人类可读文本。 */
function renderElementorPayload(payload: ElementorPayload): string {
  if (payload.element_id) {
    return `elementor ${payload.resource} ${payload.post_id}: element ${payload.element_id}\n`;
  }
  if (payload.initialized) {
    return `Elementor initialized for ${payload.resource} ${payload.post_id}\n`;
  }
  if (payload.updated !== undefined) {
    return `Elementor updated ${payload.updated} elements for ${payload.resource} ${payload.post_id}\n`;
  }
  return `Elementor ${payload.resource} ${payload.post_id}\n`;
}

/** 根据 CLI 选项构造 Rank Math meta 更新对象。 */
function buildSeoMeta(options: CliOptions): Record<string, string | boolean> {
  const entries = Object.entries({
    rank_math_title: options.title,
    rank_math_description: options.description,
    rank_math_focus_keyword: options["focus-keyword"]
  }).filter(([, value]) => value !== undefined);

  return Object.fromEntries(entries) as Record<string, string | boolean>;
}

/** 将列表结果渲染为人类可读文本，并附加分页摘要。 */
function renderList(resourceName: string, payload: ListPayload, { currentPage = 1 }: { currentPage?: number | string } = {}): string {
  const lines = payload.items.map((item) => {
    const title = item.title?.rendered ?? item.name ?? item.slug ?? "";
    return `${item.id}\t${title}`;
  });
  const footer = `Total ${payload.pagination.total}, ${payload.pagination.totalPages} pages, fetched ${payload.items.length} items, current page ${currentPage}`;
  return `${[`${resourceName}:`, ...lines, footer].join("\n")}\n`;
}

/** 将异常对象格式化为 CLI 错误文本。 */
function formatError(error: unknown): string {
  if (error instanceof WordPressApiError) {
    return `HTTP ${error.status} ${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** 根据 CLI 参数解析当前应使用的 WordPress client。 */
async function resolveClient(args: ParsedArgs, store: ConfigStore, options: RunCliOptions): Promise<WordPressClient> {
  const client = await store.getResolvedClient(args.options.client);
  if (!client) {
    throw new Error("No client selected. Use `client add` and `client use` first.");
  }

  return new WordPressClient({
    baseUrl: optionString(args.options["site-url"]) ?? client.siteUrl,
    username: client.username,
    appPassword: client.appPassword,
    fetchImpl: options.fetchImpl,
    verbose: Boolean(args.options.verbose),
    logger: options.logger
  });
}

/** 处理 posts/pages/products/categories/product-categories 资源命令。 */
async function handleResourceCommand(command: string, args: ParsedArgs, store: ConfigStore, options: RunCliOptions): Promise<CliResult> {
  const client = await resolveClient(args, store, options);
  const selectedClient: StoredClient | null = await store.getResolvedClient(args.options.client);
  const config = getResourceConfig(command, selectedClient);
  const [subcommand, rawId] = args.positionals;
  const bodyOptions = {
    transformContent: args.options.gutenberg ? convertHtmlToGutenberg : undefined
  };

  if (subcommand === "list") {
    const payload = await client.list<RenderableEntity>(config.route, buildListQuery(args.options));
    const currentPage = Number(args.options["per-page"]) === -1
      ? "all"
      : args.options.page === undefined
        ? 1
        : Number(args.options.page);
    return args.options.json
      ? ok(renderJson(payload), payload)
      : ok(renderList(command, payload, { currentPage }), payload);
  }

  if (subcommand === "get") {
    const entity = await client.get<RenderableEntity>(config.route, Number(rawId));
    return args.options.json ? ok(renderJson(entity), entity) : ok(renderEntity(command, entity), entity);
  }

  if (subcommand === "create") {
    const body = await buildResourceBody(
      config.kind,
      args.options,
      () => resolveContentInput({
        content: optionString(args.options.content),
        contentFile: optionString(args.options["content-file"]),
        stdinText: options.stdinText
      }),
      bodyOptions
    );
    const entity = await client.create<RenderableEntity>(config.route, body);
    return args.options.json ? ok(renderJson(entity), entity) : ok(renderEntity(command, entity), entity);
  }

  if (subcommand === "update") {
    const body = await buildResourceBody(
      config.kind,
      args.options,
      () => resolveContentInput({
        content: optionString(args.options.content),
        contentFile: optionString(args.options["content-file"]),
        stdinText: options.stdinText
      }),
      bodyOptions
    );
    const entity = await client.update<RenderableEntity>(config.route, Number(rawId), body);
    return args.options.json ? ok(renderJson(entity), entity) : ok(renderEntity(command, entity), entity);
  }

  if (subcommand === "delete") {
    const entity = await client.delete<RenderableEntity>(config.route, Number(rawId), {
      force: config.deleteMode === "force" ? true : Boolean(args.options.force)
    });
    return args.options.json ? ok(renderJson(entity), entity) : ok(renderEntity(command, entity), entity);
  }

  return fail(`Unknown ${command} subcommand: ${subcommand ?? "(missing)"}`);
}

/** 处理 SEO 读取和更新命令。 */
async function handleSeoCommand(args: ParsedArgs, store: ConfigStore, options: RunCliOptions): Promise<CliResult> {
  const [resourceName, rawId] = args.positionals;
  if (!resourceName) {
    return fail("Resource name is required.");
  }
  if (!rawId) {
    return fail("Resource id is required.");
  }

  const id = Number(rawId);
  const client = await resolveClient(args, store, options);
  const selectedClient = await store.getResolvedClient(args.options.client);
  const config = getResourceConfig(resourceName, selectedClient);
  const seoMeta = buildSeoMeta(args.options);
  const isUpdate = Object.keys(seoMeta).length > 0;

  const entity = isUpdate
    ? await client.update<RenderableEntity>(config.route, id, { meta: seoMeta })
    : await client.get<RenderableEntity>(config.route, id);

  const payload = extractSeoPayload(resourceName, entity, id);
  return args.options.json
    ? ok(renderJson(payload), payload)
    : ok(renderSeoPayload(payload, { updated: isUpdate }), payload);
}

/** 处理 links 命令组。 */
async function handleLinksCommand(args: ParsedArgs, store: ConfigStore, options: RunCliOptions): Promise<CliResult> {
  const [subcommand, rawId] = args.positionals;

  if (subcommand !== "add") {
    return fail(`Unknown links subcommand: ${subcommand ?? "(missing)"}`);
  }

  if (!rawId) {
    return fail("Post id is required.");
  }

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return fail("Post id must be a positive integer.");
  }

  if (
    typeof args.options.text !== "string" ||
    args.options.text.length === 0 ||
    typeof args.options.href !== "string" ||
    args.options.href.length === 0
  ) {
    return fail("Missing required flags: --text, --href");
  }

  const client = await resolveClient(args, store, options);
  const entity = await client.get<RenderableEntity>("posts", id);
  const result = addLinkToContent(extractPostContent(entity), {
    text: args.options.text,
    href: args.options.href
  });

  if (result.updated) {
    await client.update("posts", id, { content: result.content });
  }

  const payload = buildLinksPayload({
    id,
    text: args.options.text,
    href: args.options.href,
    result
  });

  return args.options.json
    ? ok(renderJson(payload), payload)
    : ok(renderLinksPayload(payload), payload);
}

/** 处理 media 命令组。 */
async function handleMediaCommand(args: ParsedArgs, store: ConfigStore, options: RunCliOptions): Promise<CliResult> {
  const [subcommand] = args.positionals;

  if (subcommand !== "upload") {
    return fail(`Unknown media subcommand: ${subcommand ?? "(missing)"}`);
  }

  if (typeof args.options.file !== "string" || args.options.file.length === 0) {
    return fail("Missing required flag: --file");
  }

  const client = await resolveClient(args, store, options);
  const payload = await client.uploadMediaFromFile<MediaPayload>(args.options.file, buildMediaUploadOptions(args.options));
  return args.options.json
    ? ok(renderJson(payload), payload)
    : ok(renderMediaPayload(payload), payload);
}

/** 处理 Elementor 页面通讯命令组。 */
async function handleElementorCommand(args: ParsedArgs, store: ConfigStore, options: RunCliOptions): Promise<CliResult> {
  const [subcommand, rawId] = args.positionals;
  const postId = readElementorPostId(rawId);
  rejectElementorResourceOption(args);
  const resourceName = "pages" as const;
  const config = getResourceConfig(resourceName);
  const client = await resolveClient(args, store, options);

  if (subcommand === "init") {
    const data = parseJsonArrayOption(args.options["data-json"]).map((entry) => entry as ElementorElement);
    const pageSettings = args.options["page-settings-json"] === undefined
      ? undefined
      : parseJsonObjectOption(args.options["page-settings-json"]);
    await saveElementorTree(client, config.route, postId, data, pageSettings);
    const payload: ElementorPayload = {
      post_id: postId,
      resource: resourceName,
      initialized: true
    };
    return args.options.json ? ok(renderJson(payload), payload) : ok(renderElementorPayload(payload), payload);
  }

  if (subcommand === "export") {
    const { tree } = await readElementorPayload(client, config.route, postId);
    const payload: ElementorPayload = {
      post_id: postId,
      resource: resourceName,
      json: tree
    };
    return args.options.json ? ok(renderJson(payload), payload) : ok(renderElementorPayload(payload), payload);
  }

  if (subcommand === "import") {
    const data = parseJsonArrayOption(args.options["data-json"]).map((entry) => entry as ElementorElement);
    await saveElementorTree(client, config.route, postId, data);
    const payload: ElementorPayload = {
      post_id: postId,
      resource: resourceName,
      imported: true,
      elements_count: countElements(data)
    };
    return args.options.json ? ok(renderJson(payload), payload) : ok(renderElementorPayload(payload), payload);
  }

  if (subcommand === "structure") {
    const { tree } = await readElementorPayload(client, config.route, postId);
    const payload: ElementorPayload = {
      post_id: postId,
      resource: resourceName,
      structure: simplifyElementorStructure(tree)
    };
    return args.options.json ? ok(renderJson(payload), payload) : ok(renderElementorPayload(payload), payload);
  }

  if (subcommand === "get-element") {
    const elementId = requiredOptionString(args.options, "element-id");
    const { tree } = await readElementorPayload(client, config.route, postId);
    const element = findElementById(tree, elementId);
    if (!element) {
      return fail(`Element not found: ${elementId}`);
    }
    const payload: ElementorPayload = {
      post_id: postId,
      resource: resourceName,
      element_id: element.id,
      elType: element.elType,
      widgetType: element.widgetType ?? "",
      settings: element.settings ?? {}
    };
    return args.options.json ? ok(renderJson(payload), payload) : ok(renderElementorPayload(payload), payload);
  }

  if (subcommand === "find") {
    const { tree } = await readElementorPayload(client, config.route, postId);
    const matches = findElements(tree, {
      widgetType: optionString(args.options["widget-type"]),
      elementType: optionString(args.options["element-type"]),
      searchText: optionString(args.options["search-text"]),
      settingKey: optionString(args.options["setting-key"]),
      settingValue: optionString(args.options["setting-value"])
    });
    const payload: ElementorPayload = {
      post_id: postId,
      resource: resourceName,
      matches,
      count: matches.length
    };
    return args.options.json ? ok(renderJson(payload), payload) : ok(renderElementorPayload(payload), payload);
  }

  return fail(`Unknown elementor subcommand: ${subcommand ?? "(missing)"}`);
}

/** 运行 wp-api CLI，并返回可供 bin 入口和 MCP 复用的结构化结果。 */
export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<CliResult> {
  const { command, args: parsed } = parseCommandLine(argv);
  const store = new ConfigStore({ configDir: options.configDir });

  try {
    if (command === "client") {
      return await handleClientCommand(parsed, store);
    }

    if (command === "seo") {
      return await handleSeoCommand(parsed, store, options);
    }

    if (command === "links") {
      return await handleLinksCommand(parsed, store, options);
    }

    if (command === "media") {
      return await handleMediaCommand(parsed, store, options);
    }

    if (command === "elementor") {
      return await handleElementorCommand(parsed, store, options);
    }

    if (["posts", "pages", "products", "categories", "product-categories"].includes(command ?? "")) {
      return await handleResourceCommand(command ?? "", parsed, store, options);
    }

    return fail(`Unknown command: ${command ?? "(missing)"}`);
  } catch (error) {
    return fail(formatError(error));
  }
}
