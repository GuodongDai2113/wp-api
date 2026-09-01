import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  POST_RESOURCE_CSV_HEADERS,
  TAXONOMY_RESOURCE_CSV_HEADERS,
  MAX_RESOURCE_BATCH_REQUEST_BYTES,
  MAX_RESOURCE_BATCH_TOTAL_BYTES,
  batchCreateResources,
  batchUpdateResources,
  countResource,
  listResource
} from "../build/mcp/handlers/resource-tools.js";
import { WordPressApiError } from "../build/lib/wp-client.js";

/** 资源计数只发出一次最小分页请求并返回响应头分页结果。 */
test("resource count maps filters and pagination headers", async () => {
  const calls = [];
  const client = {
    /** 记录计数查询并返回模拟分页头。 */
    async list(route, query) {
      calls.push({ route, query });
      return { items: [{ id: 1 }], pagination: { total: 240, totalPages: 5 } };
    }
  };

  const result = await countResource(client, {
    target: { type: "post", resource: "products" },
    search: "steel",
    status: "publish",
    include: [1, 2],
    perPage: 50
  });

  assert.deepEqual(calls, [{
    route: "product",
    query: { search: "steel", status: "publish", include: "1,2", page: 1, per_page: 50, _fields: "id" }
  }]);
  assert.deepEqual(result, { target: { type: "post", resource: "products" }, total: 240, totalPages: 5, perPage: 50 });
});

/** 资源目标必须使用与注册资源一致的 type，taxonomy 查询也不能携带 post 状态。 */
test("resource queries reject mismatched target types and taxonomy status", async () => {
  let calls = 0;
  const client = {
    /** 记录校验失败时不应发生的列表请求。 */
    async list() {
      calls += 1;
      return { items: [], pagination: { total: 0, totalPages: 0 } };
    }
  };

  await assert.rejects(
    () => countResource(client, { target: { type: "taxonomy", resource: "posts" } }),
    /requires target type post/
  );
  await assert.rejects(
    () => countResource(client, { target: { type: "taxonomy", resource: "categories" }, status: "publish" }),
    /do not support status/
  );
  assert.equal(calls, 0);
});

/** 资源列表保持内联分页，并以每页 100 条独立导出可编辑原始字段。 */
test("resource list exports every page to an atomic post CSV", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-resource-export-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = join(directory, "posts.csv");
  const calls = [];
  const client = {
    /** 根据是否为编辑上下文返回内联页或导出页。 */
    async list(route, query) {
      calls.push({ route, query });
      if (query.context !== "edit") {
        return { items: [{ id: 99 }], pagination: { total: 1, totalPages: 1 } };
      }
      return query.page === 1
        ? {
          items: [{
            id: 1,
            title: { raw: "First, post" },
            slug: "first",
            status: "publish",
            excerpt: { raw: "" },
            content: { raw: "Line 1\nLine 2" },
            featured_media: 0,
            categories: [],
            meta: { flag: true }
          }],
          pagination: { total: 2, totalPages: 2 }
        }
        : {
          items: [{ id: 2, title: { raw: "Second \"post\"" }, content: { raw: "Body" } }],
          pagination: { total: 2, totalPages: 2 }
        };
    }
  };

  const result = await listResource(client, { target: { type: "post", resource: "posts" }, page: 3, perPage: 20, outputFile });
  const csv = await readFile(outputFile, "utf8");

  assert.deepEqual(result.items, [{ id: 99 }]);
  assert.deepEqual(result.export, { file_path: outputFile, rows: 2, totalPages: 2 });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], { route: "posts", query: { page: 3, per_page: 20 } });
  assert.deepEqual(calls[1].query, { page: 1, per_page: 100, context: "edit" });
  assert.deepEqual(calls[2].query, { page: 2, per_page: 100, context: "edit" });
  assert.ok(csv.startsWith(`\uFEFF${POST_RESOURCE_CSV_HEADERS.join(",")}\r\n`));
  assert.match(csv, /"First, post"/);
  assert.match(csv, /__EMPTY__/);
  assert.match(csv, /"Line 1\nLine 2"/);
  assert.match(csv, /"\{\""flag\"":true\}"/);

  await assert.rejects(
    () => listResource(client, { target: { type: "post", resource: "posts" }, outputFile }),
    /already exists/
  );
});

/** 资源导出分页失败时删除临时文件，且列表拒绝旧的全量聚合分页值。 */
test("resource list cleans failed exports and rejects perPage -1", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-resource-export-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = join(directory, "failed.csv");
  let calls = 0;
  const client = {
    /** 在第二个导出分页模拟远端失败。 */
    async list(_route, query) {
      calls += 1;
      if (query.context !== "edit") return { items: [], pagination: { total: 0, totalPages: 0 } };
      if (query.page === 2) throw new Error("Page two failed");
      return { items: [{ id: 1 }], pagination: { total: 2, totalPages: 2 } };
    }
  };

  await assert.rejects(() => listResource(client, { target: { type: "post", resource: "posts" }, perPage: -1 }), /between 1 and 100/);
  await assert.rejects(() => listResource(client, { target: { type: "post", resource: "posts" }, outputFile }), /Page two failed/);
  assert.equal(calls, 3);
  assert.deepEqual(await readdir(directory), []);
});

/** 资源导出使用每页最新的总页数，并把集合缩减后的页码越界视为正常结束。 */
test("resource export follows growing pages and tolerates shrinking pages", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-resource-page-drift-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const growingFile = join(directory, "growing.csv");
  const shrinkingFile = join(directory, "shrinking.csv");
  const growingPages = [];
  const growingClient = {
    /** 模拟第二页读取时总页数从 2 增加到 3。 */
    async list(_route, query) {
      if (query.context !== "edit") return { items: [], pagination: { total: 0, totalPages: 0 } };
      growingPages.push(query.page);
      return {
        items: [{ id: query.page, title: { raw: `Page ${query.page}` } }],
        pagination: { total: 3, totalPages: query.page === 1 ? 2 : 3 }
      };
    }
  };
  const growing = await listResource(growingClient, {
    target: { type: "post", resource: "posts" },
    outputFile: growingFile
  });
  assert.deepEqual(growingPages, [1, 2, 3]);
  assert.equal(growing.export.totalPages, 3);

  const shrinkingClient = {
    /** 模拟首页之后集合缩减，第二页变为无效页码。 */
    async list(_route, query) {
      if (query.context !== "edit") return { items: [], pagination: { total: 0, totalPages: 0 } };
      if (query.page === 2) {
        throw new WordPressApiError({ status: 400, code: "rest_post_invalid_page_number", message: "Invalid page." });
      }
      return { items: [{ id: 1, title: { raw: "Only page" } }], pagination: { total: 1, totalPages: 2 } };
    }
  };
  const shrinking = await listResource(shrinkingClient, {
    target: { type: "post", resource: "posts" },
    outputFile: shrinkingFile
  });
  assert.equal(shrinking.export.totalPages, 1);
  assert.match(await readFile(shrinkingFile, "utf8"), /Only page/);
});

/** 资源导出发布时若其他进程抢先创建目标，必须保留竞争者文件。 */
test("resource export never overwrites a target created during export", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-resource-export-race-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = join(directory, "race.csv");
  const client = {
    /** 在预检查之后、最终发布之前模拟其他进程创建目标文件。 */
    async list(_route, query) {
      if (query.context === "edit") {
        await writeFile(outputFile, "competitor", "utf8");
        return { items: [{ id: 1 }], pagination: { total: 1, totalPages: 1 } };
      }
      return { items: [], pagination: { total: 0, totalPages: 0 } };
    }
  };

  await assert.rejects(
    () => listResource(client, { target: { type: "post", resource: "posts" }, outputFile }),
    /already exists/
  );
  assert.equal(await readFile(outputFile, "utf8"), "competitor");
  assert.deepEqual(await readdir(directory), ["race.csv"]);
});

/** 批量创建忽略来源 ID，按 25 条分块并保持结果顺序。 */
test("resource batch create chunks requests and correlates source IDs", async () => {
  const calls = [];
  const client = {
    /** 记录 batch 请求，并为每个子请求生成新 ID。 */
    async requestApiPath(route, options) {
      calls.push({ route, options });
      const base = calls.length === 1 ? 100 : 200;
      return {
        data: { responses: options.body.requests.map((_request, index) => ({ status: 201, body: { id: base + index } })) },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };
  const items = Array.from({ length: 26 }, (_value, index) => ({ id: index + 1, data: { title: `Post ${index + 1}` } }));

  const result = await batchCreateResources(client, { target: { type: "post", resource: "posts" }, items });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body.requests.length, 25);
  assert.equal(calls[1].options.body.requests.length, 1);
  assert.deepEqual(calls[0].options.body.requests[0], {
    method: "POST",
    path: "/wp/v2/posts",
    body: { title: "Post 1" }
  });
  assert.deepEqual(result.items[0], { index: 0, sourceId: 1, id: 100, success: true });
  assert.deepEqual(result.items[25], { index: 25, sourceId: 26, id: 200, success: true });
  assert.equal(result.succeeded, 26);
});

/** 资源 batch 同时按请求数量和实际 JSON 字节数分块。 */
test("resource batch chunks by serialized request bytes", async () => {
  const calls = [];
  const client = {
    /** 记录字节分块后的请求并返回全部成功。 */
    async requestApiPath(_route, options) {
      calls.push(options.body);
      return {
        data: { responses: options.body.requests.map((_request, index) => ({ status: 201, body: { id: calls.length * 10 + index } })) },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };
  const content = "x".repeat(5 * 1024 * 1024);
  await batchCreateResources(client, {
    target: { type: "post", resource: "posts" },
    items: [{ data: { content } }, { data: { content } }]
  });

  assert.equal(calls.length, 2);
  for (const payload of calls) {
    assert.equal(Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_RESOURCE_BATCH_REQUEST_BYTES, true);
  }
});

/** 资源 batch 在任何网络请求前拒绝单项和累计 JSON 大小超限。 */
test("resource batch rejects oversized item and total payload before network calls", async () => {
  let calls = 0;
  const client = {
    /** 记录超限校验后不应发生的远程请求。 */
    async requestApiPath() {
      calls += 1;
      return {};
    }
  };
  const oversizedItem = "x".repeat(MAX_RESOURCE_BATCH_REQUEST_BYTES);
  await assert.rejects(
    () => batchCreateResources(client, {
      target: { type: "post", resource: "posts" },
      items: [{ data: { content: oversizedItem } }]
    }),
    /maximum batch request size/
  );

  const sharedContent = "x".repeat(5 * 1024 * 1024);
  await assert.rejects(
    () => batchUpdateResources(client, {
      target: { type: "post", resource: "posts" },
      items: Array.from({ length: 6 }, (_value, index) => ({ id: index + 1, data: { content: sharedContent } }))
    }),
    new RegExp(`maximum total batch size of ${MAX_RESOURCE_BATCH_TOTAL_BYTES} bytes`)
  );
  assert.equal(calls, 0);
});

/** Post CSV 批量更新把空白视为省略、清空标记视为空字符串，并汇总子请求失败。 */
test("resource batch update imports post CSV and reports partial failures", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-resource-import-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const csvFile = join(directory, "updates.csv");
  const first = ["7", "__EMPTY__", "", "draft", "", "Body", "false", "0", "[]", "{\"flag\":true}"].map(csvField).join(",");
  const second = ["8", "Updated", "", "", "", "", "", "", "[2]", ""].map(csvField).join(",");
  await writeFile(csvFile, `\uFEFF${POST_RESOURCE_CSV_HEADERS.join(",")}\r\n${first}\r\n${second}\r\n`, "utf8");
  const calls = [];
  const client = {
    /** 返回一个成功和一个失败的 WordPress batch 子响应。 */
    async requestApiPath(route, options) {
      calls.push({ route, options });
      return {
        data: { responses: [
          { status: 200, body: { id: 7 } },
          { status: 400, body: { code: "invalid_term", message: "Invalid category" } }
        ] },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };

  const result = await batchUpdateResources(client, { target: { type: "post", resource: "posts" }, csvFile });

  assert.deepEqual(calls[0].options.body.requests[0], {
    method: "POST",
    path: "/wp/v2/posts/7",
    body: { title: "", status: "draft", content: "Body", featured_media: 0, categories: [], meta: { flag: true } }
  });
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.items[1].error, { code: "invalid_term", message: "Invalid category", status: 400 });
});

/** 产品 CSV 复用 categories 列，并在导入时自动映射为 REST product_cat。 */
test("product CSV maps categories to product_cat", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-product-csv-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = join(directory, "products.csv");
  const calls = [];
  const client = {
    /** 返回带产品分类的导出实体。 */
    async list(_route, query) {
      if (query.context !== "edit") return { items: [], pagination: { total: 0, totalPages: 0 } };
      return {
        items: [{ id: 12, title: { raw: "Pump" }, product_cat: [2, 5], meta: {} }],
        pagination: { total: 1, totalPages: 1 }
      };
    },
    /** 记录由产品 CSV 生成的 batch 请求。 */
    async requestApiPath(route, options) {
      calls.push({ route, options });
      return {
        data: { responses: [{ status: 200, body: { id: 12 } }] },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };

  await listResource(client, { target: { type: "post", resource: "products" }, outputFile });
  const csv = await readFile(outputFile, "utf8");
  assert.match(csv, /"\[2,5\]"/);

  await batchUpdateResources(client, {
    target: { type: "post", resource: "products" },
    csvFile: outputFile
  });
  assert.deepEqual(calls[0].options.body.requests[0], {
    method: "POST",
    path: "/wp/v2/product/12",
    body: { title: "Pump", product_cat: [2, 5], meta: {} }
  });
});

/** Taxonomy 导出和导入使用独立字段集合，并保留显式清空与父级清除语义。 */
test("taxonomy resources use a distinct CSV schema", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-taxonomy-csv-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = join(directory, "categories.csv");
  const calls = [];
  const client = {
    /** 返回 taxonomy 分页，并记录后续 batch 更新请求。 */
    async list(_route, query) {
      if (query.context !== "edit") return { items: [], pagination: { total: 0, totalPages: 0 } };
      return {
        items: [{ id: 4, name: "Guides", slug: "guides", description: "", parent: 0, meta: { featured: true } }],
        pagination: { total: 1, totalPages: 1 }
      };
    },
    /** 接受从刚导出的 taxonomy CSV 回导的更新。 */
    async requestApiPath(route, options) {
      calls.push({ route, options });
      return {
        data: { responses: [{ status: 200, body: { id: 4 } }] },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };

  await listResource(client, { target: { type: "taxonomy", resource: "categories" }, outputFile });
  const csv = await readFile(outputFile, "utf8");
  assert.ok(csv.startsWith(`\uFEFF${TAXONOMY_RESOURCE_CSV_HEADERS.join(",")}\r\n`));
  assert.match(csv, /Guides,guides,__EMPTY__,0/);

  const result = await batchUpdateResources(client, {
    target: { type: "taxonomy", resource: "categories" },
    csvFile: outputFile
  });
  assert.deepEqual(calls[0].options.body.requests[0], {
    method: "POST",
    path: "/wp/v2/categories/4",
    body: { name: "Guides", slug: "guides", description: "", parent: 0, meta: { featured: true } }
  });
  assert.equal(result.succeeded, 1);
});

/** 将测试值编码为标准 CSV 字段。 */
function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** 批量更新在发出网络请求前拒绝重复 ID 和不适用字段。 */
test("resource batch update validates every item before network calls", async () => {
  let calls = 0;
  const client = {
    /** 记录所有不应发生的 batch 请求。 */
    async requestApiPath() {
      calls += 1;
      return {};
    }
  };

  await assert.rejects(
    () => batchUpdateResources(client, { target: { type: "post", resource: "pages" }, items: [{ id: 1, data: { title: "A" } }, { id: 1, data: { title: "B" } }] }),
    /Duplicate resource update id/
  );
  await assert.rejects(
    () => batchUpdateResources(client, { target: { type: "taxonomy", resource: "categories" }, items: [{ id: 2, data: { content: "Wrong" } }] }),
    /not supported for categories: content/
  );
  await assert.rejects(
    () => batchUpdateResources(client, { target: { type: "post", resource: "posts" }, items: [{ id: 3, data: { contentFile: "outside.html" } }] }),
    /does not support contentFile or metaFile/
  );
  assert.equal(calls, 0);
});

/** 资源 CSV 导入要求固定表头和至少一条数据。 */
test("resource CSV import rejects invalid headers and empty data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-resource-csv-validation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const invalidHeader = join(directory, "invalid.csv");
  const emptyData = join(directory, "empty.csv");
  await writeFile(invalidHeader, "id,title\r\n1,Post\r\n", "utf8");
  await writeFile(emptyData, `${POST_RESOURCE_CSV_HEADERS.join(",")}\r\n`, "utf8");
  const client = {
    /** 任何无效 CSV 都不应进入远端 batch。 */
    async requestApiPath() {
      throw new Error("Unexpected batch request");
    }
  };

  await assert.rejects(
    () => batchUpdateResources(client, { target: { type: "post", resource: "posts" }, csvFile: invalidHeader }),
    /header must be exactly/
  );
  await assert.rejects(
    () => batchUpdateResources(client, { target: { type: "post", resource: "posts" }, csvFile: emptyData }),
    /must contain at least one data row/
  );
});
