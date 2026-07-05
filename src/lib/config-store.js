import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

function defaultConfigDir() {
  return path.join(os.homedir(), ".wp-api");
}

function sanitizeClient(client) {
  return {
    name: client.name,
    siteUrl: client.siteUrl,
    username: client.username
  };
}

function normalizeClient(client) {
  return {
    name: client.name,
    siteUrl: client.siteUrl,
    username: client.username,
    appPassword: client.appPassword
  };
}

export class ConfigStore {
  constructor({ configDir } = {}) {
    this.configDir = configDir ?? defaultConfigDir();
    this.configPath = path.join(this.configDir, "config.json");
  }

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
        activeClient: parsed.activeClient ?? parsed.activeProfile ?? null,
        clients: rawClients.map(normalizeClient)
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { activeClient: null, clients: [] };
      }
      throw error;
    }
  }

  async save(data) {
    await mkdir(this.configDir, { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async saveClient(client) {
    const config = await this.load();
    const nextClient = normalizeClient(client);

    const existingIndex = config.clients.findIndex((entry) => entry.name === client.name);
    if (existingIndex >= 0) {
      config.clients[existingIndex] = nextClient;
    } else {
      config.clients.push(nextClient);
      config.clients.sort((left, right) => left.name.localeCompare(right.name));
    }

    await this.save(config);
    return sanitizeClient(nextClient);
  }

  async listClients() {
    const config = await this.load();
    return config.clients
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(sanitizeClient);
  }

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

  async getActiveClient() {
    const config = await this.load();
    if (!config.activeClient) {
      return null;
    }

    const client = config.clients.find((entry) => entry.name === config.activeClient);
    return client ? sanitizeClient(client) : null;
  }

  async getClient(name) {
    const config = await this.load();
    const client = config.clients.find((entry) => entry.name === name);
    return client ?? null;
  }

  async getResolvedClient(name) {
    if (name) {
      return this.getClient(name);
    }

    const config = await this.load();
    if (!config.activeClient) {
      return null;
    }

    return config.clients.find((entry) => entry.name === config.activeClient) ?? null;
  }

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
