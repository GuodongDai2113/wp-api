import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";

/** 保存到本地配置文件中的完整 WordPress client。 */
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

/** 对外展示时隐藏密码后的 client。 */
export type PublicClient = Omit<StoredClient, "appPassword">;

/** 本地 wp-api 配置文件结构。 */
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

/** 兼容旧 profile 配置和当前 client 配置的原始文件结构。 */
interface RawConfigData {
  /** 当前激活的 client 名称。 */
  activeClient?: unknown;
  /** 旧版当前激活 profile 名称。 */
  activeProfile?: unknown;
  /** 当前 client 列表。 */
  clients?: unknown;
  /** 旧版 profile 列表。 */
  profiles?: unknown;
}

/** 返回默认 wp-api 配置目录。 */
function defaultConfigDir(): string {
  return path.join(os.homedir(), ".wp-api");
}

/** 判断任意值是否是可归一化的 client 对象。 */
function isClientLike(client: unknown): client is Partial<StoredClient> {
  return typeof client === "object" && client !== null;
}

/** 隐藏 client 中的应用密码，生成可安全展示的对象。 */
function sanitizeClient(client: StoredClient): PublicClient {
  return {
    name: client.name,
    siteUrl: client.siteUrl,
    username: client.username
  };
}

/** 将配置文件中的 client 记录归一化为当前存储结构。 */
function normalizeClient(client: Partial<StoredClient>): StoredClient {
  return {
    name: String(client.name ?? ""),
    siteUrl: String(client.siteUrl ?? ""),
    username: String(client.username ?? ""),
    appPassword: String(client.appPassword ?? "")
  };
}

/** 把未知错误缩窄为带 code 字段的 Node 文件系统错误。 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

/**
 * 尽可能把配置目录或文件权限收紧到指定模式。
 * Windows 不完整支持 POSIX 权限位，因此仅忽略该平台明确返回的不支持类错误。
 */
async function tightenPermissions(targetPath: string, mode: number): Promise<void> {
  try {
    await chmod(targetPath, mode);
  } catch (error) {
    const unsupportedOnWindows = process.platform === "win32"
      && isNodeError(error)
      && ["EINVAL", "ENOSYS", "ENOTSUP", "EPERM"].includes(error.code ?? "");

    if (!unsupportedOnWindows) {
      throw error;
    }
  }
}

/** 管理 wp-api 本地配置文件的读写和 client 选择。 */
export class ConfigStore {
  /** 按配置文件路径共享的进程内写入队列，避免多个实例互相覆盖更新。 */
  private static readonly writeQueues = new Map<string, Promise<void>>();

  /** 配置目录路径。 */
  configDir: string;
  /** 配置文件完整路径。 */
  configPath: string;

  /** 创建一个绑定到指定配置目录的配置存储器。 */
  constructor({ configDir }: ConfigStoreOptions = {}) {
    this.configDir = configDir ?? defaultConfigDir();
    this.configPath = path.join(this.configDir, "config.json");
  }

  /** 读取配置文件，并兼容旧版 profile 字段。 */
  async load(): Promise<ConfigData> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as RawConfigData;
      const rawClients = Array.isArray(parsed.clients)
        ? parsed.clients
        : Array.isArray(parsed.profiles)
          ? parsed.profiles
          : [];

      return {
        activeClient: typeof parsed.activeClient === "string"
          ? parsed.activeClient
          : typeof parsed.activeProfile === "string"
            ? parsed.activeProfile
            : null,
        clients: rawClients.filter(isClientLike).map(normalizeClient)
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { activeClient: null, clients: [] };
      }
      throw error;
    }
  }

  /**
   * 将操作加入当前配置文件的进程内写入队列，并在结束后释放队列位置。
   * 队列覆盖整个“读取—修改—写入”过程，以避免同一进程内的更新丢失。
   */
  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const resolvedPath = path.resolve(this.configPath);
    const lockKey = process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
    const previous = ConfigStore.writeQueues.get(lockKey) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queueTail = previous.then(() => current, () => current);

    ConfigStore.writeQueues.set(lockKey, queueTail);
    await previous.catch(() => undefined);

    try {
      return await operation();
    } finally {
      release();
      if (ConfigStore.writeQueues.get(lockKey) === queueTail) {
        ConfigStore.writeQueues.delete(lockKey);
      }
    }
  }

  /**
   * 使用同目录临时文件写入完整 JSON，再原子替换正式配置文件。
   * 临时文件和最终文件均限制为当前用户读写，失败时清理临时文件。
   */
  private async writeConfigAtomic(data: ConfigData): Promise<void> {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    await tightenPermissions(this.configDir, 0o700);

    const tempPath = path.join(
      this.configDir,
      `.config.json.${process.pid}.${randomUUID()}.tmp`
    );
    let tempFileCreated = false;

    try {
      const tempFile = await open(tempPath, "wx", 0o600);
      tempFileCreated = true;
      try {
        await tempFile.writeFile(`${JSON.stringify(data, null, 2)}\n`, "utf8");
        await tempFile.sync();
      } finally {
        await tempFile.close();
      }

      await rename(tempPath, this.configPath);
      tempFileCreated = false;
      await tightenPermissions(this.configPath, 0o600);
    } finally {
      if (tempFileCreated) {
        await rm(tempPath, { force: true });
      }
    }
  }

  /** 保存完整配置数据到本地 JSON 文件，并保证单次替换的原子性。 */
  async save(data: ConfigData): Promise<void> {
    await this.withWriteLock(() => this.writeConfigAtomic(data));
  }

  /** 新增或覆盖保存一个 client，并返回隐藏密码后的对象。 */
  async saveClient(client: StoredClient): Promise<PublicClient> {
    return this.withWriteLock(async () => {
      const config = await this.load();
      const nextClient = normalizeClient(client);

      const existingIndex = config.clients.findIndex((entry) => entry.name === client.name);
      if (existingIndex >= 0) {
        config.clients[existingIndex] = nextClient;
      } else {
        config.clients.push(nextClient);
        config.clients.sort((left, right) => left.name.localeCompare(right.name));
      }

      await this.writeConfigAtomic(config);
      return sanitizeClient(nextClient);
    });
  }

  /** 返回所有已保存 client 的安全展示对象。 */
  async listClients(): Promise<PublicClient[]> {
    const config = await this.load();
    return config.clients
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(sanitizeClient);
  }

  /** 将指定 client 设置为当前激活 client。 */
  async setActiveClient(name: string): Promise<PublicClient> {
    return this.withWriteLock(async () => {
      const config = await this.load();
      const client = config.clients.find((entry) => entry.name === name);
      if (!client) {
        throw new Error(`Client "${name}" not found.`);
      }

      config.activeClient = name;
      await this.writeConfigAtomic(config);
      return sanitizeClient(client);
    });
  }

  /** 获取当前激活 client 的安全展示对象。 */
  async getActiveClient(): Promise<PublicClient | null> {
    const config = await this.load();
    if (!config.activeClient) {
      return null;
    }

    const client = config.clients.find((entry) => entry.name === config.activeClient);
    return client ? sanitizeClient(client) : null;
  }

  /** 获取指定 client 的完整存储对象。 */
  async getClient(name: string): Promise<StoredClient | null> {
    const config = await this.load();
    const client = config.clients.find((entry) => entry.name === name);
    return client ?? null;
  }

  /** 根据显式名称或当前激活名称解析可用于请求的完整 client。 */
  async getResolvedClient(name?: string): Promise<StoredClient | null> {
    if (typeof name === "string" && name.length > 0) {
      return this.getClient(name);
    }

    const config = await this.load();
    if (!config.activeClient) {
      return null;
    }

    return config.clients.find((entry) => entry.name === config.activeClient) ?? null;
  }

  /** 删除指定 client，并在必要时清空当前激活 client。 */
  async removeClient(name: string): Promise<void> {
    await this.withWriteLock(async () => {
      const config = await this.load();
      const nextClients = config.clients.filter((entry) => entry.name !== name);
      config.clients = nextClients;
      if (config.activeClient === name) {
        config.activeClient = null;
      }
      await this.writeConfigAtomic(config);
    });
  }
}
