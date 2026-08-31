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

/** 校验 MCP client 字符串字段存在且不是空字符串。 */
function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

/** 返回全部已保存 client 的名称和站点地址，且不暴露账号或应用密码。 */
export async function listStoredClients(
  context: WordPressConnectionContext = {}
): Promise<PublicClient[]> {
  const store = new ConfigStore({ configDir: context.configDir });
  return store.listClients();
}

/** 返回指定已保存 client 的名称和站点地址，不存在时立即报错。 */
export async function getStoredClient(
  name: string,
  context: WordPressConnectionContext = {}
): Promise<PublicClient> {
  const store = new ConfigStore({ configDir: context.configDir });
  const requestedName = requireNonEmptyString(name, "Client name");
  const client = await store.getClient(requestedName);
  if (!client) {
    throw new Error(`Client "${requestedName}" not found.`);
  }
  return { name: client.name, siteUrl: client.siteUrl };
}

/**
 * 根据显式 client 名称创建 WordPressClient。
 * 临时站点地址只能改变同源路径，确保保存的应用密码不会发送到其他源。
 */
export async function resolveWordPressClient(
  input: WordPressConnectionInput,
  context: WordPressConnectionContext = {}
): Promise<WordPressClient> {
  const requestedClient = requireNonEmptyString(input.client, "Client");
  const store = new ConfigStore({ configDir: context.configDir });
  const storedClient = await store.getClient(requestedClient);
  if (!storedClient) {
    throw new Error(`Client "${requestedClient}" not found.`);
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
