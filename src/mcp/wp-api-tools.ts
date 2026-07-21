import { runCli } from "../cli.js";

/** wp-api MCP 服务支持的工具名称。 */
export type WpApiToolName =
  | "wp_client_list"
  | "wp_client_add"
  | "wp_client_use"
  | "wp_resource_list"
  | "wp_resource_get"
  | "wp_resource_create"
  | "wp_resource_update"
  | "wp_resource_delete"
  | "wp_seo_get"
  | "wp_seo_update"
  | "wp_post_link_add"
  | "wp_media_upload"
  | "wp_elementor_init"
  | "wp_elementor_export"
  | "wp_elementor_import"
  | "wp_elementor_structure"
  | "wp_elementor_get_element"
  | "wp_elementor_find"
  | "wp_elementor_get_tokens"
  | "wp_elementor_set_tokens"
  | "wp_plugin_list"
  | "wp_plugin_get"
  | "wp_plugin_update"
  | "wp_plugin_install";

/** MCP 工具收到的原始输入对象。 */
export type WpApiToolInput = Record<string, unknown>;

/** runCli 返回值在 MCP 适配层中使用的最小结构。 */
export interface RunCliResult {
  /** 进程语义的退出码，0 表示命令成功。 */
  exitCode: number;
  /** CLI 命令写入标准输出的文本。 */
  stdout: string;
  /** CLI 命令写入标准错误的文本。 */
  stderr: string;
  /** CLI 命令返回的结构化数据，优先作为 MCP 结果返回。 */
  data: unknown;
}

/** runCli 的可注入函数签名，用于测试和 MCP 服务复用。 */
export type RunCliImpl = (
  argv: string[],
  options?: Record<string, unknown>
) => Promise<RunCliResult>;

/** 执行 MCP 工具时允许注入的上下文。 */
export interface WpApiToolContext {
  /** 覆盖 wp-api 本地配置目录，主要用于测试或隔离不同 MCP 客户端。 */
  configDir?: string;
  /** 覆盖 runCli 实现，主要用于单元测试。 */
  runCliImpl?: RunCliImpl;
  /** 覆盖 fetch 实现，主要用于测试 WordPress 请求。 */
  fetchImpl?: unknown;
  /** 覆盖日志对象，保持和现有 CLI verbose logger 兼容。 */
  logger?: unknown;
}

/** 将可选的全局 client 参数追加到 CLI 参数列表。 */
function appendGlobalArgs(args: string[], input: WpApiToolInput): void {
  appendOption(args, "--client", readOptionalString(input, "client"));
  appendOption(args, "--site-url", readOptionalString(input, "siteUrl"));
}

/** 将一个可选命令行参数追加到 CLI 参数列表。 */
function appendOption(args: string[], flag: string, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    return;
  }

  args.push(flag, String(value));
}

/** 将一个可选结构化命令行参数序列化为 JSON 并追加到参数列表。 */
function appendJsonOption(args: string[], flag: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  args.push(flag, JSON.stringify(value));
}

/** 读取必填字符串字段，缺失或类型错误时抛出明确错误。 */
function readRequiredString(input: WpApiToolInput, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string field: ${key}`);
  }
  return value;
}

/** 读取必填普通对象字段，缺失、数组或类型错误时抛出明确错误。 */
function readRequiredObject(input: WpApiToolInput, key: string): Record<string, unknown> {
  const value = input[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Missing required object field: ${key}`);
  }
  return value as Record<string, unknown>;
}

/** 读取可选字符串字段，未提供时返回 undefined。 */
function readOptionalString(input: WpApiToolInput, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected string field: ${key}`);
  }
  return value;
}

/** 读取必填数字字段，缺失或类型错误时抛出明确错误。 */
function readRequiredNumber(input: WpApiToolInput, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing required number field: ${key}`);
  }
  return value;
}

/** 读取可选数字字段，未提供时返回 undefined。 */
function readOptionalNumber(input: WpApiToolInput, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected number field: ${key}`);
  }
  return value;
}

/** 读取可选布尔字段，未提供时返回 undefined。 */
function readOptionalBoolean(input: WpApiToolInput, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean field: ${key}`);
  }
  return value;
}

/** 读取可选数字数组字段，并转换为 CLI 接受的逗号分隔字符串。 */
function readOptionalNumberCsv(input: WpApiToolInput, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error(`Expected number array field: ${key}`);
  }
  return value.map((entry) => String(entry)).join(",");
}

/** 校验 Elementor MCP 工具不接受资源字段。 */
function rejectElementorResourceInput(input: WpApiToolInput): void {
  if (input.resource !== undefined) {
    throw new Error("Elementor MCP tools do not accept resource; pages is always used.");
  }
}

/** 根据 MCP 工具输入构造 client list 的 CLI 参数。 */
function buildClientListArgs(): string[] {
  return ["client", "list", "--json"];
}

/** 根据 MCP 工具输入构造 client add 的 CLI 参数。 */
function buildClientAddArgs(input: WpApiToolInput): string[] {
  return [
    "client",
    "add",
    readRequiredString(input, "name"),
    "--site-url",
    readRequiredString(input, "siteUrl"),
    "--username",
    readRequiredString(input, "username"),
    "--app-password",
    readRequiredString(input, "appPassword")
  ];
}

/** 根据 MCP 工具输入构造 client use 的 CLI 参数。 */
function buildClientUseArgs(input: WpApiToolInput): string[] {
  return ["client", "use", readRequiredString(input, "name")];
}

/** 根据 MCP 工具输入构造资源列表查询的 CLI 参数。 */
function buildResourceListArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push(readRequiredString(input, "resource"), "list", "--json");
  appendOption(args, "--search", readOptionalString(input, "search"));
  appendOption(args, "--page", readOptionalNumber(input, "page"));
  appendOption(args, "--per-page", readOptionalNumber(input, "perPage"));
  appendOption(args, "--status", readOptionalString(input, "status"));
  return args;
}

/** 根据 MCP 工具输入构造单个资源读取的 CLI 参数。 */
function buildResourceGetArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push(readRequiredString(input, "resource"), "get", String(readRequiredNumber(input, "id")), "--json");
  return args;
}

/** 将内容类和分类类资源字段追加到 create/update CLI 参数。 */
function appendResourceBodyArgs(args: string[], input: WpApiToolInput): void {
  appendOption(args, "--title", readOptionalString(input, "title"));
  appendOption(args, "--slug", readOptionalString(input, "slug"));
  appendOption(args, "--status", readOptionalString(input, "status"));
  appendOption(args, "--excerpt", readOptionalString(input, "excerpt"));
  appendOption(args, "--content", readOptionalString(input, "content"));
  appendOption(args, "--content-file", readOptionalString(input, "contentFile"));
  if (readOptionalBoolean(input, "gutenberg")) {
    args.push("--gutenberg");
  }
  appendOption(args, "--featured-media", readOptionalNumber(input, "featuredMedia"));
  appendOption(args, "--categories", readOptionalNumberCsv(input, "categories"));
  appendOption(args, "--name", readOptionalString(input, "name"));
  appendOption(args, "--description", readOptionalString(input, "description"));
  appendOption(args, "--parent", readOptionalNumber(input, "parent"));
}

/** 根据 MCP 工具输入构造资源创建的 CLI 参数。 */
function buildResourceCreateArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push(readRequiredString(input, "resource"), "create", "--json");
  appendResourceBodyArgs(args, input);
  return args;
}

/** 根据 MCP 工具输入构造资源更新的 CLI 参数。 */
function buildResourceUpdateArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push(readRequiredString(input, "resource"), "update", String(readRequiredNumber(input, "id")), "--json");
  appendResourceBodyArgs(args, input);
  return args;
}

/** 根据 MCP 工具输入构造资源删除的 CLI 参数。 */
function buildResourceDeleteArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push(readRequiredString(input, "resource"), "delete", String(readRequiredNumber(input, "id")), "--json");
  if (readOptionalBoolean(input, "force")) {
    args.push("--force");
  }
  return args;
}

/** 根据 MCP 工具输入构造 SEO 读取的 CLI 参数。 */
function buildSeoGetArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push("seo", readRequiredString(input, "resource"), String(readRequiredNumber(input, "id")), "--json");
  return args;
}

/** 根据 MCP 工具输入构造 SEO 更新的 CLI 参数。 */
function buildSeoUpdateArgs(input: WpApiToolInput): string[] {
  const args = buildSeoGetArgs(input);
  appendOption(args, "--title", readOptionalString(input, "title"));
  appendOption(args, "--description", readOptionalString(input, "description"));
  appendOption(args, "--focus-keyword", readOptionalString(input, "focusKeyword"));
  return args;
}

/** 根据 MCP 工具输入构造文章链接添加的 CLI 参数。 */
function buildPostLinkAddArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push(
    "links",
    "add",
    String(readRequiredNumber(input, "postId")),
    "--json",
    "--text",
    readRequiredString(input, "text"),
    "--href",
    readRequiredString(input, "href")
  );
  return args;
}

/** 根据 MCP 工具输入构造媒体上传的 CLI 参数。 */
function buildMediaUploadArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push("media", "upload", "--json", "--file", readRequiredString(input, "filePath"));
  appendOption(args, "--title", readOptionalString(input, "title"));
  appendOption(args, "--alt", readOptionalString(input, "altText"));
  appendOption(args, "--caption", readOptionalString(input, "caption"));
  appendOption(args, "--description", readOptionalString(input, "description"));
  return args;
}

/** 根据 MCP 工具输入构造 Elementor 命令的基础 CLI 参数。 */
function buildElementorBaseArgs(input: WpApiToolInput, subcommand: string): string[] {
  const args: string[] = [];
  rejectElementorResourceInput(input);
  appendGlobalArgs(args, input);
  args.push("elementor", subcommand, String(readRequiredNumber(input, "postId")), "--json");
  return args;
}

/** 根据 MCP 工具输入构造 Elementor 初始化 CLI 参数。 */
function buildElementorInitArgs(input: WpApiToolInput): string[] {
  const args = buildElementorBaseArgs(input, "init");
  appendJsonOption(args, "--data-json", input.data);
  appendJsonOption(args, "--page-settings-json", input.pageSettings);
  return args;
}

/** 根据 MCP 工具输入构造 Elementor 导出 CLI 参数。 */
function buildElementorExportArgs(input: WpApiToolInput): string[] {
  return buildElementorBaseArgs(input, "export");
}

/** 根据 MCP 工具输入构造 Elementor 导入 CLI 参数。 */
function buildElementorImportArgs(input: WpApiToolInput): string[] {
  const args = buildElementorBaseArgs(input, "import");
  appendJsonOption(args, "--data-json", input.data);
  return args;
}

/** 根据 MCP 工具输入构造 Elementor 结构读取 CLI 参数。 */
function buildElementorStructureArgs(input: WpApiToolInput): string[] {
  return buildElementorBaseArgs(input, "structure");
}

/** 根据 MCP 工具输入构造 Elementor 单元素读取 CLI 参数。 */
function buildElementorGetElementArgs(input: WpApiToolInput): string[] {
  const args = buildElementorBaseArgs(input, "get-element");
  appendOption(args, "--element-id", readRequiredString(input, "elementId"));
  return args;
}

/** 根据 MCP 工具输入构造 Elementor 元素查找 CLI 参数。 */
function buildElementorFindArgs(input: WpApiToolInput): string[] {
  const args = buildElementorBaseArgs(input, "find");
  appendOption(args, "--widget-type", readOptionalString(input, "widgetType"));
  appendOption(args, "--element-type", readOptionalString(input, "elementType"));
  appendOption(args, "--search-text", readOptionalString(input, "searchText"));
  appendOption(args, "--setting-key", readOptionalString(input, "settingKey"));
  appendOption(args, "--setting-value", readOptionalString(input, "settingValue"));
  return args;
}

/** 根据 MCP 工具输入构造 Elementor 默认 Kit tokens 读取参数。 */
function buildElementorGetTokensArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  rejectElementorResourceInput(input);
  appendGlobalArgs(args, input);
  args.push("elementor", "get-tokens", "--json");
  return args;
}

/** 根据 MCP 工具输入构造 Elementor 默认 Kit tokens 更新参数。 */
function buildElementorSetTokensArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  rejectElementorResourceInput(input);
  appendGlobalArgs(args, input);
  args.push("elementor", "set-tokens", "--json");
  appendJsonOption(args, "--tokens-json", readRequiredObject(input, "tokens"));
  return args;
}

/** 根据 MCP 工具输入构造插件列表查询的 CLI 参数。 */
function buildPluginListArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push("plugins", "list", "--json");
  appendOption(args, "--status", readOptionalString(input, "status"));
  appendOption(args, "--search", readOptionalString(input, "search"));
  return args;
}

/** 根据 MCP 工具输入构造单个插件读取的 CLI 参数。 */
function buildPluginGetArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push("plugins", "get", readRequiredString(input, "plugin"), "--json");
  return args;
}

/** 根据 MCP 工具输入构造插件更新的 CLI 参数。 */
function buildPluginUpdateArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push("plugins", "update", readRequiredString(input, "plugin"), "--json");
  appendOption(args, "--status", readOptionalString(input, "status"));
  return args;
}

/** 根据 MCP 工具输入构造插件安装的 CLI 参数。 */
function buildPluginInstallArgs(input: WpApiToolInput): string[] {
  const args: string[] = [];
  appendGlobalArgs(args, input);
  args.push("plugins", "install", "--json");
  const file = readOptionalString(input, "file");
  const url = readOptionalString(input, "url");
  if (file && url) {
    throw new Error("Provide only one of: file or url.");
  }
  if (file) {
    appendOption(args, "--file", file);
  } else if (url) {
    appendOption(args, "--url", url);
  } else {
    throw new Error("Missing required field: provide either file or url.");
  }
  return args;
}

/** 将 MCP 工具名和输入对象转换为现有 CLI 可以消费的 argv 数组。 */
export function buildCliArgsForTool(toolName: WpApiToolName, input: WpApiToolInput = {}): string[] {
  switch (toolName) {
    case "wp_client_list":
      return buildClientListArgs();
    case "wp_client_add":
      return buildClientAddArgs(input);
    case "wp_client_use":
      return buildClientUseArgs(input);
    case "wp_resource_list":
      return buildResourceListArgs(input);
    case "wp_resource_get":
      return buildResourceGetArgs(input);
    case "wp_resource_create":
      return buildResourceCreateArgs(input);
    case "wp_resource_update":
      return buildResourceUpdateArgs(input);
    case "wp_resource_delete":
      return buildResourceDeleteArgs(input);
    case "wp_seo_get":
      return buildSeoGetArgs(input);
    case "wp_seo_update":
      return buildSeoUpdateArgs(input);
    case "wp_post_link_add":
      return buildPostLinkAddArgs(input);
    case "wp_media_upload":
      return buildMediaUploadArgs(input);
    case "wp_elementor_init":
      return buildElementorInitArgs(input);
    case "wp_elementor_export":
      return buildElementorExportArgs(input);
    case "wp_elementor_import":
      return buildElementorImportArgs(input);
    case "wp_elementor_structure":
      return buildElementorStructureArgs(input);
    case "wp_elementor_get_element":
      return buildElementorGetElementArgs(input);
    case "wp_elementor_find":
      return buildElementorFindArgs(input);
    case "wp_elementor_get_tokens":
      return buildElementorGetTokensArgs(input);
    case "wp_elementor_set_tokens":
      return buildElementorSetTokensArgs(input);
    case "wp_plugin_list":
      return buildPluginListArgs(input);
    case "wp_plugin_get":
      return buildPluginGetArgs(input);
    case "wp_plugin_update":
      return buildPluginUpdateArgs(input);
    case "wp_plugin_install":
      return buildPluginInstallArgs(input);
    default:
      throw new Error(`Unknown MCP tool: ${toolName}`);
  }
}

/** 执行一个 wp-api MCP 工具，并返回 runCli 提供的结构化数据。 */
export async function executeWpApiTool(
  toolName: WpApiToolName,
  input: WpApiToolInput = {},
  context: WpApiToolContext = {}
): Promise<unknown> {
  const runCliImpl = context.runCliImpl ?? (runCli as unknown as RunCliImpl);
  const result = await runCliImpl(buildCliArgsForTool(toolName, input), {
    configDir: context.configDir,
    fetchImpl: context.fetchImpl,
    logger: context.logger
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `wp-api command failed with exit code ${result.exitCode}`);
  }

  return result.data;
}
