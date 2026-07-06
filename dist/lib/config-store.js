import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
/** 返回默认 wp-api 配置目录。 */
function defaultConfigDir() {
    return path.join(os.homedir(), ".wp-api");
}
/** 判断任意值是否是可归一化的 client 对象。 */
function isClientLike(client) {
    return typeof client === "object" && client !== null;
}
/** 隐藏 client 中的 Application Password，生成可安全展示的对象。 */
function sanitizeClient(client) {
    return {
        name: client.name,
        siteUrl: client.siteUrl,
        username: client.username
    };
}
/** 将配置文件中的 client 记录归一化为当前存储结构。 */
function normalizeClient(client) {
    return {
        name: String(client.name ?? ""),
        siteUrl: String(client.siteUrl ?? ""),
        username: String(client.username ?? ""),
        appPassword: String(client.appPassword ?? "")
    };
}
/** 把未知错误缩窄为带 code 字段的 Node 文件系统错误。 */
function isNodeError(error) {
    return error instanceof Error;
}
/** 管理 wp-api 本地配置文件的读写和 client 选择。 */
export class ConfigStore {
    /** 配置目录路径。 */
    configDir;
    /** 配置文件完整路径。 */
    configPath;
    /** 创建一个绑定到指定配置目录的配置存储器。 */
    constructor({ configDir } = {}) {
        this.configDir = configDir ?? defaultConfigDir();
        this.configPath = path.join(this.configDir, "config.json");
    }
    /** 读取配置文件，并兼容旧版 profile 字段。 */
    async load() {
        try {
            const raw = await readFile(this.configPath, "utf8");
            const parsed = JSON.parse(raw);
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
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") {
                return { activeClient: null, clients: [] };
            }
            throw error;
        }
    }
    /** 保存完整配置数据到本地 JSON 文件。 */
    async save(data) {
        await mkdir(this.configDir, { recursive: true });
        await writeFile(this.configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    }
    /** 新增或覆盖保存一个 client，并返回隐藏密码后的对象。 */
    async saveClient(client) {
        const config = await this.load();
        const nextClient = normalizeClient(client);
        const existingIndex = config.clients.findIndex((entry) => entry.name === client.name);
        if (existingIndex >= 0) {
            config.clients[existingIndex] = nextClient;
        }
        else {
            config.clients.push(nextClient);
            config.clients.sort((left, right) => left.name.localeCompare(right.name));
        }
        await this.save(config);
        return sanitizeClient(nextClient);
    }
    /** 返回所有已保存 client 的安全展示对象。 */
    async listClients() {
        const config = await this.load();
        return config.clients
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name))
            .map(sanitizeClient);
    }
    /** 将指定 client 设置为当前激活 client。 */
    async setActiveClient(name) {
        const config = await this.load();
        const client = config.clients.find((entry) => entry.name === name);
        if (!client) {
            throw new Error(`Client "${name}" not found.`);
        }
        config.activeClient = name;
        await this.save(config);
        return sanitizeClient(client);
    }
    /** 获取当前激活 client 的安全展示对象。 */
    async getActiveClient() {
        const config = await this.load();
        if (!config.activeClient) {
            return null;
        }
        const client = config.clients.find((entry) => entry.name === config.activeClient);
        return client ? sanitizeClient(client) : null;
    }
    /** 获取指定 client 的完整存储对象。 */
    async getClient(name) {
        const config = await this.load();
        const client = config.clients.find((entry) => entry.name === name);
        return client ?? null;
    }
    /** 根据显式名称或当前激活名称解析可用于请求的完整 client。 */
    async getResolvedClient(name) {
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
    async removeClient(name) {
        const config = await this.load();
        const nextClients = config.clients.filter((entry) => entry.name !== name);
        config.clients = nextClients;
        if (config.activeClient === name) {
            config.activeClient = null;
        }
        await this.save(config);
    }
}
