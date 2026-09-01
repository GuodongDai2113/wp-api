import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  batchUpdateResourceSeo,
  listResourceSeo
} from "../build/mcp/handlers/seo-tools.js";

/** 验证 SEO 列表会映射查询字段并把缺失 meta 规范化为空字符串。 */
test("SEO handler maps paginated list queries", async () => {
  const calls = [];
  const client = {
    /** 记录列表请求并返回一条缺少部分 meta 的资源。 */
    async list(route, query) {
      calls.push({ route, query });
      return {
        items: [{ id: 7, meta: { rank_math_title: "Title" } }],
        pagination: { total: 1, totalPages: 1 }
      };
    }
  };

  const result = await listResourceSeo(client, {
    resource: "posts",
    search: "guide",
    status: "publish",
    page: 2,
    perPage: 20,
    include: [7, 8]
  });

  assert.deepEqual(calls, [{
    route: "posts",
    query: {
      search: "guide",
      status: "publish",
      page: 2,
      per_page: 20,
      include: "7,8",
      _fields: "id,meta"
    }
  }]);
  assert.deepEqual(result.items[0], {
    id: 7,
    resource: "posts",
    rank_math_title: "Title",
    rank_math_description: "",
    rank_math_focus_keyword: ""
  });
});

/** 验证 CSV 导出忽略内联分页窗口并逐页写出全部查询匹配项。 */
test("SEO handler exports every matching page to escaped UTF-8 CSV", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-seo-export-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = join(directory, "seo.csv");
  const calls = [];
  const client = {
    /** 根据页码返回内联页或全量导出的分页测试数据。 */
    async list(route, query) {
      calls.push({ route, query });
      if (query.per_page !== 100) {
        return { items: [{ id: 99, meta: {} }], pagination: { total: 3, totalPages: 2 } };
      }
      return query.page === 1
        ? {
          items: [{ id: 1, meta: { rank_math_title: "A, B", rank_math_description: "line 1\nline 2" } }],
          pagination: { total: 2, totalPages: 2 }
        }
        : {
          items: [{ id: 2, meta: { rank_math_title: 'A "quote"', rank_math_focus_keyword: "中文" } }],
          pagination: { total: 2, totalPages: 2 }
        };
    }
  };

  const result = await listResourceSeo(client, {
    resource: "posts",
    search: "export",
    page: 3,
    perPage: 1,
    outputFile
  });
  const csv = await readFile(outputFile, "utf8");

  assert.equal(result.items[0].id, 99);
  assert.deepEqual(result.export, { file_path: outputFile, rows: 2, totalPages: 2 });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].query.page, 1);
  assert.equal(calls[1].query.per_page, 100);
  assert.equal(calls[2].query.page, 2);
  assert.equal(csv.startsWith("\uFEFFid,rank_math_title,rank_math_description,rank_math_focus_keyword\r\n"), true);
  assert.match(csv, /1,"A, B","line 1\nline 2",/);
  assert.match(csv, /2,"A ""quote""",,中文/);
});

/** SEO 导出会根据后续响应更新总页数，避免导出期间新增页面被遗漏。 */
test("SEO export follows pagination growth", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-seo-page-growth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = join(directory, "seo.csv");
  const pages = [];
  const client = {
    /** 模拟第二页响应把总页数从 2 更新为 3。 */
    async list(_route, query) {
      if (query.per_page !== 100) return { items: [], pagination: { total: 0, totalPages: 0 } };
      pages.push(query.page);
      return {
        items: [{ id: query.page, meta: { rank_math_title: `Page ${query.page}` } }],
        pagination: { total: 3, totalPages: query.page === 1 ? 2 : 3 }
      };
    }
  };

  const result = await listResourceSeo(client, { resource: "posts", outputFile });
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(result.export.totalPages, 3);
  assert.match(await readFile(outputFile, "utf8"), /Page 3/);
});

/** 验证全量 CSV 导出拒绝覆盖已经存在的目标文件。 */
test("SEO handler refuses to overwrite an existing CSV export", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-seo-existing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = join(directory, "existing.csv");
  await writeFile(outputFile, "keep", "utf8");
  const client = {
    /** 返回不应被导出逻辑请求的空列表。 */
    async list() {
      return { items: [], pagination: { total: 0, totalPages: 0 } };
    }
  };

  await assert.rejects(
    () => listResourceSeo(client, { resource: "posts", outputFile }),
    /already exists/
  );
  assert.equal(await readFile(outputFile, "utf8"), "keep");
});

/** 验证 batch 更新按 25 条分块，并继续汇总单条 WordPress 错误。 */
test("SEO handler chunks batch updates and summarizes item failures", async () => {
  const calls = [];
  const client = {
    /** 记录 batch 请求并按 ID 模拟成功或失败子响应。 */
    async requestApiPath(route, options) {
      calls.push({ route, options });
      return {
        data: {
          responses: options.body.requests.map((request) => {
            const id = Number(request.path.split("/").at(-1));
            return id === 2
              ? { status: 403, body: { code: "rest_cannot_edit", message: "Forbidden" } }
              : { status: 200, body: { id, meta: request.body.meta } };
          })
        },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };
  const items = Array.from({ length: 26 }, (_, index) => ({ id: index + 1, title: `Title ${index + 1}` }));

  const result = await batchUpdateResourceSeo(client, { resource: "pages", items });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].route, "batch/v1");
  assert.equal(calls[0].options.body.requests.length, 25);
  assert.equal(calls[1].options.body.requests.length, 1);
  assert.deepEqual(calls[0].options.body.requests[0], {
    method: "POST",
    path: "/wp/v2/pages/1",
    body: { meta: { rank_math_title: "Title 1" } }
  });
  assert.equal(result.total, 26);
  assert.equal(result.succeeded, 25);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.items[1].error, { code: "rest_cannot_edit", message: "Forbidden", status: 403 });
});

/** 验证 CSV 导入把空单元格映射为显式清空值。 */
test("SEO handler imports strict CSV and preserves empty-cell clearing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-seo-import-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const csvFile = join(directory, "seo.csv");
  await writeFile(
    csvFile,
    "\uFEFFid,rank_math_title,rank_math_description,rank_math_focus_keyword\r\n9,New title,,keyword\r\n",
    "utf8"
  );
  let requestBody;
  const client = {
    /** 捕获 CSV 转换后的 batch 请求体。 */
    async requestApiPath(_route, options) {
      requestBody = options.body;
      return {
        data: { responses: [{ status: 200, body: { id: 9, meta: options.body.requests[0].body.meta } }] },
        pagination: { total: 0, totalPages: 0 }
      };
    }
  };

  await batchUpdateResourceSeo(client, { resource: "posts", csvFile });

  assert.deepEqual(requestBody.requests[0].body, {
    meta: {
      rank_math_title: "New title",
      rank_math_description: "",
      rank_math_focus_keyword: "keyword"
    }
  });
});

/** 验证重复 CSV ID 会在任何网络请求前拒绝整个导入。 */
test("SEO handler rejects duplicate CSV ids before network requests", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wp-api-seo-duplicate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const csvFile = join(directory, "duplicate.csv");
  await writeFile(
    csvFile,
    "id,rank_math_title,rank_math_description,rank_math_focus_keyword\n1,a,b,c\n1,d,e,f\n",
    "utf8"
  );
  let calls = 0;
  const client = {
    /** 记录不应发生的 batch 请求。 */
    async requestApiPath() {
      calls += 1;
    }
  };

  await assert.rejects(
    () => batchUpdateResourceSeo(client, { resource: "posts", csvFile }),
    /Duplicate SEO item id/
  );
  assert.equal(calls, 0);
});
