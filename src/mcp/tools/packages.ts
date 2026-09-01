import type { ListResult, QueryParams, WordPressClient } from "../../wordpress/client.js";

/** MCP 软件包工具支持的软件包类型。 */
export type WordPressPackageType = "plugin" | "theme";

/** MCP 软件包列表工具支持的激活状态筛选值。 */
export type WordPressPackageStatus = "active" | "inactive";

/** 软件包列表工具的直接执行输入。 */
export interface PackageListInput {
  /** 要列出的 WordPress 软件包类型。 */
  packageType: WordPressPackageType;
  /** 可选的插件或主题激活状态筛选条件。 */
  status?: WordPressPackageStatus;
  /** 可选的插件搜索文本；主题列表会忽略此字段。 */
  search?: string;
}

/** 单个软件包读取工具的直接执行输入。 */
export interface PackageGetInput {
  /** 要读取的 WordPress 软件包类型。 */
  packageType: WordPressPackageType;
  /** 插件文件标识或主题 stylesheet 标识。 */
  package: string;
}

/** 软件包安装或更新工具的直接执行输入。 */
export interface PackageFileMutationInput {
  /** 要安装或更新的 WordPress 软件包类型。 */
  packageType: WordPressPackageType;
  /** MCP 服务进程已经完成边界校验的本地 ZIP 绝对路径。 */
  file: string;
}

/** 软件包激活或停用工具的直接执行输入。 */
export interface PackageStatusMutationInput {
  /** 要变更状态的 WordPress 软件包类型。 */
  packageType: WordPressPackageType;
  /** 插件文件标识或主题 stylesheet 标识。 */
  package: string;
}

/** WordPress 原生插件 REST 实体中本模块会使用的字段。 */
export interface PluginEntity {
  /** 插件主文件标识，例如 `akismet/akismet`。 */
  plugin: string;
  /** 插件当前激活状态。 */
  status: string;
  /** 插件显示名称。 */
  name: string;
  /** 插件版本。 */
  version: string;
  /** 插件描述。 */
  description: string;
  /** 插件主页地址。 */
  plugin_uri?: string;
  /** 插件作者。 */
  author?: string;
  /** 插件作者主页地址。 */
  author_uri?: string;
  /** 插件要求的最低 WordPress 版本。 */
  requires_wp?: string;
  /** 插件要求的最低 PHP 版本。 */
  requires_php?: string;
  /** 插件是否只能在多站点网络级启用。 */
  network_only?: boolean;
  /** 插件文本域。 */
  text_domain?: string;
}

/** WordPress 主题实体返回的已渲染名称对象。 */
export interface RenderedThemeName {
  /** WordPress 已渲染并可直接展示的主题名称。 */
  rendered?: string;
}

/** WordPress 原生主题 REST 实体中本模块会使用的字段。 */
export interface ThemeEntity {
  /** 主题目录对应的 stylesheet 标识。 */
  stylesheet: string;
  /** 主题显示名称。 */
  name?: RenderedThemeName | string;
  /** 主题版本。 */
  version?: string;
  /** 主题当前激活状态。 */
  status?: string;
  /** WordPress 或扩展接口返回的其他主题字段。 */
  [key: string]: unknown;
}

/** Jelly Core 插件安装或更新接口的结构化响应。 */
export interface JellyPluginInstallResult {
  /** 操作是否成功。 */
  success: boolean;
  /** 实际执行的动作，例如 installed 或 updated。 */
  action: string;
  /** 插件显示名称。 */
  plugin_name: string;
  /** 插件主文件标识。 */
  plugin_file: string;
  /** 操作前插件是否已经存在。 */
  plugin_exists_before: boolean;
  /** 操作前插件是否处于激活状态。 */
  was_active: boolean;
  /** 操作后插件是否处于激活状态。 */
  is_active: boolean;
  /** Jelly Core 返回的人类可读消息。 */
  message: string;
}

/** Jelly Core 主题安装或更新接口的结构化响应。 */
export interface JellyThemeInstallResult {
  /** 操作是否成功。 */
  success: boolean;
  /** 实际执行的动作，例如 installed 或 updated。 */
  action: string;
  /** 主题显示名称。 */
  theme_name: string;
  /** 主题目录 slug。 */
  theme_slug: string;
  /** 主题版本。 */
  theme_version: string;
  /** 操作后主题是否处于激活状态。 */
  is_active: boolean;
}

/** Jelly Core 前置检查读取的插件实体最小字段集合。 */
interface JellyCorePluginCandidate {
  /** WordPress 插件主文件标识。 */
  plugin?: string;
  /** 某些兼容接口返回的插件目录 slug。 */
  slug?: string;
  /** 插件当前激活状态。 */
  status?: string;
}

/** 校验软件包类型并返回可用于路由选择的窄化类型。 */
function validatePackageType(packageType: unknown): WordPressPackageType {
  if (packageType !== "plugin" && packageType !== "theme") {
    throw new Error("packageType must be plugin or theme.");
  }
  return packageType;
}

/** 校验必填字符串，拒绝缺失值和仅包含空白字符的值。 */
function validateRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required string field: ${fieldName}`);
  }
  return value;
}

/**
 * 校验插件文件标识或主题 stylesheet 标识只包含 WordPress slug 安全字符。
 * 该限制会阻止 `..` 和额外斜杠改变后续 REST API 路由。
 */
function validatePackageIdentifier(
  packageType: WordPressPackageType,
  value: unknown
): string {
  const identifier = validateRequiredString(value, "package");
  const segments = identifier.split("/");
  const expectedSegmentCount = packageType === "plugin" ? [1, 2] : [1];
  const hasSafeSegments = expectedSegmentCount.includes(segments.length)
    && segments.every((segment) => (
      segment !== "."
      && segment !== ".."
      && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)
    ));

  if (!hasSafeSegments) {
    throw new Error(
      packageType === "plugin"
        ? "Plugin package must be a safe plugin slug or directory/file identifier."
        : "Theme package must be a safe stylesheet slug."
    );
  }
  return identifier;
}

/** 根据软件包类型返回 WordPress 原生 REST 路由。 */
function packageRoute(packageType: WordPressPackageType): "plugins" | "themes" {
  return packageType === "plugin" ? "plugins" : "themes";
}

/** 判断插件列表是否包含处于激活状态的 Jelly Core。 */
export function hasActiveJellyCore(items: readonly unknown[]): boolean {
  return items.some((item) => {
    if (typeof item !== "object" || item === null) {
      return false;
    }

    const plugin = item as JellyCorePluginCandidate;
    const identifier = plugin.plugin ?? plugin.slug ?? "";
    return plugin.status === "active"
      && (
        identifier === "jelly-core"
        || identifier === "jelly-core/jelly-core"
        || identifier === "jelly-core/jelly-core.php"
      );
  });
}

/**
 * 在调用 Jelly Core 自定义接口前确认核心插件已经激活。
 * 逐页查询激活插件并在找到 Jelly Core 后立即停止，避免把全部插件聚合进内存。
 */
export async function assertJellyCoreIsActive(client: WordPressClient): Promise<void> {
  let page = 1;
  while (true) {
    const result = await client.list<JellyCorePluginCandidate>("plugins", {
      status: "active",
      page,
      per_page: 100
    });
    if (hasActiveJellyCore(result.items)) {
      return;
    }
    if (page >= result.pagination.totalPages) {
      break;
    }
    page += 1;
  }
  throw new Error(
    "Jelly Core is not installed and active on the target site. "
    + "This operation requires Jelly Core, so no install, update, or theme activation was attempted."
  );
}

/** 直接列出 WordPress 插件或主题。 */
export async function listPackages(
  client: WordPressClient,
  input: PackageListInput
): Promise<ListResult<PluginEntity | ThemeEntity>> {
  const packageType = validatePackageType(input.packageType);
  const query: QueryParams = {};

  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "inactive") {
      throw new Error("status must be active or inactive.");
    }
    query.status = input.status;
  }
  if (packageType === "plugin" && input.search !== undefined) {
    query.search = input.search;
  }

  return client.list<PluginEntity | ThemeEntity>(packageRoute(packageType), query);
}

/** 直接读取单个 WordPress 插件或主题。 */
export async function getPackage(
  client: WordPressClient,
  input: PackageGetInput
): Promise<PluginEntity | ThemeEntity> {
  const packageType = validatePackageType(input.packageType);
  const packageName = validatePackageIdentifier(packageType, input.package);
  const result = await client.request<PluginEntity | ThemeEntity>(`${packageRoute(packageType)}/${packageName}`);
  return result.data;
}

/** 执行本地 ZIP 软件包安装或更新共用的 Jelly Core 调用流程。 */
async function mutatePackageFromFile(
  client: WordPressClient,
  input: PackageFileMutationInput
): Promise<JellyPluginInstallResult | JellyThemeInstallResult> {
  const packageType = validatePackageType(input.packageType);
  const file = validateRequiredString(input.file, "file");
  await assertJellyCoreIsActive(client);

  return packageType === "plugin"
    ? client.uploadPluginFromFile<JellyPluginInstallResult>(file)
    : client.uploadThemeFromFile<JellyThemeInstallResult>(file);
}

/** 从本地 ZIP 安装插件或主题，并在变更前校验 Jelly Core。 */
export async function installPackage(
  client: WordPressClient,
  input: PackageFileMutationInput
): Promise<JellyPluginInstallResult | JellyThemeInstallResult> {
  return mutatePackageFromFile(client, input);
}

/** 从本地 ZIP 更新插件或主题，并在变更前校验 Jelly Core。 */
export async function updatePackage(
  client: WordPressClient,
  input: PackageFileMutationInput
): Promise<JellyPluginInstallResult | JellyThemeInstallResult> {
  return mutatePackageFromFile(client, input);
}

/**
 * 激活插件或主题。
 * 插件使用 WordPress 原生接口；主题使用 Jelly Core，并在切换前执行核心插件检查。
 */
export async function activatePackage(
  client: WordPressClient,
  input: PackageStatusMutationInput
): Promise<PluginEntity | unknown> {
  const packageType = validatePackageType(input.packageType);
  const packageName = validatePackageIdentifier(packageType, input.package);

  if (packageType === "theme") {
    await assertJellyCoreIsActive(client);
    return client.updateThemeStatus(packageName, "active");
  }

  const result = await client.request<PluginEntity>(`plugins/${packageName}`, {
    method: "PUT",
    body: { status: "active" }
  });
  return result.data;
}

/** 使用 WordPress 原生插件接口停用插件，并明确拒绝不支持的主题停用。 */
export async function deactivatePackage(
  client: WordPressClient,
  input: PackageStatusMutationInput
): Promise<PluginEntity> {
  const packageType = validatePackageType(input.packageType);
  if (packageType === "theme") {
    throw new Error("Themes cannot be deactivated through wp_package_deactivate.");
  }

  const packageName = validatePackageIdentifier(packageType, input.package);
  const result = await client.request<PluginEntity>(`plugins/${packageName}`, {
    method: "PUT",
    body: { status: "inactive" }
  });
  return result.data;
}
