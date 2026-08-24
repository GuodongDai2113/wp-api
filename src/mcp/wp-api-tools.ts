import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { createPackageArchive } from "../lib/package-archive.js";
import type { WordPressClient } from "../lib/wp-client.js";
import {
  listStoredClients,
  resolveWordPressClient,
  useStoredClient,
  type WordPressConnectionContext,
  type WordPressConnectionInput
} from "./client-tools.js";
import {
  createResource,
  deleteResource,
  getResource,
  getResourceSeo,
  listResource,
  managePostLink,
  replacePostContent,
  updateResource,
  updateResourceSeo,
  uploadMedia,
  type MediaUploadInput,
  type PostContentReplaceInput,
  type PostLinkInput,
  type ResourceCreateInput,
  type ResourceDeleteInput,
  type ResourceGetInput,
  type ResourceListInput,
  type ResourceSeoGetInput,
  type ResourceSeoUpdateInput,
  type ResourceUpdateInput
} from "./handlers/content-tools.js";
import {
  executeElementorTool,
  type ElementorToolName
} from "./handlers/elementor-tools.js";
import {
  activatePackage,
  deactivatePackage,
  getPackage,
  installPackage,
  listPackages,
  updatePackage,
  type PackageFileMutationInput,
  type PackageGetInput,
  type PackageListInput,
  type PackageStatusMutationInput
} from "./handlers/package-tools.js";
import {
  getJellyFormInquiry,
  getJellyFormSettings,
  listJellyFormInquiries,
  updateJellyFormSettings,
  type JellyFormInquiryGetInput,
  type JellyFormInquiryListInput,
  type JellyFormSettingsUpdateInput
} from "./handlers/jelly-form-tools.js";
import { getApiSchema, type ApiSchemaInput } from "./handlers/api-schema-tools.js";
import { getWpStructure, type StructureGetInput } from "./handlers/structure-tools.js";

/** wp-api MCP 服务支持的全部工具名称。 */
export const WP_API_TOOL_NAMES = [
  "wp_client_list",
  "wp_client_use",
  "wp_structure_get",
  "wp_api_schema",
  "wp_resource_list",
  "wp_resource_get",
  "wp_resource_create",
  "wp_resource_update",
  "wp_resource_delete",
  "wp_seo_get",
  "wp_seo_update",
  "wp_post_link",
  "wp_post_content_replace",
  "wp_media_upload",
  "wp_elementor_init",
  "wp_elementor_export",
  "wp_elementor_import",
  "wp_elementor_structure",
  "wp_elementor_get_element",
  "wp_elementor_find",
  "wp_package_list",
  "wp_package_get",
  "wp_package_install",
  "wp_package_update",
  "wp_package_activate",
  "wp_package_deactivate",
  "wp_package_pack_theme",
  "wp_package_pack_plugin",
  "wp_jelly_form_settings_get",
  "wp_jelly_form_settings_update",
  "wp_jelly_form_inquiry_list",
  "wp_jelly_form_inquiry_get"
] as const;

/** wp-api MCP 服务支持的工具名称联合类型。 */
export type WpApiToolName = typeof WP_API_TOOL_NAMES[number];

/** MCP 工具收到的原始 JSON 对象。 */
export type WpApiToolInput = Record<string, unknown>;

/** 可注入的 WordPress client 解析函数签名。 */
export type ResolveWordPressClientImpl = (
  input: WordPressConnectionInput,
  context?: WordPressConnectionContext
) => Promise<WordPressClient>;

/** 执行 MCP 工具时允许注入的运行上下文。 */
export interface WpApiToolContext extends WordPressConnectionContext {
  /** 在默认工作目录之外，额外允许 MCP 工具读取或写入的本地目录。 */
  allowedLocalRoots?: string[];
  /** 覆盖 WordPress client 解析函数，主要用于不访问真实配置与网络的测试。 */
  resolveClientImpl?: ResolveWordPressClientImpl;
}

/** 一个允许 MCP 访问的本地根目录及其消除符号链接后的真实位置。 */
interface AllowedLocalRoot {
  /** 调用 path.resolve 后用于校验用户输入路径的绝对目录。 */
  resolvedPath: string;
  /** 调用 fs.realpath 后用于阻止符号链接逃逸的真实目录。 */
  realPath: string;
}

/** 已校验本地路径的词法绝对位置和消除符号链接后的真实位置。 */
interface ValidatedLocalPath {
  /** 调用 path.resolve 后得到的词法绝对路径。 */
  resolvedPath: string;
  /** 消除已有路径段中的符号链接后得到的真实绝对路径。 */
  realPath: string;
}

/** 将路径转换为适合当前平台比较的形式，Windows 上忽略盘符和路径大小写。 */
function normalizePathForComparison(filePath: string): string {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

/** 判断目标路径是否等于指定根目录，或严格位于该根目录之下。 */
function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const pathFromRoot = relative(
    normalizePathForComparison(rootPath),
    normalizePathForComparison(targetPath)
  );
  return pathFromRoot === ""
    || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

/** 解析默认工作目录和显式扩展目录，确保每个允许根目录都真实存在且为目录。 */
async function resolveAllowedLocalRoots(context: WpApiToolContext): Promise<AllowedLocalRoot[]> {
  const configuredRoots = [process.cwd(), ...(context.allowedLocalRoots ?? [])];
  const roots: AllowedLocalRoot[] = [];

  for (const configuredRoot of configuredRoots) {
    if (typeof configuredRoot !== "string" || configuredRoot.length === 0) {
      throw new Error("MCP allowedLocalRoots entries must be non-empty directory paths.");
    }

    const resolvedPath = resolve(configuredRoot);
    let realPath: string;
    try {
      realPath = await realpath(resolvedPath);
    } catch {
      throw new Error(`MCP allowed local root does not exist or cannot be resolved: ${resolvedPath}`);
    }

    const rootStats = await stat(realPath).catch(() => undefined);
    if (!rootStats?.isDirectory()) {
      throw new Error(`MCP allowed local root is not a directory: ${resolvedPath}`);
    }
    roots.push({ resolvedPath, realPath });
  }
  return roots;
}

/** 校验路径的词法位置和真实位置属于同一个允许根目录。 */
function assertPathWithinAllowedRoots(
  fieldName: string,
  validatedPath: ValidatedLocalPath,
  allowedRoots: AllowedLocalRoot[]
): void {
  const isAllowed = allowedRoots.some((root) => (
    isPathWithinRoot(root.resolvedPath, validatedPath.resolvedPath)
    && isPathWithinRoot(root.realPath, validatedPath.realPath)
  ));
  if (isAllowed) {
    return;
  }

  const allowedRootList = allowedRoots.map((root) => root.resolvedPath).join(", ");
  throw new Error(
    `MCP local path '${fieldName}' is outside the allowed local roots: ${validatedPath.resolvedPath}. `
    + `Allowed roots: ${allowedRootList}`
  );
}

/** 解析并校验必须已经存在的 MCP 本地输入路径，同时阻止符号链接越过允许根目录。 */
async function validateExistingLocalPath(
  fieldName: string,
  inputPath: string,
  allowedRoots: AllowedLocalRoot[]
): Promise<ValidatedLocalPath> {
  const resolvedPath = resolve(inputPath);
  let realPath: string;
  try {
    realPath = await realpath(resolvedPath);
  } catch {
    throw new Error(`MCP local path '${fieldName}' does not exist or cannot be resolved: ${resolvedPath}`);
  }

  const validatedPath = { resolvedPath, realPath };
  assertPathWithinAllowedRoots(fieldName, validatedPath, allowedRoots);
  return validatedPath;
}

/** 找到可能尚不存在的输出路径最近的现存祖先，并据此重建消除符号链接后的目标位置。 */
async function resolvePotentialOutputPath(outputPath: string): Promise<ValidatedLocalPath> {
  const resolvedPath = resolve(outputPath);
  let currentPath = resolvedPath;
  const missingSegments: string[] = [];

  while (true) {
    try {
      const existingRealPath = await realpath(currentPath);
      return {
        resolvedPath,
        realPath: resolve(existingRealPath, ...missingSegments)
      };
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ENOENT") {
        throw new Error(`MCP local output path cannot be resolved: ${resolvedPath}`);
      }

      const parentPath = dirname(currentPath);
      if (parentPath === currentPath) {
        throw new Error(`MCP local output path has no resolvable existing parent: ${resolvedPath}`);
      }
      missingSegments.unshift(basename(currentPath));
      currentPath = parentPath;
    }
  }
}

/** 校验允许尚不存在的 MCP 输出路径，并阻止任意现存父目录通过符号链接逃逸。 */
async function validateLocalOutputPath(
  fieldName: string,
  outputPath: string,
  allowedRoots: AllowedLocalRoot[]
): Promise<ValidatedLocalPath> {
  const validatedPath = await resolvePotentialOutputPath(outputPath);
  assertPathWithinAllowedRoots(fieldName, validatedPath, allowedRoots);
  return validatedPath;
}

/** 读取必填非空字符串字段，缺失或类型错误时抛出明确错误。 */
function readRequiredString(input: WpApiToolInput, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required string field: ${key}`);
  }
  return value;
}

/** 读取可选字符串字段，并拒绝其他 JSON 类型。 */
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

/** 在 MCP 执行前校验所有可能读写本地文件的参数，并返回使用真实路径的安全输入副本。 */
async function validateToolLocalPaths(
  toolName: WpApiToolName,
  input: WpApiToolInput,
  context: WpApiToolContext
): Promise<WpApiToolInput> {
  const validatedInput = { ...input };
  let pathField: "contentFile" | "filePath" | "file" | undefined;

  if ((toolName === "wp_resource_create" || toolName === "wp_resource_update") && input.contentFile !== undefined) {
    pathField = "contentFile";
  } else if (toolName === "wp_media_upload") {
    pathField = "filePath";
  } else if (toolName === "wp_package_install" || toolName === "wp_package_update") {
    pathField = "file";
  }

  if (pathField !== undefined) {
    const inputPath = readRequiredString(input, pathField);
    const allowedRoots = await resolveAllowedLocalRoots(context);
    validatedInput[pathField] = (await validateExistingLocalPath(pathField, inputPath, allowedRoots)).realPath;
    return validatedInput;
  }

  if (toolName === "wp_package_pack_theme" || toolName === "wp_package_pack_plugin") {
    const allowedRoots = await resolveAllowedLocalRoots(context);
    const folderPath = readRequiredString(input, "folderPath");
    const validatedFolder = await validateExistingLocalPath("folderPath", folderPath, allowedRoots);
    const requestedOutputPath = readOptionalString(input, "outputPath")
      ?? resolve(dirname(validatedFolder.resolvedPath), `${basename(validatedFolder.resolvedPath)}.zip`);
    const validatedOutput = await validateLocalOutputPath("outputPath", requestedOutputPath, allowedRoots);
    validatedInput.folderPath = validatedFolder.realPath;
    validatedInput.outputPath = validatedOutput.realPath;
  }

  return validatedInput;
}

/** 判断任意字符串是否是当前服务注册的 MCP 工具名称。 */
function isWpApiToolName(toolName: string): toolName is WpApiToolName {
  return (WP_API_TOOL_NAMES as readonly string[]).includes(toolName);
}

/** 判断工具名称是否属于 Elementor 领域。 */
function isElementorToolName(toolName: WpApiToolName): toolName is ElementorToolName {
  return toolName.startsWith("wp_elementor_");
}

/** 从工具输入中读取远端 WordPress client 选择字段。 */
function readConnectionInput(input: WpApiToolInput): WordPressConnectionInput {
  return {
    client: readOptionalString(input, "client"),
    siteUrl: readOptionalString(input, "siteUrl")
  };
}

/** 使用已经解析的 WordPressClient 直接执行远端 MCP 领域操作。 */
async function executeRemoteTool(
  toolName: WpApiToolName,
  input: WpApiToolInput,
  client: WordPressClient
): Promise<unknown> {
  if (isElementorToolName(toolName)) {
    return executeElementorTool(toolName, client, input);
  }

  switch (toolName) {
    case "wp_api_schema":
      return getApiSchema(client, input as unknown as ApiSchemaInput);
    case "wp_resource_list":
      return listResource(client, input as unknown as ResourceListInput);
    case "wp_resource_get":
      return getResource(client, input as unknown as ResourceGetInput);
    case "wp_resource_create":
      return createResource(client, input as unknown as ResourceCreateInput);
    case "wp_resource_update":
      return updateResource(client, input as unknown as ResourceUpdateInput);
    case "wp_resource_delete":
      return deleteResource(client, input as unknown as ResourceDeleteInput);
    case "wp_seo_get":
      return getResourceSeo(client, input as unknown as ResourceSeoGetInput);
    case "wp_seo_update":
      return updateResourceSeo(client, input as unknown as ResourceSeoUpdateInput);
    case "wp_post_link":
      return managePostLink(client, input as unknown as PostLinkInput);
    case "wp_post_content_replace":
      return replacePostContent(client, input as unknown as PostContentReplaceInput);
    case "wp_media_upload":
      return uploadMedia(client, input as unknown as MediaUploadInput);
    case "wp_package_list":
      return listPackages(client, input as unknown as PackageListInput);
    case "wp_package_get":
      return getPackage(client, input as unknown as PackageGetInput);
    case "wp_package_install":
      return installPackage(client, input as unknown as PackageFileMutationInput);
    case "wp_package_update":
      return updatePackage(client, input as unknown as PackageFileMutationInput);
    case "wp_package_activate":
      return activatePackage(client, input as unknown as PackageStatusMutationInput);
    case "wp_package_deactivate":
      return deactivatePackage(client, input as unknown as PackageStatusMutationInput);
    case "wp_jelly_form_settings_get":
      return getJellyFormSettings(client);
    case "wp_jelly_form_settings_update":
      return updateJellyFormSettings(client, input as unknown as JellyFormSettingsUpdateInput);
    case "wp_jelly_form_inquiry_list":
      return listJellyFormInquiries(client, input as unknown as JellyFormInquiryListInput);
    case "wp_jelly_form_inquiry_get":
      return getJellyFormInquiry(client, input as unknown as JellyFormInquiryGetInput);
    default:
      throw new Error(`Tool does not perform a remote WordPress operation: ${toolName}`);
  }
}

/** 执行一个纯 MCP 工具，并直接返回领域 handler 的结构化结果。 */
export async function executeWpApiTool(
  toolName: WpApiToolName,
  input: WpApiToolInput = {},
  context: WpApiToolContext = {}
): Promise<unknown> {
  if (!isWpApiToolName(toolName)) {
    throw new Error(`Unknown MCP tool: ${String(toolName)}`);
  }

  const validatedInput = await validateToolLocalPaths(toolName, input, context);
  switch (toolName) {
    case "wp_client_list":
      return listStoredClients(context);
    case "wp_client_use":
      return useStoredClient(readRequiredString(validatedInput, "name"), context);
    case "wp_structure_get":
      return getWpStructure(validatedInput as StructureGetInput);
    case "wp_package_pack_theme":
    case "wp_package_pack_plugin":
      return createPackageArchive(
        toolName === "wp_package_pack_theme" ? "theme" : "plugin",
        readRequiredString(validatedInput, "folderPath"),
        readOptionalString(validatedInput, "outputPath")
      );
    default: {
      const resolver = context.resolveClientImpl ?? resolveWordPressClient;
      const client = await resolver(readConnectionInput(validatedInput), context);
      return executeRemoteTool(toolName, validatedInput, client);
    }
  }
}
