import { ConfigStore } from "./lib/config-store.js";
import { resolveContentInput } from "./lib/content-input.js";
import { addLinkToContent, extractPostContent } from "./lib/links.js";
import { getResourceConfig, buildListQuery, buildResourceBody } from "./lib/resources.js";
import { WordPressApiError, WordPressClient } from "./lib/wp-client.js";

function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { positionals, options };
}

function parseCommandLine(argv) {
  const booleanOptions = new Set(["json", "verbose", "force"]);
  const commandTokens = [];
  const localTokens = [];
  let command;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!command && token.startsWith("--")) {
      commandTokens.push(token);
      const key = token.slice(2);
      if (!booleanOptions.has(key)) {
        const value = argv[index + 1];
        if (value !== undefined) {
          commandTokens.push(value);
          index += 1;
        }
      }
      continue;
    }

    if (!command) {
      command = token;
      continue;
    }

    localTokens.push(token);
  }

  if (!command) {
    return { command: undefined, args: parseArgs([]) };
  }

  const globalOptions = parseArgs(commandTokens).options;
  const local = parseArgs(localTokens);

  return {
    command,
    args: {
      positionals: local.positionals,
      options: { ...globalOptions, ...local.options }
    }
  };
}

function ok(stdout, data) {
  return { exitCode: 0, stdout, stderr: "", data };
}

function fail(message) {
  return { exitCode: 1, stdout: "", stderr: `${message}\n` };
}

async function handleClientCommand(args, store) {
  const [subcommand, name] = args.positionals;

  if (!subcommand) {
    const client = await store.getActiveClient();
    if (!client) {
      return fail("No active client selected. Use `client add` and `client use` first.");
    }

    return args.options.json
      ? ok(`${JSON.stringify(client, null, 2)}\n`, client)
      : ok(`Active client: ${client.name}`, client);
  }

  if (subcommand === "add") {
    if (!name) {
      return fail("Client name is required.");
    }
    if (!args.options["site-url"] || !args.options.username || !args.options["app-password"]) {
      return fail("Missing required flags: --site-url, --username, --app-password");
    }

    const client = await store.saveClient({
      name,
      siteUrl: args.options["site-url"],
      username: args.options.username,
      appPassword: args.options["app-password"]
    });

    return ok(`Saved client "${client.name}".\n`, client);
  }

  if (subcommand === "list") {
    const clients = await store.listClients();
    const active = await store.getActiveClient();
    const payload = {
      activeClient: active?.name ?? null,
      clients
    };

    if (args.options.json) {
      return ok(`${JSON.stringify(payload, null, 2)}\n`, payload);
    }

    const lines = [
      `Active client: ${payload.activeClient ?? "(none)"}`,
      ...clients.map((client) => {
        const marker = payload.activeClient === client.name ? "*" : "-";
        return `${marker} ${client.name}`;
      })
    ];

    return ok(`${lines.join("\n")}\n`, payload);
  }

  if (subcommand === "use") {
    if (!name) {
      return fail("Client name is required.");
    }

    const client = await store.setActiveClient(name);
    return ok(`Active client set to "${client.name}".\n`, client);
  }

  if (subcommand === "remove") {
    if (!name) {
      return fail("Client name is required.");
    }

    await store.removeClient(name);
    return ok(`Removed client "${name}".\n`, null);
  }

  return fail(`Unknown client subcommand: ${subcommand ?? "(missing)"}`);
}

function renderJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function renderEntity(resourceName, entity) {
  const label = resourceName.slice(0, -1);
  const title = entity.title?.rendered ?? entity.name ?? entity.slug ?? `(id:${entity.id})`;
  return `${label} ${entity.id}: ${title}\n`;
}

function extractSeoPayload(resourceName, entity, id) {
  const meta = entity?.meta ?? {};
  return {
    id: entity?.id ?? id,
    resource: resourceName,
    rank_math_title: meta.rank_math_title ?? "",
    rank_math_description: meta.rank_math_description ?? "",
    rank_math_focus_keyword: meta.rank_math_focus_keyword ?? ""
  };
}

function renderSeoPayload(payload, { updated = false } = {}) {
  const header = updated
    ? `SEO updated for ${payload.resource} ${payload.id}`
    : `SEO for ${payload.resource} ${payload.id}`;
  return [
    header,
    `Title: ${payload.rank_math_title}`,
    `Description: ${payload.rank_math_description}`,
    `Focus keyword: ${payload.rank_math_focus_keyword}`
  ].join("\n") + "\n";
}

function buildLinksPayload({ id, text, href, result }) {
  return {
    id,
    resource: "posts",
    action: "links.add",
    updated: result.updated,
    status: result.status,
    text,
    href,
    replacements: result.replacements
  };
}

function renderLinksPayload(payload) {
  if (payload.status === "updated") {
    return `Link added to post ${payload.id}: ${payload.text} -> ${payload.href}\n`;
  }

  if (payload.status === "skipped_existing_link") {
    return `Matching text is already inside a link in post ${payload.id}: ${payload.text}\n`;
  }

  return `No matching text found in post ${payload.id}: ${payload.text}\n`;
}

function buildSeoMeta(options) {
  const entries = Object.entries({
    rank_math_title: options.title,
    rank_math_description: options.description,
    rank_math_focus_keyword: options["focus-keyword"]
  }).filter(([, value]) => value !== undefined);

  return Object.fromEntries(entries);
}

function renderList(resourceName, payload, { currentPage = 1 } = {}) {
  const lines = payload.items.map((item) => {
    const title = item.title?.rendered ?? item.name ?? item.slug ?? "";
    return `${item.id}\t${title}`;
  });
  const footer = `Total ${payload.pagination.total}, ${payload.pagination.totalPages} pages, fetched ${payload.items.length} items, current page ${currentPage}`;
  return `${[`${resourceName}:`, ...lines, footer].join("\n")}\n`;
}

function formatError(error) {
  if (error instanceof WordPressApiError) {
    return `HTTP ${error.status} ${error.code}: ${error.message}`;
  }
  return error.message;
}

async function resolveClient(args, store, options) {
  const client = await store.getResolvedClient(args.options.client);
  if (!client) {
    throw new Error("No client selected. Use `client add` and `client use` first.");
  }

  return new WordPressClient({
    baseUrl: args.options["site-url"] ?? client.siteUrl,
    username: client.username,
    appPassword: client.appPassword,
    fetchImpl: options.fetchImpl,
    verbose: Boolean(args.options.verbose),
    logger: options.logger
  });
}

async function handleResourceCommand(command, args, store, options) {
  const client = await resolveClient(args, store, options);
  const selectedClient = await store.getResolvedClient(args.options.client);
  const config = getResourceConfig(command, selectedClient);
  const [subcommand, rawId] = args.positionals;

  if (subcommand === "list") {
    const payload = await client.list(config.route, buildListQuery(args.options));
    const currentPage = Number(args.options["per-page"]) === -1
      ? "all"
      : args.options.page === undefined
        ? 1
        : Number(args.options.page);
    return args.options.json
      ? ok(renderJson(payload), payload)
      : ok(renderList(command, payload, { currentPage }), payload);
  }

  if (subcommand === "get") {
    const entity = await client.get(config.route, Number(rawId));
    return args.options.json ? ok(renderJson(entity), entity) : ok(renderEntity(command, entity), entity);
  }

  if (subcommand === "create") {
    const body = await buildResourceBody(config.kind, args.options, () =>
      resolveContentInput({
        content: args.options.content,
        contentFile: args.options["content-file"],
        stdinText: options.stdinText
      })
    );
    const entity = await client.create(config.route, body);
    return args.options.json ? ok(renderJson(entity), entity) : ok(renderEntity(command, entity), entity);
  }

  if (subcommand === "update") {
    const body = await buildResourceBody(config.kind, args.options, () =>
      resolveContentInput({
        content: args.options.content,
        contentFile: args.options["content-file"],
        stdinText: options.stdinText
      })
    );
    const entity = await client.update(config.route, Number(rawId), body);
    return args.options.json ? ok(renderJson(entity), entity) : ok(renderEntity(command, entity), entity);
  }

  if (subcommand === "delete") {
    const entity = await client.delete(config.route, Number(rawId), {
      force: config.deleteMode === "force" ? true : Boolean(args.options.force)
    });
    return args.options.json ? ok(renderJson(entity), entity) : ok(renderEntity(command, entity), entity);
  }

  return fail(`Unknown ${command} subcommand: ${subcommand ?? "(missing)"}`);
}

async function handleSeoCommand(args, store, options) {
  const [resourceName, rawId] = args.positionals;
  if (!resourceName) {
    return fail("Resource name is required.");
  }
  if (!rawId) {
    return fail("Resource id is required.");
  }

  const id = Number(rawId);
  const client = await resolveClient(args, store, options);
  const selectedClient = await store.getResolvedClient(args.options.client);
  const config = getResourceConfig(resourceName, selectedClient);
  const seoMeta = buildSeoMeta(args.options);
  const isUpdate = Object.keys(seoMeta).length > 0;

  const entity = isUpdate
    ? await client.update(config.route, id, { meta: seoMeta })
    : await client.get(config.route, id);

  const payload = extractSeoPayload(resourceName, entity, id);
  return args.options.json
    ? ok(renderJson(payload), payload)
    : ok(renderSeoPayload(payload, { updated: isUpdate }), payload);
}

async function handleLinksCommand(args, store, options) {
  const [subcommand, rawId] = args.positionals;

  if (subcommand !== "add") {
    return fail(`Unknown links subcommand: ${subcommand ?? "(missing)"}`);
  }

  if (!rawId) {
    return fail("Post id is required.");
  }

  if (
    typeof args.options.text !== "string" ||
    args.options.text.length === 0 ||
    typeof args.options.href !== "string" ||
    args.options.href.length === 0
  ) {
    return fail("Missing required flags: --text, --href");
  }

  const id = Number(rawId);
  const client = await resolveClient(args, store, options);
  const entity = await client.get("posts", id);
  const result = addLinkToContent(extractPostContent(entity), {
    text: args.options.text,
    href: args.options.href
  });

  if (result.updated) {
    await client.update("posts", id, { content: result.content });
  }

  const payload = buildLinksPayload({
    id,
    text: args.options.text,
    href: args.options.href,
    result
  });

  return args.options.json
    ? ok(renderJson(payload), payload)
    : ok(renderLinksPayload(payload), payload);
}

export async function runCli(argv, options = {}) {
  const { command, args: parsed } = parseCommandLine(argv);
  const store = new ConfigStore({ configDir: options.configDir });

  try {
    if (command === "client") {
      return await handleClientCommand(parsed, store);
    }

    if (command === "seo") {
      return await handleSeoCommand(parsed, store, options);
    }

    if (command === "links") {
      return await handleLinksCommand(parsed, store, options);
    }

    if (["posts", "pages", "products", "categories", "product-categories"].includes(command)) {
      return await handleResourceCommand(command, parsed, store, options);
    }

    return fail(`Unknown command: ${command ?? "(missing)"}`);
  } catch (error) {
    return fail(formatError(error));
  }
}
