import { timingSafeEqual, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { ConfigStore } from "../lib/config-store.js";
import { WordPressApiError, WordPressClient, normalizeWordPressBaseUrl } from "../lib/wp-client.js";

/** 配置请求体允许占用的最大字节数。 */
const MAX_REQUEST_BYTES = 64 * 1024;
/** 配置服务默认空闲退出时间。 */
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** 启动本地配置服务时可覆盖的运行参数。 */
export interface ConfigServerOptions {
  /** 覆盖加密凭据库目录。 */
  configDir?: string;
  /** 覆盖空闲自动退出时间，主要用于测试。 */
  idleTimeoutMs?: number;
  /** 覆盖测试连接使用的 fetch 实现。 */
  fetchImpl?: typeof fetch;
  /** 是否尝试自动打开系统浏览器。 */
  openBrowser?: boolean;
}

/** 已启动配置服务对命令行入口公开的控制句柄。 */
export interface ConfigServerHandle {
  /** 包含一次性令牌 fragment 的浏览器地址。 */
  url: string;
  /** 实际监听的回环地址 origin。 */
  origin: string;
  /** 服务完全关闭时完成的 Promise。 */
  finished: Promise<void>;
  /** 主动关闭本地配置服务。 */
  close: () => Promise<void>;
}

/** 浏览器页面提交的连接字段。 */
interface ClientFormInput {
  /** 新连接名称。 */
  name: string;
  /** WordPress 站点地址。 */
  siteUrl: string;
  /** WordPress 用户名。 */
  username: string;
  /** 新应用密码；编辑时允许省略以保留旧值。 */
  appPassword?: string;
  /** 编辑前的连接名称。 */
  originalName?: string;
}

/** 判断任意值是否是非数组对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取并校验浏览器提交的非空字符串。 */
function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

/** 将未知请求对象校验为连接表单数据。 */
function parseClientForm(value: unknown, allowMissingPassword: boolean): ClientFormInput {
  if (!isRecord(value)) throw new Error("Request body must be a JSON object.");
  const password = value.appPassword;
  if (!allowMissingPassword && (typeof password !== "string" || password.trim().length === 0)) {
    throw new Error("Application Password must be a non-empty string.");
  }
  if (password !== undefined && typeof password !== "string") {
    throw new Error("Application Password must be a string.");
  }
  return {
    name: requireString(value.name, "Client name"),
    siteUrl: normalizeWordPressBaseUrl(requireString(value.siteUrl, "Site URL")),
    username: requireString(value.username, "Username"),
    appPassword: password,
    originalName: typeof value.originalName === "string" ? value.originalName : undefined
  };
}

/** 从请求流读取有限大小的 JSON 对象。 */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) throw new Error("Request body is too large.");
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > MAX_REQUEST_BYTES) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

/** 为所有页面和 API 响应设置禁止缓存及浏览器安全头。 */
function setSecurityHeaders(response: ServerResponse, nonce: string): void {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`
  );
}

/** 返回 JSON API 响应。 */
function sendJson(response: ServerResponse, status: number, value: unknown, nonce: string): void {
  setSecurityHeaders(response, nonce);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value)}\n`);
}

/** 使用恒定时间比较请求令牌，避免普通字符串比较泄露前缀信息。 */
function tokenMatches(requestToken: string, expectedToken: string): boolean {
  const actual = Buffer.from(requestToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 把内部异常转换为不包含凭据和远端响应细节的 UI 错误。 */
function safeErrorMessage(error: unknown, connectionTest = false): string {
  if (connectionTest) {
    if (error instanceof WordPressApiError && (error.status === 401 || error.status === 403)) {
      return "WordPress authentication failed. Check the username, Application Password, and account permissions.";
    }
    return "Connection test failed. Check the site URL, network, TLS certificate, and WordPress REST API.";
  }
  return error instanceof Error ? error.message : "Configuration operation failed.";
}

/** 生成不会把令牌发送到 HTTP 服务端或 Referer 的本地配置页面。 */
function renderPage(nonce: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>wp-api 安全配置</title>
<style nonce="${nonce}">
:root{color-scheme:light;--ink:#13231d;--muted:#66756e;--line:#dde7e1;--brand:#087a58;--brand-dark:#056044;--brand-soft:#eaf7f1;--canvas:#f3f7f4;--surface:#fff;--danger:#b42318;--shadow:0 18px 50px rgba(24,60,43,.09)}*{box-sizing:border-box}html{min-height:100%;background:var(--canvas)}body{margin:0;min-height:100vh;font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:radial-gradient(circle at 10% 0,#dff4e9 0,transparent 32rem),radial-gradient(circle at 100% 15%,#e8f0ff 0,transparent 28rem),var(--canvas)}button,input{font:inherit}button{cursor:pointer}.shell{width:min(1180px,calc(100% - 40px));margin:0 auto;padding:36px 0 56px}.hero{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:24px}.brand{display:flex;align-items:center;gap:14px}.brand-mark{width:48px;height:48px;display:grid;place-items:center;border-radius:15px;color:#fff;font-size:20px;font-weight:850;letter-spacing:-1px;background:linear-gradient(145deg,#0a8e66,#075b43);box-shadow:0 10px 24px rgba(8,122,88,.25)}h1,h2,p{margin-top:0}h1{margin-bottom:3px;font-size:25px;line-height:1.2;letter-spacing:-.02em}.subtitle{margin:0;color:var(--muted)}.layout{display:grid;grid-template-columns:minmax(340px,430px) minmax(0,1fr);gap:22px;align-items:start}.panel{background:rgba(255,255,255,.93);border:1px solid rgba(216,228,221,.95);border-radius:20px;box-shadow:var(--shadow);backdrop-filter:blur(12px)}.form-panel{position:sticky;top:22px;overflow:hidden}.panel-head{padding:22px 24px 17px;border-bottom:1px solid var(--line)}.eyebrow{margin:0 0 6px;color:var(--brand);font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.panel h2{margin-bottom:4px;font-size:19px;letter-spacing:-.01em}.panel-copy{margin:0;color:var(--muted);font-size:13px}.form-body{padding:22px 24px 24px}.fields{display:grid;gap:17px}.field{display:grid;gap:7px}.field-label{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:750}.optional{color:#8b9892;font-size:11px;font-weight:600}.input-wrap{position:relative}.input-wrap input{width:100%;height:44px;border:1px solid #cbd8d1;border-radius:11px;padding:0 13px;color:var(--ink);background:#fbfdfc;transition:border-color .16s,box-shadow .16s,background .16s}.input-wrap input::placeholder{color:#a1ada7}.input-wrap input:hover{border-color:#aebfb6}.input-wrap input:focus{outline:0;border-color:var(--brand);background:#fff;box-shadow:0 0 0 4px rgba(8,122,88,.11)}.field-help{color:var(--muted);font-size:12px}.form-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:23px}.button{min-height:41px;border:1px solid transparent;border-radius:11px;padding:9px 14px;font-weight:750;transition:transform .14s,box-shadow .14s,background .14s,border-color .14s}.button:hover{transform:translateY(-1px)}.button:active{transform:translateY(0)}.button.primary{color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-dark));box-shadow:0 8px 18px rgba(8,122,88,.18)}.button.secondary{color:#244138;background:#f2f7f4;border-color:#d9e5de}.button.ghost{color:#52635c;background:transparent;border-color:#dce6e0}.button.danger{color:var(--danger);background:#fff5f4;border-color:#f6d5d1}.button.compact{min-height:34px;padding:6px 10px;border-radius:9px;font-size:12px}.button:disabled{cursor:default;opacity:.52;transform:none}.cancel-row{margin-top:10px}.cancel-row .button{width:100%}.summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}.summary-card{padding:16px 18px}.summary-label{color:var(--muted);font-size:12px}.summary-value{display:block;margin-top:2px;font-size:21px;font-weight:800;letter-spacing:-.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.list-panel{padding:22px}.list-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}.list-head h2{margin:0}.count{min-width:28px;height:28px;display:grid;place-items:center;border-radius:9px;color:var(--brand);background:var(--brand-soft);font-size:12px;font-weight:800}.client-list{display:grid;gap:12px;margin-top:16px}.client-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;padding:17px;border:1px solid var(--line);border-radius:15px;background:#fff;transition:border-color .16s,box-shadow .16s,transform .16s}.client-card:hover{border-color:#bdd2c7;box-shadow:0 8px 24px rgba(24,60,43,.07);transform:translateY(-1px)}.client-main{display:flex;gap:12px;min-width:0;align-items:center}.client-avatar{width:42px;height:42px;flex:none;display:grid;place-items:center;border-radius:12px;color:var(--brand-dark);background:linear-gradient(145deg,#e5f6ee,#edf7ff);font-weight:850;text-transform:uppercase}.client-info{min-width:0}.client-title{display:flex;align-items:center;gap:8px;min-width:0}.client-name{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge{flex:none;padding:2px 8px;border-radius:999px;color:var(--brand);background:var(--brand-soft);font-size:11px;font-weight:800}.client-url,.client-user{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.client-url{margin-top:3px;color:#43564e;font-size:13px}.client-user{color:#819087;font-size:12px}.client-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.empty{padding:46px 20px;text-align:center;border:1px dashed #cbdad2;border-radius:15px;background:#fbfdfc}.empty-icon{width:50px;height:50px;display:grid;place-items:center;margin:0 auto 12px;border-radius:15px;color:var(--brand);background:var(--brand-soft);font-size:23px;font-weight:800}.empty strong{display:block;margin-bottom:4px}.empty p{margin:0;color:var(--muted);font-size:13px}.notice{position:fixed;z-index:10;top:18px;left:50%;max-width:min(560px,calc(100% - 32px));transform:translateX(-50%);padding:11px 15px;border:1px solid #bae0cf;border-radius:11px;color:#085e45;background:#effaf5;box-shadow:0 12px 32px rgba(24,60,43,.15);font-weight:700}.notice.error{color:#9b1c14;background:#fff4f2;border-color:#f0c5c0}.hidden{display:none!important}.closed{width:min(520px,calc(100% - 32px));margin:15vh auto;padding:34px;text-align:center}.closed .brand-mark{margin:0 auto 18px}@media(max-width:860px){.layout{grid-template-columns:1fr}.form-panel{position:static}.summary{margin-top:0}}@media(max-width:580px){.shell{width:min(100% - 24px,1180px);padding:20px 0 36px}.hero{align-items:flex-start}.hero .button{padding:8px 10px}.brand-mark{width:42px;height:42px;border-radius:13px}.layout{gap:14px}.panel-head,.form-body,.list-panel{padding-left:17px;padding-right:17px}.summary{gap:8px}.summary-card{padding:13px}.client-card{grid-template-columns:1fr}.client-actions{justify-content:flex-start}.form-actions{grid-template-columns:1fr}}
</style></head><body><main class="shell">
<header class="hero"><div class="brand"><div class="brand-mark" aria-hidden="true">WP</div><div><h1>安全连接管理</h1><p class="subtitle">凭据仅加密保存在本机，不会通过 MCP 返回。</p></div></div><button id="close" class="button ghost" type="button">关闭服务</button></header>
<div id="notice" class="notice hidden" role="status" aria-live="polite"></div>
<section class="summary" aria-label="连接概览"><div class="panel summary-card"><span class="summary-label">已保存连接</span><strong id="client-count" class="summary-value">0</strong></div></section>
<div class="layout">
<section id="form-panel" class="panel form-panel"><div class="panel-head"><p class="eyebrow">Connection</p><h2 id="form-title">添加新连接</h2><p class="panel-copy">填写 WordPress 站点和应用密码。</p></div><form id="form" class="form-body"><input id="original" type="hidden"><div class="fields">
<label class="field"><span class="field-label">连接名称</span><span class="input-wrap"><input id="name" autocomplete="off" required maxlength="100" placeholder="例如：生产站点"></span><span class="field-help">用于在 MCP 工具中识别该站点。</span></label>
<label class="field"><span class="field-label">站点 URL</span><span class="input-wrap"><input id="siteUrl" type="url" placeholder="https://example.com" required></span><span class="field-help">支持 HTTP 或 HTTPS，请填写 WordPress 根地址。</span></label>
<label class="field"><span class="field-label">WordPress 用户名</span><span class="input-wrap"><input id="username" autocomplete="username" required placeholder="editor"></span></label>
<label class="field"><span class="field-label">Application Password <span id="password-optional" class="optional hidden">可选</span></span><span class="input-wrap"><input id="password" type="password" autocomplete="new-password" placeholder="xxxx xxxx xxxx xxxx"></span><span id="password-help" class="field-help">新增连接时必须填写，保存后不会再次显示。</span></label>
</div><div class="form-actions"><button class="button primary" type="submit">保存连接</button><button class="button secondary" type="button" id="test">测试连接</button></div><div id="cancel-row" class="cancel-row hidden"><button class="button ghost" type="button" id="cancel">取消编辑</button></div></form></section>
<section class="panel list-panel"><div class="list-head"><div><p class="eyebrow">Saved sites</p><h2>已保存连接</h2></div><span id="count-badge" class="count">0</span></div><div id="clients" class="client-list"></div></section>
</div>
</main><script nonce="${nonce}">
const token=location.hash.startsWith('#token=')?decodeURIComponent(location.hash.slice(7)):'';history.replaceState(null,'',location.pathname);let state={clients:[]};
/* 按元素 ID 返回页面节点。 */
const el=id=>document.getElementById(id);
/* 在页面顶部显示成功或错误通知。 */
const notice=(message,error=false)=>{el('notice').textContent=message;el('notice').className='notice'+(error?' error':'');clearTimeout(notice.timer);notice.timer=setTimeout(()=>el('notice').classList.add('hidden'),4500)};
/* 携带一次性令牌调用同源配置 API，并统一解析错误。 */
async function api(path,options={}){const headers={Authorization:'Bearer '+token,...options.headers};if(options.body)headers['Content-Type']='application/json';const response=await fetch(path,{...options,headers});const data=await response.json().catch(()=>({error:'服务返回了无效响应。'}));if(!response.ok)throw new Error(data.error||'操作失败。');return data}
/* 清空连接表单并恢复新增状态。 */
function resetForm(){el('form').reset();el('original').value='';el('form-title').textContent='添加新连接';el('password-help').textContent='新增连接时必须填写，保存后不会再次显示。';el('password-optional').classList.add('hidden');el('cancel-row').classList.add('hidden')}
/* 把安全的连接资料填入表单，密码字段始终保持为空。 */
function editClient(client){el('original').value=client.name;el('name').value=client.name;el('siteUrl').value=client.siteUrl;el('username').value=client.username;el('password').value='';el('form-title').textContent='编辑连接';el('password-help').textContent='留空将保留现有密码。';el('password-optional').classList.remove('hidden');el('cancel-row').classList.remove('hidden');el('form-panel').scrollIntoView({behavior:'smooth',block:'start'});el('name').focus()}
/* 创建统一样式的连接操作按钮。 */
function actionButton(label,kind,handler,disabled=false){const button=document.createElement('button');button.type='button';button.className='button compact '+kind;button.textContent=label;button.disabled=disabled;button.onclick=()=>Promise.resolve(handler()).catch(error=>notice(error.message,true));return button}
/* 加载连接列表并创建对应的管理按钮。 */
async function load(){const data=await api('/api/clients');state=data;el('client-count').textContent=String(data.clients.length);el('count-badge').textContent=String(data.clients.length);const root=el('clients');root.replaceChildren();if(!data.clients.length){const empty=document.createElement('div');empty.className='empty';const icon=document.createElement('div');icon.className='empty-icon';icon.textContent='+';const title=document.createElement('strong');title.textContent='还没有连接';const copy=document.createElement('p');copy.textContent='在左侧填写站点信息，保存后即可供 MCP 使用。';empty.append(icon,title,copy);root.append(empty);return}for(const client of data.clients){const card=document.createElement('article');card.className='client-card';const main=document.createElement('div');main.className='client-main';const avatar=document.createElement('div');avatar.className='client-avatar';avatar.textContent=client.name.slice(0,2)||'WP';const info=document.createElement('div');info.className='client-info';const title=document.createElement('div');title.className='client-title';const name=document.createElement('span');name.className='client-name';name.textContent=client.name;title.append(name);const url=document.createElement('div');url.className='client-url';url.textContent=client.siteUrl;const user=document.createElement('div');user.className='client-user';user.textContent=client.username+' · '+(client.passwordSet?'密码已设置':'未设置密码');info.append(title,url,user);main.append(avatar,info);const actions=document.createElement('div');actions.className='client-actions';actions.append(actionButton('编辑','secondary',()=>editClient(client)),actionButton('测试','secondary',async()=>{await api('/api/clients/'+encodeURIComponent(client.name)+'/test',{method:'POST'});notice('连接测试成功。')}),actionButton('删除','danger',async()=>{if(confirm('确定删除连接 “'+client.name+'” 吗？')){await api('/api/clients/'+encodeURIComponent(client.name),{method:'DELETE'});notice('连接已删除。');resetForm();await load()}}));card.append(main,actions);root.append(card)}}
el('form').onsubmit=async event=>{event.preventDefault();try{const originalName=el('original').value;const body={name:el('name').value,siteUrl:el('siteUrl').value,username:el('username').value,appPassword:el('password').value};if(originalName)body.originalName=originalName;await api('/api/clients',{method:originalName?'PUT':'POST',body:JSON.stringify(body)});notice('连接已安全保存。');resetForm();await load()}catch(error){notice(error.message,true)}};
el('test').onclick=async()=>{try{await api('/api/test',{method:'POST',body:JSON.stringify({name:el('name').value,siteUrl:el('siteUrl').value,username:el('username').value,appPassword:el('password').value,originalName:el('original').value})});notice('连接测试成功。')}catch(error){notice(error.message,true)}};el('cancel').onclick=resetForm;el('close').onclick=async()=>{await api('/api/shutdown',{method:'POST'});document.body.innerHTML='<main class="panel closed"><div class="brand-mark">WP</div><h1>配置服务已关闭</h1><p class="subtitle">凭据已安全保存，可以关闭此页面。</p></main>'};
if(!token)notice('配置令牌缺失，请从 wp-api-config 命令重新打开页面。',true);else load().catch(error=>notice(error.message,true));
</script></body></html>`;
}

/** 尝试用当前平台的默认浏览器打开本地配置地址。 */
function launchBrowser(url: string): void {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => undefined);
  child.unref();
}

/** 启动只监听 IPv4 回环地址的一次性凭据配置服务。 */
export async function startConfigServer(options: ConfigServerOptions = {}): Promise<ConfigServerHandle> {
  const store = new ConfigStore({ configDir: options.configDir });
  const token = randomBytes(32).toString("base64url");
  const nonce = randomBytes(18).toString("base64url");
  let origin = "";
  let idleTimer: NodeJS.Timeout;
  let closed = false;
  let resolveFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });

  /** 关闭 HTTP 监听器并完成 finished Promise。 */
  const closeServer = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resolveFinished();
  };

  /** 重置收到合法请求后的空闲退出计时器。 */
  const resetIdleTimer = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void closeServer(); }, options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
    idleTimer.unref();
  };

  /** 处理配置页面和全部受保护的管理 API。 */
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    resetIdleTimer();
    const requestUrl = new URL(request.url ?? "/", origin);
    if (request.method === "GET" && requestUrl.pathname === "/") {
      setSecurityHeaders(response, nonce);
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(renderPage(nonce));
      return;
    }
    if (!requestUrl.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found." }, nonce);
      return;
    }
    const requestToken = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    if (!tokenMatches(requestToken, token)) {
      sendJson(response, 401, { error: "Invalid configuration token." }, nonce);
      return;
    }
    const requestOrigin = request.headers.origin;
    if ((requestOrigin && requestOrigin !== origin) || (request.method !== "GET" && requestOrigin !== origin)) {
      sendJson(response, 403, { error: "Invalid request origin." }, nonce);
      return;
    }

    try {
      if (request.method === "GET" && requestUrl.pathname === "/api/clients") {
        sendJson(response, 200, { clients: await store.listClientsForConfiguration() }, nonce);
        return;
      }
      if ((request.method === "POST" || request.method === "PUT") && requestUrl.pathname === "/api/clients") {
        const form = parseClientForm(await readJsonBody(request), request.method === "PUT");
        let appPassword = form.appPassword?.trim() ?? "";
        const originalName = form.originalName ?? form.name;
        if (request.method === "PUT" && appPassword.length === 0) {
          const existing = await store.getClient(originalName);
          if (!existing) throw new Error(`Client "${originalName}" not found.`);
          appPassword = existing.appPassword;
        }
        const saved = await store.saveClient({ name: form.name, siteUrl: form.siteUrl, username: form.username, appPassword }, originalName);
        sendJson(response, 200, saved, nonce);
        return;
      }
      const clientRoute = requestUrl.pathname.match(/^\/api\/clients\/([^/]+)\/test$/);
      const deleteRoute = requestUrl.pathname.match(/^\/api\/clients\/([^/]+)$/);
      if (request.method === "POST" && clientRoute) {
        const client = await store.getClient(decodeURIComponent(clientRoute[1]));
        if (!client) throw new Error("Client not found.");
        try {
          await new WordPressClient({ baseUrl: client.siteUrl, username: client.username, appPassword: client.appPassword, fetchImpl: options.fetchImpl }).request("users/me", { query: { context: "edit" } });
        } catch (error) {
          sendJson(response, 400, { error: safeErrorMessage(error, true) }, nonce);
          return;
        }
        sendJson(response, 200, { ok: true }, nonce);
        return;
      }
      if (request.method === "DELETE" && deleteRoute) {
        await store.removeClient(decodeURIComponent(deleteRoute[1]));
        sendJson(response, 200, { ok: true }, nonce);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/test") {
        const form = parseClientForm(await readJsonBody(request), true);
        let appPassword = form.appPassword?.trim() ?? "";
        if (!appPassword && form.originalName) appPassword = (await store.getClient(form.originalName))?.appPassword ?? "";
        if (!appPassword) throw new Error("Application Password must be provided for a connection test.");
        try {
          await new WordPressClient({ baseUrl: form.siteUrl, username: form.username, appPassword, fetchImpl: options.fetchImpl }).request("users/me", { query: { context: "edit" } });
        } catch (error) {
          sendJson(response, 400, { error: safeErrorMessage(error, true) }, nonce);
          return;
        }
        sendJson(response, 200, { ok: true }, nonce);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/shutdown") {
        sendJson(response, 200, { ok: true }, nonce);
        setImmediate(() => { void closeServer(); });
        return;
      }
      sendJson(response, 404, { error: "Not found." }, nonce);
    } catch (error) {
      sendJson(response, 400, { error: safeErrorMessage(error) }, nonce);
    }
  };

  /** 仅接受回环请求的底层 HTTP 服务。 */
  const server: Server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "Configuration service failed." }, nonce);
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer();
    throw new Error("Configuration service did not receive a TCP address.");
  }
  origin = `http://127.0.0.1:${address.port}`;
  const url = `${origin}/#token=${encodeURIComponent(token)}`;
  resetIdleTimer();
  if (options.openBrowser !== false) launchBrowser(url);
  return { url, origin, finished, close: closeServer };
}
