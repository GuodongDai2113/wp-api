import path from "node:path";
import os from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";

/** 凭据库当前使用的磁盘格式版本。 */
const VAULT_VERSION = 1;
/** AES-GCM 加解密时绑定的固定附加认证数据。 */
const VAULT_AAD = Buffer.from("wp-api-vault-v1", "utf8");
/** 等待另一个进程释放凭据库写锁的最长时间。 */
const LOCK_TIMEOUT_MS = 5_000;
/** 超过该时间的锁文件视为异常退出遗留锁。 */
const STALE_LOCK_MS = 30_000;

/** 保存到加密凭据库中的完整 WordPress client。 */
export interface StoredClient {
  /** client 名称。 */
  name: string;
  /** WordPress 站点地址。 */
  siteUrl: string;
  /** WordPress 用户名。 */
  username: string;
  /** WordPress 应用密码。 */
  appPassword: string;
}

/** 对 Agent 展示时不包含用户名和密码的连接摘要。 */
export interface PublicClient {
  /** client 名称。 */
  name: string;
  /** WordPress 站点地址。 */
  siteUrl: string;
}

/** 解密后的本地 wp-api 配置结构。 */
export interface ConfigData {
  /** 当前激活的 client 名称。 */
  activeClient: string | null;
  /** 已保存的 client 列表。 */
  clients: StoredClient[];
}

/** ConfigStore 构造参数。 */
export interface ConfigStoreOptions {
  /** 覆盖默认配置目录。 */
  configDir?: string;
}

/** AES-GCM 加密凭据库的 JSON 外层结构。 */
interface VaultEnvelope {
  /** 磁盘格式版本。 */
  version: number;
  /** 加密算法标识。 */
  algorithm: "aes-256-gcm";
  /** Base64 编码的随机初始化向量。 */
  iv: string;
  /** Base64 编码的 GCM 认证标签。 */
  authTag: string;
  /** Base64 编码的密文。 */
  ciphertext: string;
}

/** 返回默认用户级配置目录，允许通过环境变量隔离不同实例。 */
function defaultConfigDir(): string {
  const configuredDirectory = process.env.WP_API_CONFIG_DIR?.trim();
  return configuredDirectory ? path.resolve(configuredDirectory) : path.join(os.homedir(), ".wp-api");
}

/** 判断任意值是否是非数组对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断任意值是否是具有全部必填字符串字段的 client。 */
function isStoredClient(value: unknown): value is StoredClient {
  return isRecord(value)
    && typeof value.name === "string"
    && typeof value.siteUrl === "string"
    && typeof value.username === "string"
    && typeof value.appPassword === "string";
}

/** 把解密后的未知 JSON 校验并归一化为当前配置结构。 */
function parseConfigData(value: unknown): ConfigData {
  if (!isRecord(value) || !Array.isArray(value.clients)) {
    throw new Error("Credential vault payload is invalid.");
  }
  const clients = value.clients.filter(isStoredClient).map((client) => ({ ...client }));
  if (clients.length !== value.clients.length) {
    throw new Error("Credential vault contains an invalid client.");
  }
  return {
    activeClient: typeof value.activeClient === "string" ? value.activeClient : null,
    clients
  };
}

/** 把未知 JSON 校验为当前 AES-GCM 外层结构。 */
function parseVaultEnvelope(value: unknown): VaultEnvelope {
  if (!isRecord(value)
    || value.version !== VAULT_VERSION
    || value.algorithm !== "aes-256-gcm"
    || typeof value.iv !== "string"
    || typeof value.authTag !== "string"
    || typeof value.ciphertext !== "string") {
    throw new Error("Credential vault envelope is invalid.");
  }
  return value as unknown as VaultEnvelope;
}

/** 隐藏 client 中的用户名和应用密码，生成可安全展示的对象。 */
function sanitizeClient(client: StoredClient): PublicClient {
  return { name: client.name, siteUrl: client.siteUrl };
}

/** 把未知错误缩窄为带 code 字段的 Node 文件系统错误。 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

/** 暂停指定毫秒数，用于等待跨进程锁释放。 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 尽可能把目录或文件权限收紧到指定模式。 */
async function tightenPermissions(targetPath: string, mode: number): Promise<void> {
  try {
    await chmod(targetPath, mode);
  } catch (error) {
    const unsupportedOnWindows = process.platform === "win32"
      && isNodeError(error)
      && ["EINVAL", "ENOSYS", "ENOTSUP", "EPERM"].includes(error.code ?? "");
    if (!unsupportedOnWindows) throw error;
  }
}

/** 以原子替换方式写入仅限当前用户访问的 UTF-8 文件。 */
async function writeFileAtomic(directory: string, targetPath: string, content: string): Promise<void> {
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const temporaryFile = await open(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    try {
      await temporaryFile.writeFile(content, "utf8");
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }
    await rename(temporaryPath, targetPath);
    temporaryCreated = false;
    await tightenPermissions(targetPath, 0o600);
  } finally {
    if (temporaryCreated) await rm(temporaryPath, { force: true });
  }
}

/** 管理每台主机用户目录中的加密 WordPress 凭据库。 */
export class ConfigStore {
  /** 按凭据库路径共享的进程内写入队列。 */
  private static readonly writeQueues = new Map<string, Promise<void>>();
  /** 凭据库目录路径。 */
  readonly configDir: string;
  /** 加密凭据文件完整路径。 */
  readonly vaultPath: string;
  /** 主机随机密钥文件完整路径。 */
  readonly keyPath: string;
  /** 跨进程锁文件完整路径。 */
  readonly lockPath: string;

  /** 创建一个绑定到指定用户配置目录的凭据存储器。 */
  constructor({ configDir }: ConfigStoreOptions = {}) {
    this.configDir = configDir ? path.resolve(configDir) : defaultConfigDir();
    this.vaultPath = path.join(this.configDir, "vault.json");
    this.keyPath = path.join(this.configDir, "vault.key");
    this.lockPath = path.join(this.configDir, ".vault.lock");
  }

  /** 创建并收紧凭据库目录权限。 */
  private async ensureDirectory(): Promise<void> {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    await tightenPermissions(this.configDir, 0o700);
  }

  /** 读取并校验现有主机密钥；仅在写入时允许创建新密钥。 */
  private async readKey(createIfMissing: boolean): Promise<Buffer> {
    try {
      const encodedKey = (await readFile(this.keyPath, "utf8")).trim();
      const key = Buffer.from(encodedKey, "base64");
      if (key.length !== 32 || key.toString("base64") !== encodedKey) {
        throw new Error("Credential vault key is invalid.");
      }
      return key;
    } catch (error) {
      if (!createIfMissing || !isNodeError(error) || error.code !== "ENOENT") throw error;
      const key = randomBytes(32);
      await writeFileAtomic(this.configDir, this.keyPath, `${key.toString("base64")}\n`);
      return key;
    }
  }

  /** 解密并严格校验磁盘中的凭据库内容。 */
  private async readConfig(): Promise<ConfigData> {
    try {
      const envelope = parseVaultEnvelope(JSON.parse(await readFile(this.vaultPath, "utf8")));
      const key = await this.readKey(false);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(VAULT_AAD);
      decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final()
      ]);
      try {
        return parseConfigData(JSON.parse(plaintext.toString("utf8")));
      } finally {
        plaintext.fill(0);
        key.fill(0);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return { activeClient: null, clients: [] };
      throw new Error("Credential vault could not be decrypted or is invalid.", { cause: error });
    }
  }

  /** 加密并原子替换完整凭据库。 */
  private async writeConfig(data: ConfigData): Promise<void> {
    await this.ensureDirectory();
    const key = await this.readKey(true);
    const iv = randomBytes(12);
    const plaintext = Buffer.from(`${JSON.stringify(data)}\n`, "utf8");
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(VAULT_AAD);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope: VaultEnvelope = {
        version: VAULT_VERSION,
        algorithm: "aes-256-gcm",
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64")
      };
      await writeFileAtomic(this.configDir, this.vaultPath, `${JSON.stringify(envelope, null, 2)}\n`);
    } finally {
      plaintext.fill(0);
      key.fill(0);
    }
  }

  /** 获取跨进程独占锁，并返回负责释放锁的函数。 */
  private async acquireFileLock(): Promise<() => Promise<void>> {
    await this.ensureDirectory();
    const startedAt = Date.now();
    while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
      try {
        const lockFile = await open(this.lockPath, "wx", 0o600);
        await lockFile.writeFile(`${process.pid}\n${Date.now()}\n`, "utf8");
        return async () => {
          await lockFile.close();
          await rm(this.lockPath, { force: true });
        };
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        const lockStats = await stat(this.lockPath).catch(() => null);
        if (lockStats && Date.now() - lockStats.mtimeMs > STALE_LOCK_MS) {
          await rm(this.lockPath, { force: true });
          continue;
        }
        await delay(50);
      }
    }
    throw new Error("Credential vault is busy. Try again shortly.");
  }

  /** 将读改写操作依次加入进程内队列，并在执行时持有跨进程文件锁。 */
  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockKey = process.platform === "win32" ? this.vaultPath.toLowerCase() : this.vaultPath;
    const previous = ConfigStore.writeQueues.get(lockKey) ?? Promise.resolve();
    let releaseQueue: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { releaseQueue = resolve; });
    const queueTail = previous.then(() => current, () => current);
    ConfigStore.writeQueues.set(lockKey, queueTail);
    await previous.catch(() => undefined);
    let releaseFileLock: (() => Promise<void>) | undefined;
    try {
      releaseFileLock = await this.acquireFileLock();
      return await operation();
    } finally {
      await releaseFileLock?.();
      releaseQueue();
      if (ConfigStore.writeQueues.get(lockKey) === queueTail) ConfigStore.writeQueues.delete(lockKey);
    }
  }

  /** 返回全部已保存连接的安全摘要和当前默认连接名称。 */
  async listClients(): Promise<{ activeClient: string | null; clients: PublicClient[] }> {
    const config = await this.readConfig();
    return {
      activeClient: config.activeClient,
      clients: config.clients.slice().sort((left, right) => left.name.localeCompare(right.name)).map(sanitizeClient)
    };
  }

  /** 返回仅供受令牌保护的本地配置 UI 使用的连接资料，密码始终省略。 */
  async listClientsForConfiguration(): Promise<Array<PublicClient & { username: string; passwordSet: boolean }>> {
    const config = await this.readConfig();
    return config.clients.slice().sort((left, right) => left.name.localeCompare(right.name)).map((client) => ({
      name: client.name,
      siteUrl: client.siteUrl,
      username: client.username,
      passwordSet: client.appPassword.length > 0
    }));
  }

  /** 新增或更新连接；originalName 不同时执行重命名并同步默认连接。 */
  async saveClient(client: StoredClient, originalName: string = client.name): Promise<PublicClient> {
    return this.withWriteLock(async () => {
      const config = await this.readConfig();
      if (originalName !== client.name && config.clients.some((entry) => entry.name === client.name)) {
        throw new Error(`Client "${client.name}" already exists.`);
      }
      const existingIndex = config.clients.findIndex((entry) => entry.name === originalName);
      if (existingIndex >= 0) config.clients[existingIndex] = { ...client };
      else config.clients.push({ ...client });
      if (config.activeClient === originalName) config.activeClient = client.name;
      await this.writeConfig(config);
      return sanitizeClient(client);
    });
  }

  /** 读取指定连接的完整凭据，仅供内部创建已认证 WordPressClient。 */
  async getClient(name: string): Promise<StoredClient | null> {
    const config = await this.readConfig();
    return config.clients.find((entry) => entry.name === name) ?? null;
  }

  /** 根据显式名称或当前默认名称解析内部连接凭据。 */
  async getResolvedClient(name?: string): Promise<StoredClient | null> {
    const config = await this.readConfig();
    const resolvedName = name || config.activeClient;
    return resolvedName ? config.clients.find((entry) => entry.name === resolvedName) ?? null : null;
  }

  /** 将指定连接设为当前默认连接并返回安全摘要。 */
  async setActiveClient(name: string): Promise<PublicClient> {
    return this.withWriteLock(async () => {
      const config = await this.readConfig();
      const client = config.clients.find((entry) => entry.name === name);
      if (!client) throw new Error(`Client "${name}" not found.`);
      config.activeClient = name;
      await this.writeConfig(config);
      return sanitizeClient(client);
    });
  }

  /** 删除指定连接，并在删除默认连接时同步清空选择。 */
  async removeClient(name: string): Promise<void> {
    await this.withWriteLock(async () => {
      const config = await this.readConfig();
      if (!config.clients.some((entry) => entry.name === name)) throw new Error(`Client "${name}" not found.`);
      config.clients = config.clients.filter((entry) => entry.name !== name);
      if (config.activeClient === name) config.activeClient = null;
      await this.writeConfig(config);
    });
  }

}
