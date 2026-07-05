export function getResourceConfig(resourceName, client) {
  if (resourceName === "posts") {
    return {
      route: "posts",
      kind: "content",
      deleteMode: "trash"
    };
  }

  if (resourceName === "pages") {
    return {
      route: "pages",
      kind: "content",
      deleteMode: "trash"
    };
  }

  if (resourceName === "products") {
    return {
      route: "product",
      kind: "content",
      deleteMode: "trash"
    };
  }

  if (resourceName === "categories") {
    return {
      route: "categories",
      kind: "taxonomy",
      deleteMode: "force"
    };
  }

  if (resourceName === "product-categories") {
    return {
      route: "product_cat",
      kind: "taxonomy",
      deleteMode: "force"
    };
  }

  throw new Error(`Unknown resource: ${resourceName}`);
}

function splitCsv(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number(entry));
}

export async function buildResourceBody(kind, options, resolveContent) {
  if (kind === "taxonomy") {
    return compactObject({
      name: options.name,
      slug: options.slug,
      description: options.description,
      parent: options.parent === undefined ? undefined : Number(options.parent)
    });
  }

  return compactObject({
    title: options.title,
    slug: options.slug,
    status: options.status,
    excerpt: options.excerpt,
    content: await resolveContent(),
    categories: options.categories ? splitCsv(options.categories) : undefined
  });
}

export function buildListQuery(options) {
  return compactObject({
    search: options.search,
    page: options.page === undefined ? undefined : Number(options.page),
    per_page: options["per-page"] === undefined ? undefined : Number(options["per-page"]),
    status: options.status
  });
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")
  );
}
