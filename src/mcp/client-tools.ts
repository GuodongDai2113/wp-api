import { ConfigStore, type PublicClient } from "../lib/config-store.js";
import { WordPressClient, normalizeWordPressBaseUrl } from "../lib/wp-client.js";

/** MCP client 工具和远端连接解析共用的运行上下文。 */
export interface WordPressConnectionContext {
  /** 覆盖默认配置目录，便于隔离不同 MCP 服务实例或测试。 */
  configDir?: string;
  /** 覆盖网络请求实现，主要用于测试或受控运行环境。 */
  fetchImpl?: typeof fetch;
  /** 接收网络诊断信息的日志对象。 */
  logger?: Pick<Console, "error">;
}

/** 需要连接 WordPress 站点的 MCP 工具共用输入。 */
export interface WordPressConnectionInput {
  /** 本次调用显式选择的已保存 client 名称。 */
  client?: string;
  /** 本次调用使用的同源 WordPress 子路径覆盖地址。 */
  siteUrl?: string;
}

/** client 列表工具返回的安全结构。 */
export interface ClientListResult {
  /** 当前激活的 client 名称；尚未选择时为 null。 */
  activeClient: string | null;
  /** 已移除应用密码的 client 列表。 */
  clients: PublicClient[];
}

/** 校验 MCP client 字符串字段存在且不是空字符串。 */
function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

/** 返回全部已保存 client 与当前激活名称，且不暴露应用密码。 */
export async function listStoredClients(
  context: WordPressConnectionContext = {}
): Promise<ClientListResult> {
  const store = new ConfigStore({ configDir: context.configDir });
  return store.listClients();
}

/** 将一个已保存 client 设为当前激活项，并返回不含密码的公开信息。 */
export async function useStoredClient(
  name: string,
  context: WordPressConnectionContext = {}
): Promise<PublicClient> {
  const store = new ConfigStore({ configDir: context.configDir });
  return store.setActiveClient(requireNonEmptyString(name, "Client name"));
}

/**
 * 根据显式 client 或当前激活项创建 WordPressClient。
 * 临时站点地址只能改变同源路径，确保保存的应用密码不会发送到其他源。
 */
export async function resolveWordPressClient(
  input: WordPressConnectionInput,
  context: WordPressConnectionContext = {}
): Promise<WordPressClient> {
  const requestedClient = input.client === undefined
    ? undefined
    : requireNonEmptyString(input.client, "Client");
  const store = new ConfigStore({ configDir: context.configDir });
  const storedClient = await store.getResolvedClient(requestedClient);
  if (!storedClient) {
    throw new Error("No client selected. Add a client and select it with wp_client_use first.");
  }

  const savedSiteUrl = normalizeWordPressBaseUrl(storedClient.siteUrl);
  let baseUrl = savedSiteUrl;
  if (input.siteUrl !== undefined) {
    const overrideSiteUrl = normalizeWordPressBaseUrl(
      requireNonEmptyString(input.siteUrl, "Site URL override")
    );
    if (new URL(overrideSiteUrl).origin !== new URL(savedSiteUrl).origin) {
      throw new Error("Site URL override must have the same origin as the saved site URL.");
    }
    baseUrl = overrideSiteUrl;
  }

  return new WordPressClient({
    baseUrl,
    username: storedClient.username,
    appPassword: storedClient.appPassword,
    fetchImpl: context.fetchImpl,
    logger: context.logger
  });
}
