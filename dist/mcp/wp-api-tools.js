import { runCli } from "../cli.js";
/** 将可选的全局 client 参数追加到 CLI 参数列表。 */
function appendGlobalArgs(args, input) {
    appendOption(args, "--client", readOptionalString(input, "client"));
    appendOption(args, "--site-url", readOptionalString(input, "siteUrl"));
}
/** 将一个可选命令行参数追加到 CLI 参数列表。 */
function appendOption(args, flag, value) {
    if (value === undefined || value === null || value === "") {
        return;
    }
    args.push(flag, String(value));
}
/** 读取必填字符串字段，缺失或类型错误时抛出明确错误。 */
function readRequiredString(input, key) {
    const value = input[key];
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Missing required string field: ${key}`);
    }
    return value;
}
/** 读取可选字符串字段，未提供时返回 undefined。 */
function readOptionalString(input, key) {
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
function readRequiredNumber(input, key) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Missing required number field: ${key}`);
    }
    return value;
}
/** 读取可选数字字段，未提供时返回 undefined。 */
function readOptionalNumber(input, key) {
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
function readOptionalBoolean(input, key) {
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
function readOptionalNumberCsv(input, key) {
    const value = input[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
        throw new Error(`Expected number array field: ${key}`);
    }
    return value.map((entry) => String(entry)).join(",");
}
/** 根据 MCP 工具输入构造 client list 的 CLI 参数。 */
function buildClientListArgs() {
    return ["client", "list", "--json"];
}
/** 根据 MCP 工具输入构造 client add 的 CLI 参数。 */
function buildClientAddArgs(input) {
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
function buildClientUseArgs(input) {
    return ["client", "use", readRequiredString(input, "name")];
}
/** 根据 MCP 工具输入构造资源列表查询的 CLI 参数。 */
function buildResourceListArgs(input) {
    const args = [];
    appendGlobalArgs(args, input);
    args.push(readRequiredString(input, "resource"), "list", "--json");
    appendOption(args, "--search", readOptionalString(input, "search"));
    appendOption(args, "--page", readOptionalNumber(input, "page"));
    appendOption(args, "--per-page", readOptionalNumber(input, "perPage"));
    appendOption(args, "--status", readOptionalString(input, "status"));
    return args;
}
/** 根据 MCP 工具输入构造单个资源读取的 CLI 参数。 */
function buildResourceGetArgs(input) {
    const args = [];
    appendGlobalArgs(args, input);
    args.push(readRequiredString(input, "resource"), "get", String(readRequiredNumber(input, "id")), "--json");
    return args;
}
/** 将内容类和分类类资源字段追加到 create/update CLI 参数。 */
function appendResourceBodyArgs(args, input) {
    appendOption(args, "--title", readOptionalString(input, "title"));
    appendOption(args, "--slug", readOptionalString(input, "slug"));
    appendOption(args, "--status", readOptionalString(input, "status"));
    appendOption(args, "--excerpt", readOptionalString(input, "excerpt"));
    appendOption(args, "--content", readOptionalString(input, "content"));
    appendOption(args, "--content-file", readOptionalString(input, "contentFile"));
    appendOption(args, "--categories", readOptionalNumberCsv(input, "categories"));
    appendOption(args, "--name", readOptionalString(input, "name"));
    appendOption(args, "--description", readOptionalString(input, "description"));
    appendOption(args, "--parent", readOptionalNumber(input, "parent"));
}
/** 根据 MCP 工具输入构造资源创建的 CLI 参数。 */
function buildResourceCreateArgs(input) {
    const args = [];
    appendGlobalArgs(args, input);
    args.push(readRequiredString(input, "resource"), "create", "--json");
    appendResourceBodyArgs(args, input);
    return args;
}
/** 根据 MCP 工具输入构造资源更新的 CLI 参数。 */
function buildResourceUpdateArgs(input) {
    const args = [];
    appendGlobalArgs(args, input);
    args.push(readRequiredString(input, "resource"), "update", String(readRequiredNumber(input, "id")), "--json");
    appendResourceBodyArgs(args, input);
    return args;
}
/** 根据 MCP 工具输入构造资源删除的 CLI 参数。 */
function buildResourceDeleteArgs(input) {
    const args = [];
    appendGlobalArgs(args, input);
    args.push(readRequiredString(input, "resource"), "delete", String(readRequiredNumber(input, "id")), "--json");
    if (readOptionalBoolean(input, "force")) {
        args.push("--force");
    }
    return args;
}
/** 根据 MCP 工具输入构造 SEO 读取的 CLI 参数。 */
function buildSeoGetArgs(input) {
    const args = [];
    appendGlobalArgs(args, input);
    args.push("seo", readRequiredString(input, "resource"), String(readRequiredNumber(input, "id")), "--json");
    return args;
}
/** 根据 MCP 工具输入构造 SEO 更新的 CLI 参数。 */
function buildSeoUpdateArgs(input) {
    const args = buildSeoGetArgs(input);
    appendOption(args, "--title", readOptionalString(input, "title"));
    appendOption(args, "--description", readOptionalString(input, "description"));
    appendOption(args, "--focus-keyword", readOptionalString(input, "focusKeyword"));
    return args;
}
/** 根据 MCP 工具输入构造文章链接添加的 CLI 参数。 */
function buildPostLinkAddArgs(input) {
    const args = [];
    appendGlobalArgs(args, input);
    args.push("links", "add", String(readRequiredNumber(input, "postId")), "--json", "--text", readRequiredString(input, "text"), "--href", readRequiredString(input, "href"));
    return args;
}
/** 将 MCP 工具名和输入对象转换为现有 CLI 可以消费的 argv 数组。 */
export function buildCliArgsForTool(toolName, input = {}) {
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
        default:
            throw new Error(`Unknown MCP tool: ${toolName}`);
    }
}
/** 执行一个 wp-api MCP 工具，并返回 runCli 提供的结构化数据。 */
export async function executeWpApiTool(toolName, input = {}, context = {}) {
    const runCliImpl = context.runCliImpl ?? runCli;
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
