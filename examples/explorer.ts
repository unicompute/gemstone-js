import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  PersistentRoot,
  Session,
  buildDoctorReport,
  decodeEscapedField,
  escapeSmalltalkStringLiteral,
  escapedFieldEncoderSource,
  oop,
  renderGeneratedModule,
  type RenderGeneratedModuleOptions,
  type SessionConfig,
} from "gemstone-js";

interface ExplorerOptions {
  host: string;
  port: number;
}

interface JsonResponse {
  status?: number;
  body: unknown;
}

interface ExplorerErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}

const ROOT_NAMES = ["UserGlobals", "Globals", "Published", "SessionMethods"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_METHOD_LIMIT = 300;
const MAX_METHOD_LIMIT = 1000;
const DEFAULT_CODEGEN_MANIFEST: RenderGeneratedModuleOptions = {
  imports: [
    {
      from: "gemstone-js",
      typeNames: ["Session", "TypedOop"],
    },
  ],
  functions: [
    {
      exportedName: "findBookingObject",
      className: "Booking",
      selector: "find:",
      argNames: ["id"],
      argTypes: ["string"],
      sessionType: "Session",
      returnType: "TypedOop<Booking>",
      returnKind: "object",
    },
  ],
};

const options = parseExplorerArgs(process.argv.slice(2));
const server = createServer((request, response) => {
  void route(request, response).catch((error) => {
    writeJson(response, 500, errorBody(error));
  });
});

server.listen(options.port, options.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  console.log(`GemStone explorer listening on http://${options.host}:${port}`);
});

process.once("SIGINT", () => shutdown());
process.once("SIGTERM", () => shutdown());

function shutdown() {
  server.close();
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = requestUrl(request);
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
    if (request.method === "HEAD") {
      writeHtml(response);
      return;
    }
    writeHtml(response, explorerHtml());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/config") {
    writeJson(response, 200, {
      roots: ROOT_NAMES,
      defaultCodegenManifest: DEFAULT_CODEGEN_MANIFEST,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/doctor") {
    writeJson(response, 200, await safeJson(() => doctorEndpoint()));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    writeJson(response, 200, await safeJson(() => statusEndpoint()));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/inspect") {
    writeJson(response, 200, await safeJson(() => inspectEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/globals") {
    writeJson(response, 200, await safeJson(() => globalsEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/roots") {
    writeJson(response, 200, await safeJson(() => rootsEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/classes") {
    writeJson(response, 200, await safeJson(() => classesEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/class") {
    writeJson(response, 200, await safeJson(() => classEndpoint(url)));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/eval") {
    writeJson(response, 200, await safeJson(() => evalEndpoint(request)));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/codegen/preview") {
    writeJson(response, 200, await safeJson(() => codegenPreviewEndpoint(request)));
    return;
  }
  writeJson(response, 404, { error: "not found" });
}

async function doctorEndpoint() {
  return buildDoctorReport({ live: false });
}

async function statusEndpoint() {
  return withSession(async (session) => {
    const [stone, inTransaction, needsCommit] = await Promise.all([
      session.eval("System stoneName").catch(() => null),
      session.inTransaction().catch(() => false),
      session.needsCommit().catch(() => false),
    ]);
    return {
      ok: true,
      sessionId: session.sessionId,
      stone,
      inTransaction,
      needsCommit,
      config: publicSessionConfig(session.config),
    };
  });
}

async function inspectEndpoint(url: URL) {
  const value = requiredQuery(url, "oop");
  return withSession((session) => session.inspect(oop(value)));
}

async function globalsEndpoint(url: URL) {
  const limit = limitFromUrl(url);
  return withSession(async (session) => {
    const items = await boundedRootItemsOop(session, "UserGlobals", limit + 1);
    return {
      root: "UserGlobals",
      limit,
      truncated: items.length > limit,
      entries: items.slice(0, limit).map(([name, value]) => ({
        name,
        oop: value.toString(),
      })),
    };
  });
}

async function rootsEndpoint(url: URL) {
  const limit = limitFromUrl(url);
  const rootName = url.searchParams.get("root") || "UserGlobals";
  return withSession(async (session) => {
    const root = new PersistentRoot(session, rootName);
    const items = await boundedRootItemsOop(session, root.rootName, limit + 1);
    return {
      root: root.rootName,
      limit,
      truncated: items.length > limit,
      entries: items.slice(0, limit).map(([name, value]) => ({
        name,
        oop: value.toString(),
      })),
    };
  });
}

async function classesEndpoint(url: URL) {
  const limit = limitFromUrl(url);
  const prefix = (url.searchParams.get("prefix") ?? "").trim();
  return withSession(async (session) => {
    const names = await classNames(session, prefix, limit + 1);
    return {
      prefix,
      limit,
      truncated: names.length > limit,
      classes: names.slice(0, limit),
    };
  });
}

async function classEndpoint(url: URL) {
  const name = requiredQuery(url, "name");
  const methodLimit = boundedIntegerFromUrl(url, "methodLimit", DEFAULT_METHOD_LIMIT, MAX_METHOD_LIMIT);
  return withSession(async (session) => {
    const [description, methods] = await Promise.all([
      session.describeClass(name),
      classMethods(session, name, methodLimit + 1),
    ]);
    return {
      description,
      methodLimit,
      methodsTruncated: methods.length > methodLimit,
      methods: methods.slice(0, methodLimit),
    };
  });
}

async function evalEndpoint(request: IncomingMessage) {
  const body = await readJsonBody(request);
  const source = requiredBodyString(body, "source");
  const returnKind = optionalBodyString(body, "returnKind") ?? "value";
  const commit = optionalBodyBoolean(body, "commit") ?? false;
  if (!["value", "oop", "inspect"].includes(returnKind)) {
    throw new Error("returnKind must be value, oop, or inspect.");
  }

  return withSession(async (session) => {
    if (returnKind === "oop") {
      const result = await session.execute(source);
      if (commit) await session.commit();
      else await session.abort().catch(() => undefined);
      return {
        returnKind,
        committed: commit,
        result: result.toString(),
      };
    }
    if (returnKind === "inspect") {
      const result = await session.execute(source);
      const inspection = await session.inspect(result);
      if (commit) await session.commit();
      else await session.abort().catch(() => undefined);
      return {
        returnKind,
        committed: commit,
        result: inspection,
      };
    }
    const result = await session.eval(source);
    if (commit) await session.commit();
    else await session.abort().catch(() => undefined);
    return {
      returnKind,
      committed: commit,
      result,
    };
  }, { finalize: false });
}

async function codegenPreviewEndpoint(request: IncomingMessage) {
  const body = await readJsonBody(request);
  const manifestText = requiredBodyString(body, "manifest");
  const manifest = JSON.parse(manifestText) as RenderGeneratedModuleOptions;
  return {
    code: renderGeneratedModule(manifest),
  };
}

async function boundedRootItemsOop(session: Session, rootName: string, maxItems: number) {
  const root = new PersistentRoot(session, rootName);
  const source = `
    | dict limit count encode |
    dict := ${root.rootName}.
    limit := ${maxItems}.
    count := 0.
    ${escapedFieldEncoderSource("encode")}
    String streamContents: [:stream |
      dict keysAndValuesDo: [:key :value |
        count < limit ifTrue: [
          count := count + 1.
          stream
            nextPutAll: (encode value: key);
            nextPut: $|;
            nextPutAll: value asOop asString;
            lf]]]
  `;
  return parseKeyOopRows(await session.eval(source), root.rootName);
}

function parseKeyOopRows(value: unknown, context: string): Array<[string, ReturnType<typeof oop>]> {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const delimiter = line.indexOf("|");
      if (delimiter < 0) throw new Error(`${context} item row is missing delimiter.`);
      const key = decodeEscapedField(line.slice(0, delimiter));
      const valueOop = line.slice(delimiter + 1);
      return [key, oop(valueOop)];
    });
}

async function classNames(session: Session, prefix: string, limit: number): Promise<string[]> {
  const source = `
    | prefix limit count |
    prefix := '${escapeSmalltalkStringLiteral(prefix)}'.
    limit := ${limit}.
    count := 0.
    String streamContents: [:stream |
      (Array with: UserGlobals with: Globals) do: [:dictionary |
        dictionary keysAndValuesDo: [:key :value | | keyString matchesPrefix isClass |
          count < limit ifTrue: [
            keyString := key asString.
            matchesPrefix := prefix size = 0 or: [
              (keyString size >= prefix size) and: [
                (keyString copyFrom: 1 to: prefix size) = prefix]].
            isClass := [value allInstVarNames. true] on: Exception do: [:ex | false].
            (matchesPrefix and: [isClass]) ifTrue: [
              count := count + 1.
              stream nextPutAll: keyString; lf]]]]]
  `;
  const result = await session.eval(source);
  return typeof result === "string" ? result.split(/\r?\n/).filter(Boolean) : [];
}

async function classMethods(session: Session, name: string, limit: number): Promise<Array<{ side: string; selector: string }>> {
  const className = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "";
  if (!className) throw new Error("Class name must be a GemStone global-style identifier.");
  const source = `
    | cls limit count |
    cls := ${className}.
    limit := ${limit}.
    count := 0.
    String streamContents: [:stream |
      [
        cls selectors asSortedCollection do: [:selector |
          count < limit ifTrue: [
            count := count + 1.
            stream nextPutAll: 'instance'; tab; nextPutAll: selector asString; lf]]
      ] on: Exception do: [:ex | ].
      [
        cls class selectors asSortedCollection do: [:selector |
          count < limit ifTrue: [
            count := count + 1.
            stream nextPutAll: 'class'; tab; nextPutAll: selector asString; lf]]
      ] on: Exception do: [:ex | ]]
  `;
  const result = await session.eval(source);
  if (typeof result !== "string") return [];
  return result
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [side, selector] = line.split("\t");
      return { side, selector };
    })
    .filter((entry) => entry.side && entry.selector);
}

async function safeJson(callback: () => Promise<unknown>): Promise<JsonResponse> {
  try {
    return { body: await callback() };
  } catch (error) {
    return { status: 500, body: errorBody(error) };
  }
}

async function withSession<T>(
  callback: (session: Session) => Promise<T>,
  options: { finalize?: boolean } = {},
): Promise<T> {
  const session = await Session.connect(Session.configFromEnv());
  try {
    return await callback(session);
  } finally {
    if (options.finalize !== false) {
      await session.abort().catch(() => undefined);
    }
    await session.logout().catch(() => undefined);
  }
}

function publicSessionConfig(config: SessionConfig) {
  return {
    stone: config.stone,
    netldi: config.netldi,
    host: config.host,
    username: config.username,
    gemService: config.gemService,
    nativeSessionWorker: config.nativeSessionWorker === true,
    libPath: config.libPath,
  };
}

function requestUrl(request: IncomingMessage): URL {
  const host = request.headers.host ?? `${options.host}:${options.port}`;
  return new URL(request.url ?? "/", `http://${host}`);
}

function limitFromUrl(url: URL): number {
  return boundedIntegerFromUrl(url, "limit", DEFAULT_LIMIT, MAX_LIMIT);
}

function boundedIntegerFromUrl(url: URL, name: string, defaultValue: number, maxValue: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return defaultValue;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maxValue) {
    throw new Error(`${name} must be an integer between 0 and ${maxValue}.`);
  }
  return value;
}

function requiredQuery(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new Error(`Missing query parameter: ${name}.`);
  return value;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredBodyString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Request field ${name} must be a non-empty string.`);
  }
  return value;
}

function optionalBodyString(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Request field ${name} must be a string.`);
  return value;
}

function optionalBodyBoolean(body: Record<string, unknown>, name: string): boolean | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`Request field ${name} must be a boolean.`);
  return value;
}

function writeHtml(response: ServerResponse, html = ""): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const payload = (value as JsonResponse).body !== undefined
    ? value as JsonResponse
    : { body: value };
  response.writeHead(payload.status ?? status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload.body, jsonReplacer, 2));
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function errorBody(error: unknown): ExplorerErrorBody {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  return {
    error: error instanceof Error ? error.message : String(error),
    code: typeof record.code === "string" ? record.code : undefined,
    details: record.details,
  };
}

function parseExplorerArgs(args: readonly string[]): ExplorerOptions {
  const parsed: ExplorerOptions = {
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 3117),
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node --experimental-strip-types examples/explorer.ts [options]

Options:
  --host <host>    Listen host (default: 127.0.0.1)
  --port <port>    Listen port (default: PORT or 3117)
  -h, --help       Show this help
`);
      process.exit(0);
    }
    if (arg === "--host") {
      parsed.host = requiredArg(args, index, arg);
      index += 1;
    } else if (arg === "--port") {
      parsed.port = parsePort(requiredArg(args, index, arg));
      index += 1;
    } else {
      throw new Error(`Unexpected option: ${arg}`);
    }
  }
  if (!Number.isSafeInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535) {
    throw new Error("Explorer port must be an integer between 1 and 65535.");
  }
  return parsed;
}

function requiredArg(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port)) throw new Error(`Invalid port: ${value}`);
  return port;
}

function explorerHtml(): string {
  const manifest = JSON.stringify(DEFAULT_CODEGEN_MANIFEST, null, 2).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GemStone Explorer</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --line: #d9dee7;
      --text: #17202a;
      --muted: #657283;
      --accent: #0f766e;
      --accent-2: #1d4ed8;
      --danger: #b42318;
      --code: #0f172a;
      --code-bg: #eef2f7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.45;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0;
    }
    header .meta {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .status {
      min-width: 8px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #9aa4b2;
      display: inline-block;
    }
    .status.ok { background: var(--accent); }
    .status.error { background: var(--danger); }
    main {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      min-height: calc(100vh - 58px);
    }
    nav {
      border-right: 1px solid var(--line);
      background: #fbfcfe;
      padding: 12px;
    }
    nav button {
      width: 100%;
      text-align: left;
      margin-bottom: 4px;
      background: transparent;
      color: var(--text);
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 9px 10px;
      font: inherit;
      cursor: pointer;
    }
    nav button[aria-selected="true"] {
      background: #e8f3f1;
      border-color: #b7ddd7;
      color: #0b5f59;
      font-weight: 700;
    }
    section {
      display: none;
      padding: 18px 20px 28px;
      max-width: 1280px;
    }
    section.active { display: block; }
    .toolbar {
      display: flex;
      align-items: end;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    label {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    input, select, textarea {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 9px;
      font: inherit;
      color: var(--text);
      background: var(--panel);
      min-height: 36px;
    }
    input[type="checkbox"] { min-height: 0; }
    textarea {
      width: 100%;
      min-height: 170px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      line-height: 1.5;
    }
    button.action {
      border: 1px solid #0b5f59;
      background: var(--accent);
      color: white;
      border-radius: 6px;
      padding: 8px 12px;
      min-height: 36px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button.secondary {
      border-color: var(--line);
      background: white;
      color: var(--text);
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(260px, 0.4fr) minmax(0, 0.6fr);
      gap: 14px;
      align-items: start;
    }
    .surface {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-height: 120px;
      overflow: hidden;
    }
    .surface h2 {
      margin: 0;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
      letter-spacing: 0;
      background: #fbfcfe;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 8px 10px;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      background: #fbfcfe;
    }
    td button {
      border: 0;
      background: transparent;
      color: var(--accent-2);
      padding: 0;
      font: inherit;
      cursor: pointer;
    }
    pre {
      margin: 0;
      padding: 12px;
      white-space: pre-wrap;
      overflow: auto;
      color: var(--code);
      background: var(--code-bg);
      min-height: 120px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
    }
    .rowline {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
    }
    .error-text { color: var(--danger); }
    @media (max-width: 820px) {
      main { grid-template-columns: 1fr; }
      nav {
        border-right: 0;
        border-bottom: 1px solid var(--line);
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 4px;
      }
      nav button { margin: 0; text-align: center; }
      .grid, .split { grid-template-columns: 1fr; }
      header { align-items: flex-start; }
    }
  </style>
</head>
<body>
  <header>
    <h1>GemStone Explorer</h1>
    <div class="meta">
      <span class="status" id="statusLight"></span>
      <span id="statusText">Idle</span>
      <button class="action secondary" id="refreshStatus">Status</button>
    </div>
  </header>
  <main>
    <nav aria-label="Explorer views">
      <button data-tab="inspect" aria-selected="true">Inspect</button>
      <button data-tab="globals">Globals</button>
      <button data-tab="roots">Roots</button>
      <button data-tab="workspace">Workspace</button>
      <button data-tab="classes">Classes</button>
      <button data-tab="codegen">Codegen</button>
    </nav>
    <div>
      <section id="inspect" class="active">
        <div class="toolbar">
          <label>OOP <input id="inspectOop" placeholder="123456789"></label>
          <button class="action" id="inspectRun">Inspect</button>
        </div>
        <div class="surface"><h2>Object</h2><pre id="inspectOutput"></pre></div>
      </section>
      <section id="globals">
        <div class="toolbar">
          <label>Limit <input id="globalsLimit" type="number" min="0" max="200" value="50"></label>
          <button class="action" id="globalsRun">Load</button>
        </div>
        <div class="grid">
          <div class="surface"><h2>UserGlobals</h2><div id="globalsTable"></div></div>
          <div class="surface"><h2>Selection</h2><pre id="globalsOutput"></pre></div>
        </div>
      </section>
      <section id="roots">
        <div class="toolbar">
          <label>Root <select id="rootName"></select></label>
          <label>Limit <input id="rootsLimit" type="number" min="0" max="200" value="50"></label>
          <button class="action" id="rootsRun">Load</button>
        </div>
        <div class="grid">
          <div class="surface"><h2>Entries</h2><div id="rootsTable"></div></div>
          <div class="surface"><h2>Selection</h2><pre id="rootsOutput"></pre></div>
        </div>
      </section>
      <section id="workspace">
        <div class="toolbar">
          <label>Return <select id="evalReturn"><option>value</option><option>oop</option><option>inspect</option></select></label>
          <label class="rowline"><input id="evalCommit" type="checkbox"> Commit</label>
          <button class="action" id="evalRun">Evaluate</button>
        </div>
        <div class="split">
          <textarea id="evalSource">System stoneName</textarea>
          <div class="surface"><h2>Result</h2><pre id="evalOutput"></pre></div>
        </div>
      </section>
      <section id="classes">
        <div class="toolbar">
          <label>Prefix <input id="classPrefix" value="Object"></label>
          <label>Limit <input id="classesLimit" type="number" min="0" max="200" value="50"></label>
          <button class="action" id="classesRun">Search</button>
          <label>Class <input id="className" value="Object"></label>
          <label>Methods <input id="classMethodLimit" type="number" min="0" max="1000" value="300"></label>
          <button class="action secondary" id="classDescribe">Describe</button>
        </div>
        <div class="grid">
          <div class="surface"><h2>Classes</h2><div id="classesTable"></div></div>
          <div class="surface"><h2>Description</h2><pre id="classOutput"></pre></div>
        </div>
      </section>
      <section id="codegen">
        <div class="toolbar">
          <button class="action" id="codegenRun">Preview</button>
        </div>
        <div class="split">
          <textarea id="codegenManifest">${manifest}</textarea>
          <div class="surface"><h2>Generated Module</h2><pre id="codegenOutput"></pre></div>
        </div>
      </section>
    </div>
  </main>
  <script>
    const state = { roots: [] };
    const out = (id, value) => {
      document.getElementById(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    };
    const api = async (path, options = {}) => {
      const response = await fetch(path, {
        ...options,
        headers: { "content-type": "application/json", ...(options.headers || {}) },
      });
      const body = await response.json();
      if (!response.ok || body.error) throw Object.assign(new Error(body.error || response.statusText), { body });
      return body;
    };
    const setStatus = (ok, text) => {
      document.getElementById("statusLight").className = "status " + (ok ? "ok" : "error");
      document.getElementById("statusText").textContent = text;
    };
    const table = (target, rows, columns) => {
      const html = [
        "<table><thead><tr>",
        ...columns.map((column) => "<th>" + column.label + "</th>"),
        "</tr></thead><tbody>",
        ...rows.map((row) => "<tr>" + columns.map((column) => "<td>" + column.render(row) + "</td>").join("") + "</tr>"),
        "</tbody></table>",
      ].join("");
      document.getElementById(target).innerHTML = html;
    };
    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const inspectLink = (oop) => "<button data-oop=\\"" + escapeHtml(oop) + "\\">" + escapeHtml(oop) + "</button>";

    document.querySelectorAll("nav button").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("nav button").forEach((item) => item.setAttribute("aria-selected", "false"));
        document.querySelectorAll("section").forEach((item) => item.classList.remove("active"));
        button.setAttribute("aria-selected", "true");
        document.getElementById(button.dataset.tab).classList.add("active");
      });
    });
    document.body.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const selectedOop = target.dataset.oop;
      const selectedClass = target.dataset.className;
      if (selectedOop) {
        document.getElementById("inspectOop").value = selectedOop;
        document.querySelector("nav button[data-tab='inspect']").click();
        await runInspect();
      }
      if (selectedClass) {
        document.getElementById("className").value = selectedClass;
        await describeClass();
      }
    });

    async function loadConfig() {
      const config = await api("/api/config");
      state.roots = config.roots;
      document.getElementById("rootName").innerHTML = config.roots.map((name) => "<option>" + escapeHtml(name) + "</option>").join("");
    }
    async function refreshStatus() {
      out("inspectOutput", "");
      try {
        const status = await api("/api/status");
        setStatus(true, status.stone ? "Connected: " + status.stone : "Connected");
      } catch (error) {
        setStatus(false, error.message);
      }
    }
    async function runInspect() {
      try {
        out("inspectOutput", await api("/api/inspect?oop=" + encodeURIComponent(document.getElementById("inspectOop").value)));
      } catch (error) {
        out("inspectOutput", error.body || error.message);
      }
    }
    async function loadGlobals() {
      try {
        const result = await api("/api/globals?limit=" + encodeURIComponent(document.getElementById("globalsLimit").value));
        table("globalsTable", result.entries, [
          { label: "Name", render: (row) => escapeHtml(row.name) },
          { label: "OOP", render: (row) => inspectLink(row.oop) },
        ]);
        out("globalsOutput", result);
      } catch (error) {
        out("globalsOutput", error.body || error.message);
      }
    }
    async function loadRoots() {
      const root = document.getElementById("rootName").value;
      const limit = document.getElementById("rootsLimit").value;
      try {
        const result = await api("/api/roots?root=" + encodeURIComponent(root) + "&limit=" + encodeURIComponent(limit));
        table("rootsTable", result.entries, [
          { label: "Name", render: (row) => escapeHtml(row.name) },
          { label: "OOP", render: (row) => inspectLink(row.oop) },
        ]);
        out("rootsOutput", result);
      } catch (error) {
        out("rootsOutput", error.body || error.message);
      }
    }
    async function runEval() {
      try {
        const result = await api("/api/eval", {
          method: "POST",
          body: JSON.stringify({
            source: document.getElementById("evalSource").value,
            returnKind: document.getElementById("evalReturn").value,
            commit: document.getElementById("evalCommit").checked,
          }),
        });
        out("evalOutput", result);
      } catch (error) {
        out("evalOutput", error.body || error.message);
      }
    }
    async function searchClasses() {
      const prefix = document.getElementById("classPrefix").value;
      const limit = document.getElementById("classesLimit").value;
      try {
        const result = await api("/api/classes?prefix=" + encodeURIComponent(prefix) + "&limit=" + encodeURIComponent(limit));
        table("classesTable", result.classes.map((name) => ({ name })), [
          { label: "Name", render: (row) => "<button data-class-name=\\"" + escapeHtml(row.name) + "\\">" + escapeHtml(row.name) + "</button>" },
        ]);
      } catch (error) {
        out("classOutput", error.body || error.message);
      }
    }
    async function describeClass() {
      try {
        const name = document.getElementById("className").value;
        const methodLimit = document.getElementById("classMethodLimit").value;
        out("classOutput", await api("/api/class?name=" + encodeURIComponent(name) + "&methodLimit=" + encodeURIComponent(methodLimit)));
      } catch (error) {
        out("classOutput", error.body || error.message);
      }
    }
    async function previewCodegen() {
      try {
        const result = await api("/api/codegen/preview", {
          method: "POST",
          body: JSON.stringify({ manifest: document.getElementById("codegenManifest").value }),
        });
        out("codegenOutput", result.code);
      } catch (error) {
        out("codegenOutput", error.body || error.message);
      }
    }

    document.getElementById("refreshStatus").addEventListener("click", refreshStatus);
    document.getElementById("inspectRun").addEventListener("click", runInspect);
    document.getElementById("globalsRun").addEventListener("click", loadGlobals);
    document.getElementById("rootsRun").addEventListener("click", loadRoots);
    document.getElementById("evalRun").addEventListener("click", runEval);
    document.getElementById("classesRun").addEventListener("click", searchClasses);
    document.getElementById("classDescribe").addEventListener("click", describeClass);
    document.getElementById("codegenRun").addEventListener("click", previewCodegen);

    loadConfig().then(refreshStatus).catch((error) => setStatus(false, error.message));
  </script>
</body>
</html>`;
}
