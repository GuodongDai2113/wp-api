import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createWpApiMcpServer } from "../build/mcp/server.js";

test("MCP transport 完成工具发现、结构化成功响应和标准错误响应", async (t) => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-transport-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWpApiMcpServer({ configDir });
  const client = new Client({ name: "wp-api-test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = await client.listTools();
  assert.equal(tools.tools.length, 35);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_client_list"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_client_get"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_client_use"), false);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_client_add"), false);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_rest_api"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_api_schema"), false);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_elementor_pull"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_elementor_inspect"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_elementor_edit"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_elementor_push"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_elementor_get"), false);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_seo_list"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_seo_batch_update"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_elementor_cache_clear"), false);
  assert.equal(tools.tools.some((tool) => tool.name === "wp_elementor_read"), false);
  const restApiTool = tools.tools.find((tool) => tool.name === "wp_rest_api");
  assert.deepEqual(restApiTool.inputSchema.required, ["domain"]);
  assert.equal(Object.hasOwn(restApiTool.inputSchema.properties, "domain"), true);
  assert.equal(Object.hasOwn(restApiTool.inputSchema.properties, "client"), false);
  assert.equal(Object.hasOwn(restApiTool.inputSchema.properties, "siteUrl"), false);
  assert.deepEqual(tools.tools.find((tool) => tool.name === "wp_resource_delete").annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
  });

  const success = await client.callTool({
    name: "wp_client_list",
    arguments: {}
  });
  assert.equal(success.isError, undefined);
  assert.deepEqual(success.structuredContent, {
    result: []
  });

  const compactStructure = await client.callTool({
    name: "wp_structure_get",
    arguments: { structure: "product-category", section: "write" }
  });
  assert.equal(compactStructure.content[0].text, "Compact result is available in structuredContent.result.\n");
  assert.equal(compactStructure.structuredContent.result.section, "write");
  assert.equal(compactStructure.content[0].text.includes("category_applications"), false);

  const failure = await client.callTool({
    name: "wp_resource_get",
    arguments: { target: { type: "post", resource: "posts" }, id: 1 }
  });
  assert.equal(failure.isError, true);
  assert.match(failure.content[0].text, /client/i);
});

test("MCP transport 把超过 8 KiB 的完整结果保存为本地 JSON 文件", async (t) => {
  const resultDirectory = await mkdtemp(path.join(os.tmpdir(), "wp-api-mcp-results-"));
  t.after(() => rm(resultDirectory, { recursive: true, force: true }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWpApiMcpServer({
    resultDirectory,
    /** 返回包含大型正文的 WordPress client，以触发通用结果落盘。 */
    async resolveClientImpl() {
      return {
        baseUrl: "https://example.com",
        /** 返回超过 MCP 内联阈值的固定页面实体。 */
        async get() {
          return { id: 1, content: { raw: "x".repeat(9 * 1024) } };
        },
        /** 返回固定的轻量 Elementor 页面，供 pull 写入版本化本地文件。 */
        async request() {
          return {
            data: {
              id: 12,
              type: "page",
              meta: {
                _elementor_data: JSON.stringify([{
                  id: "head001",
                  elType: "widget",
                  widgetType: "heading",
                  settings: { title: "Heading" },
                  elements: []
                }])
              }
            },
            pagination: { total: 0, totalPages: 0 }
          };
        },
        /** 接受 Elementor 保存后的缓存刷新请求。 */
        async requestApiPath() {
          return { data: { success: true }, pagination: { total: 0, totalPages: 0 } };
        }
      };
    }
  });
  const client = new Client({ name: "wp-api-large-result-test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.callTool({
    name: "wp_resource_get",
    arguments: { client: "test", target: { type: "post", resource: "pages" }, id: 1 }
  });
  assert.equal(result.structuredContent.result.stored, true);
  assert.equal(result.structuredContent.result.media_type, "application/json");
  assert.match(result.content[0].text, /stored locally/);
  const storedPayload = JSON.parse(await readFile(result.structuredContent.result.file_path, "utf8"));
  assert.equal(storedPayload.content.raw.length, 9 * 1024);

  const elementorData = await client.callTool({
    name: "wp_elementor_pull",
    arguments: { client: "test", postId: 12 }
  });
  assert.equal(elementorData.structuredContent.result.pulled, true);
  const elementorImport = await client.callTool({
    name: "wp_elementor_push",
    arguments: { client: "test", dataFile: elementorData.structuredContent.result.file_path }
  });
  assert.equal(elementorImport.structuredContent.result.pushed, true);
  assert.equal(elementorImport.structuredContent.result.match, true);
});
