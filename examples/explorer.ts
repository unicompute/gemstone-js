import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  GemStoneError,
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
const MAX_ROOT_FILTER_LENGTH = 120;
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
  if (request.method === "GET" && url.pathname === "/api/symbol-list/users") {
    writeJson(response, 200, await safeJson(() => symbolListUsersEndpoint()));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/symbol-list/dictionaries") {
    writeJson(response, 200, await safeJson(() => symbolListDictionariesEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/symbol-list/entries") {
    writeJson(response, 200, await safeJson(() => symbolListEntriesEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/symbol-list/preview") {
    writeJson(response, 200, await safeJson(() => symbolListPreviewEndpoint(url)));
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
  if (request.method === "GET" && url.pathname === "/api/method-source") {
    writeJson(response, 200, await safeJson(() => methodSourceEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/class-browser/dictionaries") {
    writeJson(response, 200, await safeJson(() => classBrowserDictionariesEndpoint()));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/class-browser/classes") {
    writeJson(response, 200, await safeJson(() => classBrowserClassesEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/class-browser/categories") {
    writeJson(response, 200, await safeJson(() => classBrowserCategoriesEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/class-browser/methods") {
    writeJson(response, 200, await safeJson(() => classBrowserMethodsEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/class-browser/source") {
    writeJson(response, 200, await safeJson(() => classBrowserSourceEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/class-browser/inspect-target") {
    writeJson(response, 200, await safeJson(() => classBrowserInspectTargetEndpoint(url)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/class-browser/file-out") {
    writeJson(response, 200, await safeJson(() => classBrowserFileOutEndpoint(url)));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/eval") {
    writeJson(response, 200, await safeJson(() => evalEndpoint(request)));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/debug") {
    writeJson(response, 200, await safeJson(() => debugEndpoint(request)));
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
  const filter = rootFilterFromUrl(url);
  return withSession(async (session) => {
    const items = await boundedRootItemsOop(session, "UserGlobals", limit + 1, filter);
    return {
      root: "UserGlobals",
      filter,
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
  const filter = rootFilterFromUrl(url);
  const rootName = url.searchParams.get("root") || "UserGlobals";
  return withSession(async (session) => {
    const root = new PersistentRoot(session, rootName);
    const items = await boundedRootItemsOop(session, root.rootName, limit + 1, filter);
    return {
      root: root.rootName,
      filter,
      limit,
      truncated: items.length > limit,
      entries: items.slice(0, limit).map(([name, value]) => ({
        name,
        oop: value.toString(),
      })),
    };
  });
}

async function symbolListUsersEndpoint() {
  return withSession(async (session) => {
    const result = await session.eval(`
      | allUsers text |
      ${allUsersSource()}
      text := String streamContents: [:stream |
        allUsers isNil ifFalse: [
          allUsers do: [:user | | uid |
            uid := ([user userId] on: Error do: [:ex | user printString]) asString.
            stream nextPutAll: uid; lf]]].
      text
    `);
    return {
      users: splitLines(result),
    };
  });
}

async function symbolListDictionariesEndpoint(url: URL) {
  const user = requiredQuery(url, "user");
  return withSession(async (session) => {
    const escapedUser = escapeSmalltalkStringLiteral(user);
    const result = await session.eval(`
      | allUsers userProfile text |
      ${allUsersSource()}
      userProfile := ${allUsersDetectUserSource(escapedUser)}.
      text := String streamContents: [:stream |
        userProfile isNil ifFalse: [
          userProfile symbolList do: [:dict | | name |
            name := ([dict name] on: Error do: [:ex | dict printString]) asString.
            stream nextPutAll: name; lf]]].
      text
    `);
    return {
      user,
      dictionaries: splitLines(result),
    };
  });
}

async function symbolListEntriesEndpoint(url: URL) {
  const user = requiredQuery(url, "user");
  const dictionary = requiredQuery(url, "dictionary");
  const filter = rootFilterFromUrl(url);
  const limit = limitFromUrl(url);
  return withSession(async (session) => {
    const escapedUser = escapeSmalltalkStringLiteral(user);
    const escapedDictionary = escapeSmalltalkStringLiteral(dictionary);
    const escapedFilter = escapeSmalltalkStringLiteral(filter);
    const result = await session.eval(`
      | allUsers userProfile dict filter limit count text |
      ${allUsersSource()}
      userProfile := ${allUsersDetectUserSource(escapedUser)}.
      filter := '${escapedFilter}' asLowercase.
      limit := ${limit + 1}.
      count := 0.
      text := String streamContents: [:stream |
        userProfile isNil ifFalse: [
          dict := userProfile symbolList detect: [:each |
            ([each name] on: Error do: [:ex | each printString]) asString = '${escapedDictionary}'] ifNone: [nil].
          dict isNil ifFalse: [
            dict keysDo: [:key | | keyString matches |
              count < limit ifTrue: [
                keyString := key asString.
                matches := filter size = 0 or: [
                  (keyString asLowercase findString: filter startingAt: 1) > 0].
                matches ifTrue: [
                  count := count + 1.
                  stream nextPutAll: keyString; lf]]]]]].
      text
    `);
    const entries = splitLines(result);
    return {
      user,
      dictionary,
      filter,
      limit,
      truncated: entries.length > limit,
      entries: entries.slice(0, limit),
    };
  });
}

async function symbolListPreviewEndpoint(url: URL) {
  const user = requiredQuery(url, "user");
  const dictionary = requiredQuery(url, "dictionary");
  const key = requiredQuery(url, "key");
  return withSession(async (session) => {
    const escapedUser = escapeSmalltalkStringLiteral(user);
    const escapedDictionary = escapeSmalltalkStringLiteral(dictionary);
    const escapedKey = escapeSmalltalkStringLiteral(key);
    const value = await session.execute(`
      | allUsers userProfile dict |
      ${allUsersSource()}
      userProfile := ${allUsersDetectUserSource(escapedUser)}.
      userProfile isNil ifTrue: [nil] ifFalse: [
        dict := userProfile symbolList detect: [:each |
          ([each name] on: Error do: [:ex | each printString]) asString = '${escapedDictionary}'] ifNone: [nil].
        dict isNil ifTrue: [nil] ifFalse: [
          dict at: '${escapedKey}' ifAbsent: [
            dict at: '${escapedKey}' asSymbol ifAbsent: [nil]]]]
    `);
    return {
      user,
      dictionary,
      key,
      oop: value.toString(),
      inspection: await session.inspect(value),
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

async function methodSourceEndpoint(url: URL) {
  const name = validateGlobalName(requiredQuery(url, "class"));
  const side = requiredQuery(url, "side");
  const selector = requiredQuery(url, "selector");
  if (!["instance", "class"].includes(side)) {
    throw new Error("side must be instance or class.");
  }
  if (selector.length > 200) {
    throw new Error("selector must be 200 characters or fewer.");
  }
  return withSession(async (session) => {
    const behaviorSource = side === "class" ? `${name} class` : name;
    const escapedSelector = escapeSmalltalkStringLiteral(selector);
    const source = await session.eval(`
      | behavior method |
      behavior := ${behaviorSource}.
      method := ([behavior compiledMethodAt: '${escapedSelector}' asSymbol ifAbsent: [nil]] on: Error do: [:ex | nil]).
      method isNil ifTrue: [
        method := ([behavior lookupSelector: '${escapedSelector}' asSymbol] on: Error do: [:ex | nil])].
      method isNil
        ifTrue: ['']
        ifFalse: [[method sourceString] on: Error do: [:ex | '']]
    `);
    return {
      class: name,
      side,
      selector,
      source: typeof source === "string" ? source : String(source ?? ""),
    };
  });
}

async function classBrowserDictionariesEndpoint() {
  return withSession(async (session) => {
    const result = await session.eval(`
      | stream |
      stream := WriteStream on: String new.
      System myUserProfile symbolList do: [:dict |
        stream nextPutAll: (([dict name] on: Error do: [:ex | dict printString]) asString); lf].
      stream contents
    `);
    return {
      dictionaries: splitLines(result),
    };
  });
}

async function classBrowserClassesEndpoint(url: URL) {
  const dictionary = requiredQuery(url, "dictionary");
  return withSession(async (session) => {
    const result = await session.eval(`
      | dict stream classNames |
      dict := ${classBrowserDictionaryExpression(dictionary)}.
      stream := WriteStream on: String new.
      dict isNil ifFalse: [
        classNames := dict keys select: [:key | [(dict at: key) isBehavior] on: Error do: [:ex | false]].
        classNames asSortedCollection do: [:name | stream nextPutAll: name asString; lf]].
      stream contents
    `);
    return {
      dictionary,
      classes: splitLines(result),
    };
  });
}

async function classBrowserCategoriesEndpoint(url: URL) {
  const dictionary = requiredQuery(url, "dictionary");
  const className = requiredQuery(url, "class");
  const meta = booleanFromUrl(url, "meta");
  return withSession(async (session) => {
    const result = await session.eval(`
      | cls stream |
      cls := ${classBrowserBehaviorExpression(className, dictionary, meta)}.
      stream := WriteStream on: String new.
      cls isNil ifFalse: [
        [cls categoryNames asSortedCollection do: [:category | stream nextPutAll: category asString; lf]]
          on: Error do: [:ex | ]].
      stream contents
    `);
    return {
      dictionary,
      class: className,
      meta,
      categories: ["-- all --", ...splitLines(result)],
    };
  });
}

async function classBrowserMethodsEndpoint(url: URL) {
  const dictionary = requiredQuery(url, "dictionary");
  const className = requiredQuery(url, "class");
  const protocol = url.searchParams.get("protocol")?.trim() || "-- all --";
  const meta = booleanFromUrl(url, "meta");
  return withSession(async (session) => {
    const escapedProtocol = escapeSmalltalkStringLiteral(protocol);
    const result = await session.eval(`
      | cls stream selectors |
      cls := ${classBrowserBehaviorExpression(className, dictionary, meta)}.
      stream := WriteStream on: String new.
      cls isNil ifFalse: [
        selectors := '${escapedProtocol}' = '-- all --'
          ifTrue: [[cls selectors] on: Error do: [:ex | #()]]
          ifFalse: [[cls selectorsIn: '${escapedProtocol}' asSymbol] on: Error do: [:ex | #()]].
        selectors ifNil: [selectors := #()].
        selectors asSortedCollection do: [:selector | stream nextPutAll: selector asString; lf]].
      stream contents
    `);
    return {
      dictionary,
      class: className,
      protocol,
      meta,
      methods: splitLines(result),
    };
  });
}

async function classBrowserSourceEndpoint(url: URL) {
  const dictionary = requiredQuery(url, "dictionary");
  const className = requiredQuery(url, "class");
  const selector = url.searchParams.get("selector")?.trim() || "";
  const meta = booleanFromUrl(url, "meta");
  if (selector.length > 200) {
    throw new Error("selector must be 200 characters or fewer.");
  }
  return withSession(async (session) => {
    const escapedSelector = escapeSmalltalkStringLiteral(selector);
    const source = await session.eval(`
      | cls method |
      cls := ${classBrowserBehaviorExpression(className, dictionary, meta)}.
      cls isNil ifTrue: [''] ifFalse: [
        '${escapedSelector}' isEmpty
          ifTrue: [
            (cls respondsTo: #definition)
              ifTrue: [[cls definition asString] on: Error do: [:ex | cls printString]]
              ifFalse: [cls printString]]
          ifFalse: [
            method := [cls compiledMethodAt: '${escapedSelector}' asSymbol ifAbsent: [nil]] on: Error do: [:ex | nil].
            method isNil ifTrue: [''] ifFalse: [[method sourceString] on: Error do: [:ex | '']]]]
    `);
    return {
      dictionary,
      class: className,
      selector,
      meta,
      source: typeof source === "string" ? source : String(source ?? ""),
    };
  });
}

async function classBrowserInspectTargetEndpoint(url: URL) {
  const mode = url.searchParams.get("mode")?.trim() || "";
  const dictionary = url.searchParams.get("dictionary")?.trim() || "";
  const className = url.searchParams.get("class")?.trim() || "";
  const selector = url.searchParams.get("selector")?.trim() || "";
  const meta = booleanFromUrl(url, "meta");
  const validModes = new Set(["dictionary", "class", "instances", "method"]);
  if (!validModes.has(mode)) throw new Error("unsupported inspect target.");
  if (mode === "dictionary" && !dictionary) throw new Error("missing dictionary.");
  if (["class", "instances", "method"].includes(mode) && !className) throw new Error("missing class.");
  if (mode === "method" && !selector) throw new Error("missing selector.");

  const expression = classBrowserInspectExpression(mode, dictionary, className, selector, meta);
  return withSession(async (session) => {
    const value = await session.execute(expression);
    return {
      mode,
      dictionary,
      class: className,
      selector,
      meta,
      oop: value.toString(),
      inspection: await session.inspect(value),
    };
  });
}

async function classBrowserFileOutEndpoint(url: URL) {
  const mode = url.searchParams.get("mode")?.trim() || "class";
  const dictionary = url.searchParams.get("dictionary")?.trim() || "";
  const className = url.searchParams.get("class")?.trim() || "";
  const selector = url.searchParams.get("selector")?.trim() || "";
  const meta = booleanFromUrl(url, "meta");
  const validModes = new Set(["class", "class-methods", "dictionary", "dictionary-methods", "method"]);
  if (!validModes.has(mode)) throw new Error("unsupported file-out mode.");
  if (["class", "class-methods", "method"].includes(mode) && !className) throw new Error("missing class.");
  if (mode.startsWith("dictionary") && !dictionary) throw new Error("missing dictionary.");
  if (mode === "method" && !selector) throw new Error("missing selector.");

  const metaSuffix = meta && mode.startsWith("class") ? "-class" : "";
  const filename = {
    "class": `${className}${metaSuffix}.st`,
    "class-methods": `${className}${metaSuffix}-methods.st`,
    "dictionary": `${dictionary}.st`,
    "dictionary-methods": `${dictionary}-methods.st`,
    "method": `${className}${metaSuffix}-${selector.replace(/[^A-Za-z0-9_:-]+/g, "_")}.st`,
  }[mode];

  return withSession(async (session) => {
    const source = await session.eval(classBrowserFileOutSource(mode, dictionary, className, selector, meta));
    return {
      mode,
      dictionary,
      class: className,
      selector,
      meta,
      filename,
      source: typeof source === "string" ? source : String(source ?? ""),
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

async function debugEndpoint(request: IncomingMessage) {
  const body = await readJsonBody(request);
  const source = requiredBodyString(body, "source");
  const returnKind = optionalBodyString(body, "returnKind") ?? "inspect";
  if (!["value", "oop", "inspect"].includes(returnKind)) {
    throw new Error("returnKind must be value, oop, or inspect.");
  }

  const session = await Session.connect(Session.configFromEnv());
  const startedAt = Date.now();
  try {
    try {
      const result = await session.execute(source);
      const info = await session.runtime.err().catch(() => null);
      if (info?.number) throw GemStoneError.fromInfo(info);
      const payload = await debugSuccessPayload(session, result, returnKind);
      await session.abort().catch(() => undefined);
      return {
        ok: true,
        source,
        returnKind,
        elapsedMs: Date.now() - startedAt,
        ...payload,
      };
    } catch (error) {
      const problem = await debugProblemPayload(session, error);
      await session.abort().catch(() => undefined);
      return {
        ok: false,
        source,
        returnKind,
        elapsedMs: Date.now() - startedAt,
        problem,
      };
    }
  } finally {
    await session.logout().catch(() => undefined);
  }
}

async function debugSuccessPayload(session: Session, result: ReturnType<typeof oop>, returnKind: string) {
  if (returnKind === "oop") {
    return {
      resultOop: result.toString(),
    };
  }
  if (returnKind === "inspect") {
    return {
      resultOop: result.toString(),
      result: await session.inspect(result),
    };
  }
  return {
    resultOop: result.toString(),
    result: await session.marshalOop(result),
  };
}

async function debugProblemPayload(session: Session, error: unknown) {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const info = error instanceof GemStoneError ? error.info : record.info as Record<string, unknown> | undefined;
  const inspections = await debugInspections(session, info);
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    code: typeof record.code === "string" ? record.code : undefined,
    number: error instanceof GemStoneError ? error.number : numericField(record.number),
    fatal: error instanceof GemStoneError ? error.fatal : booleanField(record.fatal),
    reason: typeof info?.reason === "string" ? info.reason : typeof record.reason === "string" ? record.reason : undefined,
    categoryOop: oopStringField(info?.category),
    contextOop: oopStringField(info?.context),
    exceptionOop: oopStringField(info?.exceptionObj),
    argOops: Array.isArray(info?.args) ? info.args.map(oopStringField).filter(Boolean) : undefined,
    stack: debugStack(inspections),
    inspections,
  };
}

async function debugInspections(session: Session, info: Record<string, unknown> | undefined) {
  const entries = [
    ["context", info?.context],
    ["exception", info?.exceptionObj],
  ] as const;
  const result: Record<string, unknown> = {};
  for (const [name, value] of entries) {
    if (typeof value !== "bigint") continue;
    result[name] = await inspectForDebugger(session, value);
  }
  if (Array.isArray(info?.args)) {
    result.args = await Promise.all(info.args
      .filter((value): value is bigint => typeof value === "bigint")
      .map((value) => inspectForDebugger(session, value)));
  }
  return result;
}

function debugStack(inspections: Record<string, unknown>): string | undefined {
  const context = inspections.context as { inspection?: { printString?: unknown } } | undefined;
  return typeof context?.inspection?.printString === "string"
    ? context.inspection.printString
    : undefined;
}

async function inspectForDebugger(session: Session, value: ReturnType<typeof oop>) {
  try {
    return {
      oop: value.toString(),
      inspection: await session.inspect(value),
    };
  } catch (error) {
    return {
      oop: value.toString(),
      inspectionError: errorBody(error),
    };
  }
}

async function codegenPreviewEndpoint(request: IncomingMessage) {
  const body = await readJsonBody(request);
  const manifestText = requiredBodyString(body, "manifest");
  const manifest = JSON.parse(manifestText) as RenderGeneratedModuleOptions;
  return {
    code: renderGeneratedModule(manifest),
  };
}

async function boundedRootItemsOop(session: Session, rootName: string, maxItems: number, filter: string) {
  const root = new PersistentRoot(session, rootName);
  const source = `
    | dict limit count encode filter |
    dict := ${root.rootName}.
    limit := ${maxItems}.
    count := 0.
    filter := '${escapeSmalltalkStringLiteral(filter)}' asLowercase.
    ${escapedFieldEncoderSource("encode")}
    String streamContents: [:stream |
      dict keysAndValuesDo: [:key :value | | keyString matches |
        count < limit ifTrue: [
          keyString := key asString.
          matches := filter size = 0 or: [
            (keyString asLowercase findString: filter startingAt: 1) > 0].
          matches ifTrue: [
            count := count + 1.
            stream
              nextPutAll: (encode value: key);
              nextPut: $|;
              nextPutAll: value asOop asString;
              lf]]]]
  `;
  return parseKeyOopRows(await session.eval(source), root.rootName);
}

function splitLines(value: unknown): string[] {
  return typeof value === "string"
    ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
}

function allUsersSource(): string {
  return `
    allUsers := nil.
    allUsers isNil ifTrue: [
      ${loadUserCollectionSource("System myUserProfile symbolList objectNamed: #AllUsers")}
    ].
    allUsers isNil ifTrue: [
      ${loadUserCollectionSource("Globals at: #AllUsers ifAbsent: [nil]")}
    ].
    allUsers isNil ifTrue: [
      ${loadUserCollectionSource("UserGlobals at: #AllUsers ifAbsent: [nil]")}
    ].
    allUsers isNil ifTrue: [
      ${loadUserCollectionSource("System myUserProfile")}
    ].
  `;
}

function loadUserCollectionSource(sourceExpression: string): string {
  return `
    allUsers := [${sourceExpression}] on: Error do: [:ex | nil].
    ((allUsers notNil) and: [(allUsers respondsTo: #userId) and: [allUsers respondsTo: #symbolList]]) ifTrue: [
      allUsers := Array with: allUsers
    ].
    (${validUserCollectionSource("allUsers")}) ifFalse: [
      allUsers := nil
    ].
  `;
}

function validUserCollectionSource(variableName: string): string {
  return `
    ((${variableName} notNil) and: [
      (( ${variableName} respondsTo: #userId) and: [${variableName} respondsTo: #symbolList])
        ifTrue: [true]
        ifFalse: [
          | foundValidUser |
          foundValidUser := false.
          [${variableName} do: [:each |
            ((each respondsTo: #userId) and: [each respondsTo: #symbolList]) ifTrue: [
              foundValidUser := true]]
          ] on: Error do: [:ex | foundValidUser := false].
          foundValidUser
        ]
    ])
  `;
}

function allUsersDetectUserSource(escapedUser: string): string {
  return `
    allUsers isNil ifTrue: [nil] ifFalse: [
      allUsers detect: [:each |
        (([each userId] on: Error do: [:ex | each printString]) asString) = '${escapedUser}']
        ifNone: [nil]]
  `;
}

function booleanFromUrl(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function classBrowserDictionaryExpression(dictionary: string): string {
  const escapedDictionary = escapeSmalltalkStringLiteral(dictionary);
  return `(System myUserProfile symbolList detect: [:dict |
    (([dict name] on: Error do: [:ex | dict printString]) asString) = '${escapedDictionary}']
    ifNone: [nil])`;
}

function classBrowserBehaviorExpression(className: string, dictionary: string, meta: boolean): string {
  const escapedClass = escapeSmalltalkStringLiteral(validateGlobalName(className));
  const metaSuffix = meta ? " class" : "";
  return `[ | dict cls |
    dict := ${classBrowserDictionaryExpression(dictionary)}.
    cls := dict isNil ifTrue: [nil] ifFalse: [dict at: '${escapedClass}' asSymbol ifAbsent: [nil]].
    cls isNil ifTrue: [nil] ifFalse: [cls${metaSuffix}]
  ] value`;
}

function classBrowserInspectExpression(
  mode: string,
  dictionary: string,
  className: string,
  selector: string,
  meta: boolean,
): string {
  if (mode === "dictionary") {
    return classBrowserDictionaryExpression(dictionary);
  }
  if (mode === "class") {
    return classBrowserBehaviorExpression(className, dictionary, meta);
  }
  if (mode === "instances") {
    return `[ | cls |
      cls := ${classBrowserBehaviorExpression(className, dictionary, false)}.
      cls isNil ifTrue: [nil] ifFalse: [cls allInstances]
    ] value`;
  }
  const escapedSelector = escapeSmalltalkStringLiteral(selector);
  return `[ | cls |
    cls := ${classBrowserBehaviorExpression(className, dictionary, meta)}.
    cls isNil ifTrue: [nil] ifFalse: [
      [cls compiledMethodAt: '${escapedSelector}' asSymbol ifAbsent: [nil]] on: Error do: [:ex | nil]]
  ] value`;
}

function classBrowserFileOutSource(
  mode: string,
  dictionary: string,
  className: string,
  selector: string,
  meta: boolean,
): string {
  const dictionaryExpression = classBrowserDictionaryExpression(dictionary);
  const behaviorExpression = classBrowserBehaviorExpression(className || "Object", dictionary, meta);
  const escapedSelector = escapeSmalltalkStringLiteral(selector);
  if (mode === "dictionary" || mode === "dictionary-methods") {
    const includeDefinitions = mode === "dictionary";
    return `
      | dict stream classes |
      dict := ${dictionaryExpression}.
      stream := WriteStream on: String new.
      dict isNil ifFalse: [
        classes := dict keys select: [:key | [(dict at: key) isBehavior] on: Error do: [:ex | false]].
        classes asSortedCollection do: [:name | | cls |
          cls := dict at: name.
          ${includeDefinitions ? "(cls respondsTo: #definition) ifTrue: [stream nextPutAll: cls definition asString; lf; lf]." : ""}
          cls selectors asSortedCollection do: [:sel | | src |
            src := [(cls compiledMethodAt: sel) sourceString] on: Error do: [:ex | ''].
            src isEmpty ifFalse: [stream nextPutAll: src; lf; lf]]]].
      stream contents
    `;
  }
  if (mode === "method") {
    return `
      | cls method |
      cls := ${behaviorExpression}.
      cls isNil ifTrue: [''] ifFalse: [
        method := [cls compiledMethodAt: '${escapedSelector}' asSymbol ifAbsent: [nil]] on: Error do: [:ex | nil].
        method isNil ifTrue: [''] ifFalse: [[method sourceString] on: Error do: [:ex | '']]]
    `;
  }
  const includeDefinition = mode === "class";
  return `
    | cls stream |
    cls := ${behaviorExpression}.
    stream := WriteStream on: String new.
    cls isNil ifFalse: [
      ${includeDefinition ? "(cls respondsTo: #definition) ifTrue: [stream nextPutAll: cls definition asString; lf; lf]." : ""}
      cls selectors asSortedCollection do: [:sel | | src |
        src := [(cls compiledMethodAt: sel) sourceString] on: Error do: [:ex | ''].
        src isEmpty ifFalse: [stream nextPutAll: src; lf; lf]]].
    stream contents
  `;
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
  const className = validateGlobalName(name);
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

function validateGlobalName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("Name must be a GemStone global-style identifier.");
  }
  return name;
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

function rootFilterFromUrl(url: URL): string {
  const value = (url.searchParams.get("filter") ?? "").trim();
  if (value.length > MAX_ROOT_FILTER_LENGTH) {
    throw new Error(`filter must be ${MAX_ROOT_FILTER_LENGTH} characters or fewer.`);
  }
  return value;
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

function numericField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function oopStringField(value: unknown): string | undefined {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value;
  return undefined;
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
      height: 100vh;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-height: 54px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      position: relative;
      top: 0;
      z-index: 1000;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0;
      white-space: nowrap;
    }
    .menubar {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1 1 auto;
      min-width: 0;
      overflow-x: auto;
      padding: 2px;
    }
    .menubar button {
      border: 1px solid transparent;
      background: transparent;
      color: var(--text);
      border-radius: 6px;
      padding: 7px 9px;
      min-height: 32px;
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .menubar button:hover,
    .menubar button:focus-visible {
      background: #e8f3f1;
      border-color: #b7ddd7;
      outline: none;
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
      position: relative;
      height: calc(100vh - 94px);
      overflow: auto;
      background:
        linear-gradient(var(--line) 1px, transparent 1px),
        linear-gradient(90deg, var(--line) 1px, transparent 1px);
      background-color: var(--bg);
      background-size: 24px 24px;
    }
    .taskbar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      min-height: 40px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-top: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(8px);
      z-index: 1200;
      overflow-x: auto;
    }
    .taskbar button {
      border: 1px solid var(--line);
      background: white;
      color: var(--text);
      border-radius: 6px;
      padding: 6px 9px;
      min-height: 30px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .taskbar button.active {
      border-color: #8fc8c0;
      background: #e8f3f1;
      font-weight: 700;
    }
    .tool-window {
      position: absolute;
      left: var(--x);
      top: var(--y);
      width: var(--w);
      min-width: 320px;
      max-width: calc(100% - 16px);
      min-height: 210px;
      max-height: calc(100vh - 78px);
      display: flex;
      flex-direction: column;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 18px 45px rgba(23, 32, 42, 0.16);
      resize: both;
      overflow: hidden;
    }
    .tool-window.hidden { display: none; }
    .tool-window[data-active="true"] {
      border-color: #8fc8c0;
      box-shadow: 0 22px 54px rgba(23, 32, 42, 0.22);
    }
    .window-titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 38px;
      padding: 7px 8px 7px 12px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfe;
      cursor: move;
      user-select: none;
      touch-action: none;
    }
    .window-titlebar h2 {
      margin: 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      letter-spacing: 0;
    }
    .window-button {
      width: 28px;
      min-width: 28px;
      height: 26px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: white;
      color: var(--text);
      font: inherit;
      cursor: pointer;
      line-height: 1;
    }
    .window-body {
      min-height: 0;
      overflow: auto;
      padding: 12px;
      flex: 1 1 auto;
    }
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
    .tabs {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 10px;
      overflow-x: auto;
    }
    .tab {
      border: 1px solid var(--line);
      background: white;
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      min-height: 32px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .tab.active {
      border-color: #0b5f59;
      background: #e8f3f1;
      color: #0b5f59;
      font-weight: 700;
    }
    .inspect-panel.hidden { display: none; }
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
    .debugger-workbench {
      display: grid;
      grid-template-columns: minmax(300px, 0.55fr) minmax(360px, 0.45fr);
      gap: 14px;
      align-items: stretch;
    }
    .debugger-side {
      display: grid;
      gap: 14px;
      align-content: start;
    }
    .debugger-source {
      min-height: 260px;
      height: 100%;
    }
    .debugger-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
    }
    .debugger-stack {
      grid-column: 1 / -1;
    }
    .debug-toolbar-group {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .source-preview {
      min-height: 96px;
      border-left: 3px solid #0f766e;
    }
    .class-browser-grid {
      display: grid;
      grid-template-columns: minmax(210px, 0.7fr) minmax(240px, 0.8fr) minmax(300px, 1.1fr);
      gap: 14px;
      align-items: start;
    }
    .class-source { grid-column: 1 / -1; }
    .class-source pre { min-height: 310px; }
    .browser-panes {
      display: grid;
      grid-template-columns: minmax(150px, 0.65fr) minmax(190px, 0.9fr) minmax(170px, 0.8fr) minmax(210px, 1fr);
      gap: 10px;
      align-items: stretch;
      margin-bottom: 14px;
    }
    .browser-list {
      max-height: 250px;
      overflow: auto;
      padding: 6px;
    }
    .browser-item {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--text);
      padding: 6px 7px;
      text-align: left;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .browser-item:hover,
    .browser-item.active {
      background: #e8f3f1;
      color: #0b5f59;
    }
    .class-detail-grid {
      display: grid;
      grid-template-columns: minmax(260px, 0.35fr) minmax(0, 0.65fr);
      gap: 14px;
      align-items: start;
    }
    .symbol-grid {
      display: grid;
      grid-template-columns: minmax(150px, 0.55fr) minmax(170px, 0.65fr) minmax(190px, 0.8fr) minmax(280px, 1fr);
      gap: 14px;
      align-items: start;
    }
    .rowline {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
    }
    .error-text { color: var(--danger); }
    @media (max-width: 820px) {
      body { overflow: auto; }
      header {
        align-items: flex-start;
        flex-wrap: wrap;
        min-height: 0;
      }
      .menubar {
        order: 3;
        flex-basis: 100%;
      }
      main {
        height: auto;
        min-height: calc(100vh - 132px);
        overflow: visible;
        padding: 10px;
      }
      .taskbar {
        position: sticky;
        min-height: 42px;
      }
      .tool-window {
        position: static;
        width: 100%;
        max-width: none;
        margin-bottom: 12px;
        resize: vertical;
      }
      .tool-window.hidden {
        display: none;
      }
      .grid, .split, .debugger-workbench, .debugger-grid, .class-browser-grid, .browser-panes, .class-detail-grid, .symbol-grid { grid-template-columns: 1fr; }
      .window-titlebar { cursor: default; }
    }
  </style>
</head>
<body>
  <header>
    <h1>GemStone Explorer</h1>
    <div class="menubar" role="menubar" aria-label="Window menu">
      <button type="button" role="menuitem" data-window-open="inspect">Inspect</button>
      <button type="button" role="menuitem" data-window-open="debugger">Debugger</button>
      <button type="button" role="menuitem" data-window-open="globals">Globals</button>
      <button type="button" role="menuitem" data-window-open="roots">Roots</button>
      <button type="button" role="menuitem" data-window-open="symbols">Symbol List</button>
      <button type="button" role="menuitem" data-window-open="workspace">Workspace</button>
      <button type="button" role="menuitem" data-window-open="classes">Classes</button>
      <button type="button" role="menuitem" data-window-open="codegen">Codegen</button>
      <button type="button" role="menuitem" data-window-open="statusLog">Status Log</button>
      <button type="button" role="menuitem" id="openAllWindows">All</button>
      <button type="button" role="menuitem" id="resetWindows">Reset</button>
    </div>
    <div class="meta">
      <span class="status" id="statusLight"></span>
      <span id="statusText">Idle</span>
      <button class="action secondary" id="refreshStatus">Status</button>
    </div>
  </header>
  <main id="desktop" aria-label="Explorer workspace">
      <section id="inspect" class="tool-window" data-window="inspect" data-default-left="16" data-default-top="16" style="--x: 16px; --y: 16px; --w: 420px;">
        <div class="window-titlebar" data-drag-handle><h2>Inspect</h2><button class="window-button" type="button" data-window-close="inspect" aria-label="Close inspect">x</button></div>
        <div class="window-body">
        <div class="toolbar">
          <label>OOP <input id="inspectOop" placeholder="123456789"></label>
          <button class="action" id="inspectRun">Inspect</button>
        </div>
        <div class="tabs" id="inspectTabs" role="tablist" aria-label="Object inspector tabs">
          <button type="button" class="tab active" data-inspect-tab="summary">Summary</button>
          <button type="button" class="tab" data-inspect-tab="slots">Slots</button>
          <button type="button" class="tab" data-inspect-tab="indexed">Indexed</button>
          <button type="button" class="tab" data-inspect-tab="raw">Raw</button>
        </div>
        <div class="surface inspect-panel" data-inspect-panel="summary"><h2>Summary</h2><pre id="inspectSummaryOutput"></pre></div>
        <div class="surface inspect-panel hidden" data-inspect-panel="slots"><h2>Slots</h2><div id="inspectSlotsTable"></div></div>
        <div class="surface inspect-panel hidden" data-inspect-panel="indexed"><h2>Indexed Fields</h2><div id="inspectIndexedTable"></div></div>
        <div class="surface inspect-panel hidden" data-inspect-panel="raw"><h2>Raw JSON</h2><pre id="inspectRawOutput"></pre></div>
        </div>
      </section>
      <section id="debugger" class="tool-window" data-window="debugger" data-default-left="456" data-default-top="16" style="--x: 456px; --y: 16px; --w: 900px;">
        <div class="window-titlebar" data-drag-handle><h2>Debugger</h2><button class="window-button" type="button" data-window-close="debugger" aria-label="Close debugger">x</button></div>
        <div class="window-body">
        <div class="toolbar">
          <label>Return <select id="debugReturn"><option>inspect</option><option>value</option><option>oop</option></select></label>
          <button class="action" id="debugRun">Debug</button>
          <span class="debug-toolbar-group" aria-label="Debugger execution controls">
            <button class="action secondary" id="debugRestart">Restart</button>
            <button class="action secondary" id="debugProceed">Proceed</button>
            <button class="action secondary" id="debugStep">Step</button>
            <button class="action secondary" id="debugStepInto">Into</button>
            <button class="action secondary" id="debugStepOver">Over</button>
            <button class="action secondary" id="debugStepReturn">Return</button>
            <button class="action secondary" id="debugTrim">Trim</button>
            <button class="action secondary" id="debugTerminate">Terminate</button>
          </span>
          <span class="debug-toolbar-group" aria-label="Debugger inspect controls">
            <button class="action secondary" id="debugInspectContext">Inspect Context</button>
            <button class="action secondary" id="debugInspectException">Inspect Exception</button>
          </span>
        </div>
        <div class="debugger-workbench">
          <textarea class="debugger-source" id="debugSource">1/0</textarea>
          <div class="debugger-side">
            <div class="surface"><h2>Summary</h2><pre id="debugSummaryOutput"></pre></div>
            <div class="surface"><h2>Source</h2><pre class="source-preview" id="debugSourcePreview"></pre></div>
          </div>
        </div>
        <div class="debugger-grid">
          <div class="surface debugger-stack"><h2>Context Stack</h2><div id="debugStackTable"></div></div>
          <div class="surface"><h2>Raw Stack</h2><pre id="debugStackOutput"></pre></div>
          <div class="surface"><h2>Objects</h2><div id="debugObjectsTable"></div></div>
          <div class="surface"><h2>Arguments</h2><div id="debugArgsTable"></div></div>
          <div class="surface"><h2>Raw Report</h2><pre id="debugOutput"></pre></div>
        </div>
        </div>
      </section>
      <section id="globals" class="tool-window" data-window="globals" data-default-left="16" data-default-top="340" style="--x: 16px; --y: 340px; --w: 650px;">
        <div class="window-titlebar" data-drag-handle><h2>Globals</h2><button class="window-button" type="button" data-window-close="globals" aria-label="Close globals">x</button></div>
        <div class="window-body">
        <div class="toolbar">
          <label>Filter <input id="globalsFilter" placeholder="election"></label>
          <label>Limit <input id="globalsLimit" type="number" min="0" max="200" value="50"></label>
          <button class="action" id="globalsRun">Load</button>
        </div>
        <div class="grid">
          <div class="surface"><h2>UserGlobals</h2><div id="globalsTable"></div></div>
          <div class="surface"><h2>Selection</h2><pre id="globalsOutput"></pre></div>
        </div>
        </div>
      </section>
      <section id="roots" class="tool-window" data-window="roots" data-default-left="696" data-default-top="340" style="--x: 696px; --y: 340px; --w: 650px;">
        <div class="window-titlebar" data-drag-handle><h2>Roots</h2><button class="window-button" type="button" data-window-close="roots" aria-label="Close roots">x</button></div>
        <div class="window-body">
        <div class="toolbar">
          <label>Root <select id="rootName"></select></label>
          <label>Filter <input id="rootsFilter" placeholder="election"></label>
          <label>Limit <input id="rootsLimit" type="number" min="0" max="200" value="50"></label>
          <button class="action" id="rootsRun">Load</button>
        </div>
        <div class="grid">
          <div class="surface"><h2>Entries</h2><div id="rootsTable"></div></div>
          <div class="surface"><h2>Selection</h2><pre id="rootsOutput"></pre></div>
        </div>
        </div>
      </section>
      <section id="symbols" class="tool-window hidden" data-window="symbols" data-default-left="120" data-default-top="250" style="--x: 120px; --y: 250px; --w: 980px;">
        <div class="window-titlebar" data-drag-handle><h2>Symbol List Browser</h2><button class="window-button" type="button" data-window-close="symbols" aria-label="Close symbol list browser">x</button></div>
        <div class="window-body">
        <div class="toolbar">
          <button class="action" id="symbolsLoadUsers">Load Users</button>
          <label>Filter Entries <input id="symbolsFilter" placeholder="Object"></label>
          <label>Limit <input id="symbolsLimit" type="number" min="0" max="200" value="50"></label>
        </div>
        <div class="symbol-grid">
          <div class="surface"><h2>Users</h2><div id="symbolUsersTable"></div></div>
          <div class="surface"><h2>Dictionaries</h2><div id="symbolDictionariesTable"></div></div>
          <div class="surface"><h2>Entries</h2><div id="symbolEntriesTable"></div></div>
          <div class="surface"><h2>Value Preview</h2><pre id="symbolPreviewOutput"></pre></div>
        </div>
        </div>
      </section>
      <section id="workspace" class="tool-window hidden" data-window="workspace" data-default-left="456" data-default-top="200" style="--x: 456px; --y: 200px; --w: 620px;">
        <div class="window-titlebar" data-drag-handle><h2>Workspace</h2><button class="window-button" type="button" data-window-close="workspace" aria-label="Close workspace">x</button></div>
        <div class="window-body">
        <div class="toolbar">
          <label>Return <select id="evalReturn"><option>value</option><option>oop</option><option>inspect</option></select></label>
          <label class="rowline"><input id="evalCommit" type="checkbox"> Commit</label>
          <button class="action" id="evalRun">Evaluate</button>
        </div>
        <div class="split">
          <textarea id="evalSource">System stoneName</textarea>
          <div class="surface"><h2>Result</h2><pre id="evalOutput"></pre></div>
        </div>
        </div>
      </section>
      <section id="classes" class="tool-window hidden" data-window="classes" data-default-left="240" data-default-top="170" style="--x: 240px; --y: 170px; --w: 1120px;">
        <div class="window-titlebar" data-drag-handle><h2>Class Browser</h2><button class="window-button" type="button" data-window-close="classes" aria-label="Close classes">x</button></div>
        <div class="window-body">
        <div class="toolbar">
          <button class="action" id="classBrowserLoad">Load Browser</button>
          <label class="rowline"><input id="classMeta" type="checkbox"> Class side</label>
          <label>Prefix <input id="classPrefix" value="Object"></label>
          <label>Limit <input id="classesLimit" type="number" min="0" max="200" value="50"></label>
          <button class="action" id="classesRun">Search</button>
          <label>Class <input id="className" value="Object"></label>
          <label>Methods <input id="classMethodLimit" type="number" min="0" max="1000" value="300"></label>
          <button class="action secondary" id="classDescribe">Describe</button>
          <button class="action secondary" id="classInspectClass">Inspect Class</button>
          <button class="action secondary" id="classInspectMethod">Inspect Method</button>
          <button class="action secondary" id="classInspectInstances">Instances</button>
          <label>File Out <select id="classFileOutMode"><option value="method">Method</option><option value="class">Class</option><option value="class-methods">Class Methods</option><option value="dictionary">Dictionary</option><option value="dictionary-methods">Dictionary Methods</option></select></label>
          <button class="action secondary" id="classFileOut">Preview</button>
        </div>
        <div class="browser-panes">
          <div class="surface"><h2>Dictionaries</h2><div class="browser-list" id="classDictionariesTable"></div></div>
          <div class="surface"><h2>Classes</h2><div class="browser-list" id="classesTable"></div></div>
          <div class="surface"><h2>Categories</h2><div class="browser-list" id="classCategoriesTable"></div></div>
          <div class="surface"><h2>Methods</h2><div class="browser-list" id="classMethodsTable"></div></div>
        </div>
        <div class="class-detail-grid">
          <div class="surface"><h2>Description / File Out</h2><pre id="classOutput"></pre></div>
          <div class="surface class-source"><h2>Source</h2><pre id="classSourceOutput"></pre></div>
        </div>
        </div>
      </section>
      <section id="codegen" class="tool-window hidden" data-window="codegen" data-default-left="320" data-default-top="250" style="--x: 320px; --y: 250px; --w: 760px;">
        <div class="window-titlebar" data-drag-handle><h2>Codegen</h2><button class="window-button" type="button" data-window-close="codegen" aria-label="Close codegen">x</button></div>
        <div class="window-body">
        <div class="toolbar">
          <button class="action" id="codegenRun">Preview</button>
        </div>
        <div class="split">
          <textarea id="codegenManifest">${manifest}</textarea>
          <div class="surface"><h2>Generated Module</h2><pre id="codegenOutput"></pre></div>
        </div>
        </div>
      </section>
      <section id="statusLog" class="tool-window hidden" data-window="statusLog" data-default-left="780" data-default-top="120" style="--x: 780px; --y: 120px; --w: 560px;">
        <div class="window-titlebar" data-drag-handle><h2>Status Log</h2><button class="window-button" type="button" data-window-close="statusLog" aria-label="Close status log">x</button></div>
        <div class="window-body">
        <div class="toolbar">
          <button class="action secondary" id="statusLogClear">Clear</button>
        </div>
        <div class="surface"><h2>Recent Activity</h2><pre id="statusLogOutput"></pre></div>
        </div>
      </section>
  </main>
  <div class="taskbar" id="taskbar" aria-label="Open windows"></div>
  <script>
    const state = {
      roots: [],
      statusHistory: [],
      lastInspection: null,
      inspectTab: "summary",
      symbolUser: "",
      symbolDictionary: "",
      lastDebug: null,
      classBrowser: {
        dictionary: "",
        className: "Object",
        category: "-- all --",
        method: "",
        meta: false,
      },
    };
    const out = (id, value) => {
      const element = document.getElementById(id);
      if (!element) return;
      element.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    };
    const api = async (path, options = {}) => {
      const startedAt = performance.now();
      try {
        const response = await fetch(path, {
          ...options,
          headers: { "content-type": "application/json", ...(options.headers || {}) },
        });
        const body = await response.json();
        if (!response.ok || body.error) throw Object.assign(new Error(body.error || response.statusText), { body });
        recordStatus({ ok: true, path, elapsedMs: Math.round(performance.now() - startedAt) });
        return body;
      } catch (error) {
        recordStatus({
          ok: false,
          path,
          elapsedMs: Math.round(performance.now() - startedAt),
          message: error && error.message ? error.message : String(error),
        });
        throw error;
      }
    };
    const setStatus = (ok, text) => {
      document.getElementById("statusLight").className = "status " + (ok ? "ok" : "error");
      document.getElementById("statusText").textContent = text;
    };
    const table = (target, rows, columns) => {
      const element = document.getElementById(target);
      if (!element) return;
      if (!rows || rows.length === 0) {
        element.innerHTML = "<div style=\\"padding:12px;color:var(--muted)\\">No rows</div>";
        return;
      }
      const html = [
        "<table><thead><tr>",
        ...columns.map((column) => "<th>" + column.label + "</th>"),
        "</tr></thead><tbody>",
        ...rows.map((row) => "<tr>" + columns.map((column) => "<td>" + column.render(row) + "</td>").join("") + "</tr>"),
        "</tbody></table>",
      ].join("");
      element.innerHTML = html;
    };
    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const inspectLink = (oop) => "<button data-oop=\\"" + escapeHtml(oop) + "\\">" + escapeHtml(oop) + "</button>";
    const renderBrowserList = (target, items, active, dataName) => {
      const element = document.getElementById(target);
      if (!element) return;
      if (!items || !items.length) {
        element.innerHTML = "<div style=\\"padding:8px;color:var(--muted)\\">(empty)</div>";
        return;
      }
      element.innerHTML = items.map((item) => {
        const activeClass = item === active ? " active" : "";
        return "<button type=\\"button\\" class=\\"browser-item" + activeClass + "\\" " + dataName + "=\\"" + escapeHtml(item) + "\\" title=\\"" + escapeHtml(item) + "\\">" + escapeHtml(item) + "</button>";
      }).join("");
    };

    const desktop = document.getElementById("desktop");
    const taskbar = document.getElementById("taskbar");
    const layoutStorageKey = "gemstone-js-explorer-layout-v2";
    const defaultVisibleWindows = new Set(["inspect", "debugger", "globals", "roots"]);
    const windowLabels = {
      inspect: "Inspect",
      debugger: "Debugger",
      globals: "Globals",
      roots: "Roots",
      symbols: "Symbol List",
      workspace: "Workspace",
      classes: "Classes",
      codegen: "Codegen",
      statusLog: "Status Log",
    };
    let nextWindowZ = 20;
    let layoutReady = false;
    const toolWindow = (name) => document.querySelector(".tool-window[data-window='" + name + "']");
    const focusWindow = (name) => {
      const win = toolWindow(name);
      if (!win) return;
      win.classList.remove("hidden");
      document.querySelectorAll(".tool-window").forEach((item) => item.dataset.active = "false");
      win.dataset.active = "true";
      win.style.zIndex = String(++nextWindowZ);
      afterWindowMutation();
    };
    const closeWindow = (name) => {
      const win = toolWindow(name);
      if (!win) return;
      win.classList.add("hidden");
      win.dataset.active = "false";
      afterWindowMutation();
    };
    const resetWindows = () => {
      try { localStorage.removeItem(layoutStorageKey); } catch (_error) {}
      document.querySelectorAll(".tool-window").forEach((win) => {
        const name = win.dataset.window;
        win.style.left = (win.dataset.defaultLeft || "16") + "px";
        win.style.top = (win.dataset.defaultTop || "16") + "px";
        win.style.removeProperty("width");
        win.style.removeProperty("height");
        win.style.removeProperty("z-index");
        win.dataset.active = "false";
        win.classList.toggle("hidden", !defaultVisibleWindows.has(name));
      });
      nextWindowZ = 20;
      focusWindow("inspect");
    };
    const openAllWindows = () => {
      document.querySelectorAll(".tool-window").forEach((win) => focusWindow(win.dataset.window));
    };
    const afterWindowMutation = () => {
      renderTaskbar();
      saveWindowLayout();
    };
    const renderTaskbar = () => {
      const visible = Array.from(document.querySelectorAll(".tool-window"))
        .filter((win) => !win.classList.contains("hidden"))
        .sort((left, right) => Number(left.style.zIndex || 0) - Number(right.style.zIndex || 0));
      if (!visible.length) {
        taskbar.innerHTML = "<span style=\\"color:var(--muted);padding:0 8px\\">No open windows</span>";
        return;
      }
      taskbar.innerHTML = visible.map((win) => {
        const name = win.dataset.window;
        const active = win.dataset.active === "true" ? " active" : "";
        return "<button type=\\"button\\" class=\\"taskbar-button" + active + "\\" data-taskbar-window=\\"" + escapeHtml(name) + "\\">" + escapeHtml(windowLabels[name] || name) + "</button>";
      }).join("");
    };
    const saveWindowLayout = () => {
      if (!layoutReady) return;
      const windows = {};
      document.querySelectorAll(".tool-window").forEach((win) => {
        const name = win.dataset.window;
        if (!name) return;
        windows[name] = {
          open: !win.classList.contains("hidden"),
          active: win.dataset.active === "true",
          left: Math.round(win.offsetLeft),
          top: Math.round(win.offsetTop),
          width: Math.round(win.offsetWidth),
          height: Math.round(win.offsetHeight),
          zIndex: Number(win.style.zIndex || 0),
        };
      });
      try {
        localStorage.setItem(layoutStorageKey, JSON.stringify({ windows, nextWindowZ }));
      } catch (_error) {}
    };
    const restoreWindowLayout = () => {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(layoutStorageKey) || "null"); } catch (_error) {}
      if (!saved || !saved.windows || typeof saved.windows !== "object") return false;
      let hasActive = false;
      let highestZ = 20;
      document.querySelectorAll(".tool-window").forEach((win) => {
        const name = win.dataset.window;
        const entry = saved.windows[name];
        if (!entry) return;
        if (Number.isFinite(entry.left)) win.style.left = Math.max(0, Math.round(entry.left)) + "px";
        if (Number.isFinite(entry.top)) win.style.top = Math.max(0, Math.round(entry.top)) + "px";
        if (Number.isFinite(entry.width)) win.style.width = Math.max(320, Math.round(entry.width)) + "px";
        if (Number.isFinite(entry.height)) win.style.height = Math.max(180, Math.round(entry.height)) + "px";
        win.classList.toggle("hidden", !entry.open);
        win.dataset.active = entry.active && entry.open ? "true" : "false";
        if (entry.active && entry.open) hasActive = true;
        if (Number.isFinite(entry.zIndex) && entry.zIndex > 0) {
          win.style.zIndex = String(Math.round(entry.zIndex));
          highestZ = Math.max(highestZ, Number(entry.zIndex));
        }
      });
      if (!hasActive) {
        const firstOpen = document.querySelector(".tool-window:not(.hidden)");
        if (firstOpen) firstOpen.dataset.active = "true";
      }
      nextWindowZ = Math.max(highestZ, Number(saved.nextWindowZ || 20));
      renderTaskbar();
      return true;
    };
    const setupFloatingWindows = () => {
      document.querySelectorAll("[data-window-open]").forEach((button) => {
        button.addEventListener("click", () => {
          focusWindow(button.dataset.windowOpen);
          if (button.dataset.windowOpen === "classes" && !state.classBrowser.dictionary) {
            void loadClassBrowserDictionaries();
          }
        });
      });
      document.querySelectorAll("[data-window-close]").forEach((button) => {
        button.addEventListener("click", () => closeWindow(button.dataset.windowClose));
      });
      document.getElementById("openAllWindows").addEventListener("click", openAllWindows);
      document.getElementById("resetWindows").addEventListener("click", resetWindows);
      taskbar.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.dataset.taskbarWindow) focusWindow(target.dataset.taskbarWindow);
      });
      document.querySelectorAll(".tool-window").forEach((win) => {
        win.addEventListener("pointerdown", () => focusWindow(win.dataset.window));
        win.addEventListener("pointerup", () => saveWindowLayout());
        const handle = win.querySelector("[data-drag-handle]");
        handle.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || event.target.closest("button") || window.matchMedia("(max-width: 820px)").matches) return;
          event.preventDefault();
          focusWindow(win.dataset.window);
          const pointerId = event.pointerId;
          const startLeft = win.offsetLeft;
          const startTop = win.offsetTop;
          const startX = event.clientX;
          const startY = event.clientY;
          const move = (next) => {
            const maxLeft = Math.max(8, desktop.clientWidth - 80);
            const maxTop = Math.max(8, desktop.clientHeight - 48);
            const left = Math.max(8, Math.min(maxLeft, startLeft + next.clientX - startX));
            const top = Math.max(8, Math.min(maxTop, startTop + next.clientY - startY));
            win.style.left = left + "px";
            win.style.top = top + "px";
          };
          const done = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", done);
            handle.removeEventListener("lostpointercapture", done);
            afterWindowMutation();
          };
          handle.setPointerCapture(pointerId);
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", done);
          handle.addEventListener("lostpointercapture", done);
        });
      });
      layoutReady = true;
      if (!restoreWindowLayout()) resetWindows();
    };
    document.body.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const selectedOop = target.dataset.oop;
      const selectedClass = target.dataset.className;
      const selectedMethod = target.dataset.methodSelector;
      const selectedUser = target.dataset.symbolUser;
      const selectedDictionary = target.dataset.symbolDictionary;
      const selectedEntry = target.dataset.symbolEntry;
      const classBrowserDictionary = target.dataset.classBrowserDictionary;
      const classBrowserClass = target.dataset.classBrowserClass;
      const classBrowserCategory = target.dataset.classBrowserCategory;
      const classBrowserMethod = target.dataset.classBrowserMethod;
      const inspectTab = target.dataset.inspectTab;
      if (inspectTab) {
        selectInspectTab(inspectTab);
        return;
      }
      if (classBrowserDictionary) {
        await selectClassBrowserDictionary(classBrowserDictionary);
        return;
      }
      if (classBrowserClass) {
        await selectClassBrowserClass(classBrowserClass);
        return;
      }
      if (classBrowserCategory) {
        await selectClassBrowserCategory(classBrowserCategory);
        return;
      }
      if (classBrowserMethod) {
        await selectClassBrowserMethod(classBrowserMethod);
        return;
      }
      if (selectedOop) {
        document.getElementById("inspectOop").value = selectedOop;
        focusWindow("inspect");
        await runInspect();
      }
      if (selectedClass) {
        document.getElementById("className").value = selectedClass;
        focusWindow("classes");
        await describeClass();
      }
      if (selectedMethod) {
        await loadMethodSource(target.dataset.methodSide, selectedMethod);
      }
      if (selectedUser) {
        await loadSymbolDictionaries(selectedUser);
      }
      if (selectedDictionary) {
        await loadSymbolEntries(selectedDictionary);
      }
      if (selectedEntry) {
        await previewSymbolEntry(selectedEntry);
      }
    });

    async function loadConfig() {
      const config = await api("/api/config");
      state.roots = config.roots;
      document.getElementById("rootName").innerHTML = config.roots.map((name) => "<option>" + escapeHtml(name) + "</option>").join("");
    }
    function recordStatus(entry) {
      state.statusHistory.unshift({
        time: new Date().toISOString(),
        ok: !!entry.ok,
        path: entry.path || "",
        elapsedMs: entry.elapsedMs || 0,
        message: entry.message || "",
      });
      state.statusHistory = state.statusHistory.slice(0, 120);
      renderStatusLog();
    }
    function renderStatusLog() {
      if (!document.getElementById("statusLogOutput")) return;
      const lines = state.statusHistory.map((entry) => {
        return entry.time + " " + (entry.ok ? "OK " : "ERR") + " " + entry.path + " " + entry.elapsedMs + "ms" + (entry.message ? " " + entry.message : "");
      });
      out("statusLogOutput", lines.join("\\n") || "No recent activity.");
    }
    function selectInspectTab(name) {
      state.inspectTab = name;
      document.querySelectorAll("[data-inspect-tab]").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.inspectTab === name);
      });
      document.querySelectorAll("[data-inspect-panel]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.inspectPanel !== name);
      });
    }
    function clearInspect() {
      out("inspectSummaryOutput", "");
      table("inspectSlotsTable", [], []);
      table("inspectIndexedTable", [], []);
      out("inspectRawOutput", "");
    }
    function inspectionOop(value) {
      return value && (value.oopString || value.oop) ? String(value.oopString || value.oop) : "";
    }
    function renderInspection(value) {
      const inspection = value && value.inspection && value.inspection.printString ? value.inspection : value;
      state.lastInspection = inspection;
      const hierarchy = Array.isArray(inspection.classHierarchy) ? inspection.classHierarchy.join(" > ") : "";
      const summary = [
        "oop: " + inspectionOop(inspection),
        "class: " + (inspection.class || ""),
        "class oop: " + (inspection.classOop || ""),
        "printString: " + (inspection.printString || ""),
        "size: " + (inspection.size === undefined ? "" : inspection.size),
        "byte size: " + (inspection.byteSize === undefined ? "" : inspection.byteSize),
        "hierarchy: " + hierarchy,
      ].join("\\n");
      out("inspectSummaryOutput", summary);
      table("inspectSlotsTable", Array.isArray(inspection.slots) ? inspection.slots : [], [
        { label: "Slot", render: (row) => escapeHtml(row.name || "") },
        { label: "Class", render: (row) => escapeHtml(row.class || "") },
        { label: "OOP", render: (row) => inspectionOop(row) ? inspectLink(inspectionOop(row)) : "" },
        { label: "Value", render: (row) => escapeHtml(row.value || "") },
      ]);
      table("inspectIndexedTable", Array.isArray(inspection.indexedFields) ? inspection.indexedFields : [], [
        { label: "Index", render: (row) => escapeHtml(row.index) },
        { label: "Class", render: (row) => escapeHtml(row.class || "") },
        { label: "OOP", render: (row) => inspectionOop(row) ? inspectLink(inspectionOop(row)) : "" },
        { label: "Value", render: (row) => escapeHtml(row.value || "") },
      ]);
      out("inspectRawOutput", inspection);
      selectInspectTab(state.inspectTab || "summary");
    }
    async function refreshStatus() {
      try {
        const status = await api("/api/status");
        setStatus(true, status.stone ? "Connected: " + status.stone : "Connected");
      } catch (error) {
        setStatus(false, error.message);
      }
    }
    async function runInspect() {
      try {
        renderInspection(await api("/api/inspect?oop=" + encodeURIComponent(document.getElementById("inspectOop").value)));
      } catch (error) {
        clearInspect();
        out("inspectRawOutput", error.body || error.message);
        selectInspectTab("raw");
      }
    }
    async function loadGlobals() {
      const limit = document.getElementById("globalsLimit").value;
      const filter = document.getElementById("globalsFilter").value;
      try {
        const result = await api("/api/globals?limit=" + encodeURIComponent(limit) + "&filter=" + encodeURIComponent(filter));
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
      const filter = document.getElementById("rootsFilter").value;
      try {
        const result = await api("/api/roots?root=" + encodeURIComponent(root) + "&limit=" + encodeURIComponent(limit) + "&filter=" + encodeURIComponent(filter));
        table("rootsTable", result.entries, [
          { label: "Name", render: (row) => escapeHtml(row.name) },
          { label: "OOP", render: (row) => inspectLink(row.oop) },
        ]);
        out("rootsOutput", result);
      } catch (error) {
        out("rootsOutput", error.body || error.message);
      }
    }
    async function loadSymbolUsers() {
      try {
        const result = await api("/api/symbol-list/users");
        table("symbolUsersTable", result.users.map((name) => ({ name })), [
          { label: "User", render: (row) => "<button data-symbol-user=\\"" + escapeHtml(row.name) + "\\">" + escapeHtml(row.name) + "</button>" },
        ]);
        out("symbolPreviewOutput", result);
        if (result.users.length) await loadSymbolDictionaries(result.users[0]);
      } catch (error) {
        out("symbolPreviewOutput", error.body || error.message);
      }
    }
    async function loadSymbolDictionaries(user) {
      state.symbolUser = user;
      state.symbolDictionary = "";
      try {
        const result = await api("/api/symbol-list/dictionaries?user=" + encodeURIComponent(user));
        table("symbolDictionariesTable", result.dictionaries.map((name) => ({ name })), [
          { label: "Dictionary", render: (row) => "<button data-symbol-dictionary=\\"" + escapeHtml(row.name) + "\\">" + escapeHtml(row.name) + "</button>" },
        ]);
        table("symbolEntriesTable", [], []);
        out("symbolPreviewOutput", result);
        if (result.dictionaries.length) await loadSymbolEntries(result.dictionaries[0]);
      } catch (error) {
        out("symbolPreviewOutput", error.body || error.message);
      }
    }
    async function loadSymbolEntries(dictionary) {
      state.symbolDictionary = dictionary;
      const limit = document.getElementById("symbolsLimit").value;
      const filter = document.getElementById("symbolsFilter").value;
      try {
        const result = await api("/api/symbol-list/entries?user=" + encodeURIComponent(state.symbolUser) + "&dictionary=" + encodeURIComponent(dictionary) + "&limit=" + encodeURIComponent(limit) + "&filter=" + encodeURIComponent(filter));
        table("symbolEntriesTable", result.entries.map((name) => ({ name })), [
          { label: "Entry", render: (row) => "<button data-symbol-entry=\\"" + escapeHtml(row.name) + "\\">" + escapeHtml(row.name) + "</button>" },
        ]);
        out("symbolPreviewOutput", result);
      } catch (error) {
        out("symbolPreviewOutput", error.body || error.message);
      }
    }
    async function previewSymbolEntry(key) {
      try {
        const result = await api("/api/symbol-list/preview?user=" + encodeURIComponent(state.symbolUser) + "&dictionary=" + encodeURIComponent(state.symbolDictionary) + "&key=" + encodeURIComponent(key));
        out("symbolPreviewOutput", result);
        if (result.inspection) renderInspection(result.inspection);
      } catch (error) {
        out("symbolPreviewOutput", error.body || error.message);
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
    async function runDebug() {
      try {
        const result = await api("/api/debug", {
          method: "POST",
          body: JSON.stringify({
            source: document.getElementById("debugSource").value,
            returnKind: document.getElementById("debugReturn").value,
          }),
        });
        renderDebugReport(result);
      } catch (error) {
        out("debugOutput", error.body || error.message);
      }
    }
    function renderDebugReport(result) {
      state.lastDebug = result;
      out("debugOutput", result);
      const source = result.source || document.getElementById("debugSource").value;
      out("debugSourcePreview", String(source || "").split("\\n").map((line, index) => (index === 0 ? ">> " : "   ") + line).join("\\n"));
      if (result.ok) {
        const inspection = result.result && result.result.printString ? result.result : null;
        out("debugSummaryOutput", [
          "status: ok",
          "elapsed: " + result.elapsedMs + "ms",
          "return: " + result.returnKind,
          "result oop: " + (result.resultOop || ""),
          inspection ? "result class: " + inspection.class : "",
          inspection ? "result: " + inspection.printString : "",
        ].filter(Boolean).join("\\n"));
        out("debugStackOutput", "");
        table("debugStackTable", [], []);
        table("debugObjectsTable", result.resultOop ? [{ role: "result", oop: result.resultOop, inspection }] : [], [
          { label: "Role", render: (row) => escapeHtml(row.role) },
          { label: "OOP", render: (row) => inspectLink(row.oop) },
          { label: "Class", render: (row) => escapeHtml(row.inspection?.class || "") },
          { label: "Print", render: (row) => escapeHtml(row.inspection?.printString || "") },
        ]);
        table("debugArgsTable", [], []);
        return;
      }
      const problem = result.problem || {};
      out("debugSummaryOutput", [
        "status: halted",
        "elapsed: " + result.elapsedMs + "ms",
        "name: " + (problem.name || ""),
        "message: " + (problem.message || ""),
        "number: " + (problem.number === undefined ? "" : problem.number),
        "fatal: " + (problem.fatal === undefined ? "" : problem.fatal),
        "reason: " + (problem.reason || ""),
        "context oop: " + (problem.contextOop || ""),
        "exception oop: " + (problem.exceptionOop || ""),
      ].join("\\n"));
      out("debugStackOutput", problem.stack || "");
      table("debugStackTable", parseContextStack(problem.stack), [
        { label: "#", render: (row) => escapeHtml(row.index) },
        { label: "Receiver / Class", render: (row) => escapeHtml(row.receiver) },
        { label: "Selector", render: (row) => escapeHtml(row.selector) },
        { label: "Step", render: (row) => escapeHtml(row.step) },
        { label: "Line", render: (row) => escapeHtml(row.line) },
        { label: "Frame", render: (row) => escapeHtml(row.text) },
      ]);
      const inspections = problem.inspections || {};
      const objectRows = ["context", "exception"].map((role) => {
        const entry = inspections[role] || {};
        return {
          role,
          oop: entry.oop || (role === "context" ? problem.contextOop : problem.exceptionOop) || "",
          inspection: entry.inspection || null,
        };
      }).filter((row) => row.oop);
      table("debugObjectsTable", objectRows, [
        { label: "Role", render: (row) => escapeHtml(row.role) },
        { label: "OOP", render: (row) => inspectLink(row.oop) },
        { label: "Class", render: (row) => escapeHtml(row.inspection?.class || "") },
        { label: "Print", render: (row) => escapeHtml(row.inspection?.printString || "") },
      ]);
      const argRows = Array.isArray(inspections.args) ? inspections.args.map((entry, index) => ({
        index,
        oop: entry.oop || "",
        inspection: entry.inspection || null,
      })) : [];
      table("debugArgsTable", argRows, [
        { label: "#", render: (row) => escapeHtml(row.index) },
        { label: "OOP", render: (row) => row.oop ? inspectLink(row.oop) : "" },
        { label: "Class", render: (row) => escapeHtml(row.inspection?.class || "") },
        { label: "Print", render: (row) => escapeHtml(row.inspection?.printString || "") },
      ]);
    }
    async function inspectDebugTarget(kind) {
      const problem = state.lastDebug?.problem || {};
      const value = kind === "context" ? problem.contextOop : problem.exceptionOop;
      if (!value) return;
      document.getElementById("inspectOop").value = value;
      focusWindow("inspect");
      await runInspect();
    }
    function parseContextStack(stack) {
      const lines = String(stack || "")
        .split("\\n")
        .map((line) => line.trim())
        .filter((line) => line && line !== ")" && !line.startsWith("GsProcess("));
      return lines.map((line, index) => {
        const match = line.match(/^(.*?)\\s*>>\\s*(.*?)\\s*@([0-9]+)\\s+line\\s+([0-9]+)/);
        return {
          index,
          text: line,
          receiver: match ? match[1].trim() : "",
          selector: match ? match[2].trim() : line,
          step: match ? match[3] : "",
          line: match ? match[4] : "",
        };
      });
    }
    function clearDebugReport(message) {
      state.lastDebug = null;
      out("debugSummaryOutput", message || "");
      out("debugSourcePreview", "");
      out("debugStackOutput", "");
      out("debugOutput", "");
      table("debugStackTable", [], []);
      table("debugObjectsTable", [], []);
      table("debugArgsTable", [], []);
    }
    function unsupportedDebugAction(action) {
      const message = action + " needs a persistent GemStone debug process. The current JS explorer captures a halted report, aborts the session, and logs out after each debug run.";
      out("debugSummaryOutput", message);
      setStatus(false, message);
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
        const result = await api("/api/class?name=" + encodeURIComponent(name) + "&methodLimit=" + encodeURIComponent(methodLimit));
        out("classOutput", result.description);
        table("classMethodsTable", result.methods, [
          { label: "Side", render: (row) => escapeHtml(row.side) },
          { label: "Selector", render: (row) => "<button data-method-side=\\"" + escapeHtml(row.side) + "\\" data-method-selector=\\"" + escapeHtml(row.selector) + "\\">" + escapeHtml(row.selector) + "</button>" },
        ]);
        out("classSourceOutput", result.methodsTruncated ? "Select a method. Method list is truncated by the current limit." : "Select a method.");
      } catch (error) {
        out("classOutput", error.body || error.message);
      }
    }
    async function loadMethodSource(side, selector) {
      try {
        const name = document.getElementById("className").value;
        const result = await api("/api/method-source?class=" + encodeURIComponent(name) + "&side=" + encodeURIComponent(side || "instance") + "&selector=" + encodeURIComponent(selector));
        out("classSourceOutput", result.source || "(source unavailable)");
      } catch (error) {
        out("classSourceOutput", error.body || error.message);
      }
    }
    async function loadClassBrowserDictionaries() {
      try {
        const result = await api("/api/class-browser/dictionaries");
        state.classBrowser.dictionaries = result.dictionaries;
        renderBrowserList("classDictionariesTable", result.dictionaries, state.classBrowser.dictionary, "data-class-browser-dictionary");
        const preferred = state.classBrowser.dictionary || (result.dictionaries.includes("Globals") ? "Globals" : result.dictionaries[0]);
        if (preferred) await selectClassBrowserDictionary(preferred);
      } catch (error) {
        out("classOutput", error.body || error.message);
      }
    }
    async function selectClassBrowserDictionary(dictionary) {
      state.classBrowser.dictionary = dictionary;
      state.classBrowser.className = "";
      state.classBrowser.category = "-- all --";
      state.classBrowser.method = "";
      renderBrowserList("classDictionariesTable", state.classBrowser.dictionaries || [dictionary], dictionary, "data-class-browser-dictionary");
      table("classMethodsTable", [], []);
      out("classSourceOutput", "");
      try {
        const result = await api("/api/class-browser/classes?dictionary=" + encodeURIComponent(dictionary));
        state.classBrowser.classes = result.classes;
        const preferred = result.classes.includes(document.getElementById("className").value)
          ? document.getElementById("className").value
          : (result.classes.includes("Object") ? "Object" : result.classes[0]);
        renderBrowserList("classesTable", result.classes, preferred || "", "data-class-browser-class");
        if (preferred) await selectClassBrowserClass(preferred);
      } catch (error) {
        out("classOutput", error.body || error.message);
      }
    }
    async function selectClassBrowserClass(className) {
      state.classBrowser.className = className;
      state.classBrowser.category = "-- all --";
      state.classBrowser.method = "";
      document.getElementById("className").value = className;
      renderBrowserList("classesTable", state.classBrowser.classes || [className], className, "data-class-browser-class");
      try {
        const methodLimit = document.getElementById("classMethodLimit").value;
        const description = await api("/api/class?name=" + encodeURIComponent(className) + "&methodLimit=" + encodeURIComponent(methodLimit)).catch(() => null);
        if (description) out("classOutput", description.description);
        await loadClassBrowserCategories();
        await loadClassBrowserSource("");
      } catch (error) {
        out("classOutput", error.body || error.message);
      }
    }
    async function loadClassBrowserCategories() {
      const browser = state.classBrowser;
      if (!browser.dictionary || !browser.className) return;
      browser.meta = document.getElementById("classMeta").checked;
      const result = await api("/api/class-browser/categories?dictionary=" + encodeURIComponent(browser.dictionary) + "&class=" + encodeURIComponent(browser.className) + "&meta=" + (browser.meta ? "1" : "0"));
      browser.categories = result.categories;
      const preferred = result.categories.includes(browser.category) ? browser.category : "-- all --";
      renderBrowserList("classCategoriesTable", result.categories, preferred, "data-class-browser-category");
      await selectClassBrowserCategory(preferred);
    }
    async function selectClassBrowserCategory(category) {
      state.classBrowser.category = category || "-- all --";
      state.classBrowser.method = "";
      renderBrowserList("classCategoriesTable", state.classBrowser.categories || [state.classBrowser.category], state.classBrowser.category, "data-class-browser-category");
      await loadClassBrowserMethods();
    }
    async function loadClassBrowserMethods() {
      const browser = state.classBrowser;
      if (!browser.dictionary || !browser.className) return;
      const result = await api("/api/class-browser/methods?dictionary=" + encodeURIComponent(browser.dictionary) + "&class=" + encodeURIComponent(browser.className) + "&protocol=" + encodeURIComponent(browser.category || "-- all --") + "&meta=" + (browser.meta ? "1" : "0"));
      browser.methods = result.methods;
      renderBrowserList("classMethodsTable", result.methods, browser.method, "data-class-browser-method");
    }
    async function selectClassBrowserMethod(selector) {
      state.classBrowser.method = selector;
      renderBrowserList("classMethodsTable", state.classBrowser.methods || [selector], selector, "data-class-browser-method");
      await loadClassBrowserSource(selector);
    }
    async function loadClassBrowserSource(selector) {
      const browser = state.classBrowser;
      if (!browser.dictionary || !browser.className) return;
      try {
        const result = await api("/api/class-browser/source?dictionary=" + encodeURIComponent(browser.dictionary) + "&class=" + encodeURIComponent(browser.className) + "&selector=" + encodeURIComponent(selector || "") + "&meta=" + (browser.meta ? "1" : "0"));
        out("classSourceOutput", result.source || (selector ? "(source unavailable)" : "(definition unavailable)"));
      } catch (error) {
        out("classSourceOutput", error.body || error.message);
      }
    }
    async function inspectClassBrowserTarget(mode) {
      const browser = state.classBrowser;
      if (mode === "method" && !browser.method) return;
      try {
        const result = await api("/api/class-browser/inspect-target?mode=" + encodeURIComponent(mode) + "&dictionary=" + encodeURIComponent(browser.dictionary) + "&class=" + encodeURIComponent(browser.className) + "&selector=" + encodeURIComponent(browser.method) + "&meta=" + (browser.meta ? "1" : "0"));
        document.getElementById("inspectOop").value = result.oop;
        renderInspection(result.inspection);
        focusWindow("inspect");
      } catch (error) {
        out("classOutput", error.body || error.message);
      }
    }
    async function fileOutClassBrowser() {
      const browser = state.classBrowser;
      const mode = document.getElementById("classFileOutMode").value;
      try {
        const result = await api("/api/class-browser/file-out?mode=" + encodeURIComponent(mode) + "&dictionary=" + encodeURIComponent(browser.dictionary) + "&class=" + encodeURIComponent(browser.className) + "&selector=" + encodeURIComponent(browser.method) + "&meta=" + (browser.meta ? "1" : "0"));
        out("classOutput", "filename: " + result.filename + "\\n\\n" + result.source);
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
    document.getElementById("symbolsLoadUsers").addEventListener("click", loadSymbolUsers);
    document.getElementById("symbolsFilter").addEventListener("change", () => {
      if (state.symbolDictionary) void loadSymbolEntries(state.symbolDictionary);
    });
    document.getElementById("statusLogClear").addEventListener("click", () => {
      state.statusHistory = [];
      renderStatusLog();
    });
    document.getElementById("evalRun").addEventListener("click", runEval);
    document.getElementById("debugRun").addEventListener("click", runDebug);
    document.getElementById("debugRestart").addEventListener("click", runDebug);
    document.getElementById("debugProceed").addEventListener("click", () => unsupportedDebugAction("Proceed"));
    document.getElementById("debugStep").addEventListener("click", () => unsupportedDebugAction("Step"));
    document.getElementById("debugStepInto").addEventListener("click", () => unsupportedDebugAction("Step Into"));
    document.getElementById("debugStepOver").addEventListener("click", () => unsupportedDebugAction("Step Over"));
    document.getElementById("debugStepReturn").addEventListener("click", () => unsupportedDebugAction("Step Return"));
    document.getElementById("debugTrim").addEventListener("click", () => unsupportedDebugAction("Trim"));
    document.getElementById("debugTerminate").addEventListener("click", () => clearDebugReport("Terminated local debug report. No GemStone process is retained by the current stateless debugger."));
    document.getElementById("debugInspectContext").addEventListener("click", () => inspectDebugTarget("context"));
    document.getElementById("debugInspectException").addEventListener("click", () => inspectDebugTarget("exception"));
    document.getElementById("classBrowserLoad").addEventListener("click", loadClassBrowserDictionaries);
    document.getElementById("classMeta").addEventListener("change", () => {
      if (state.classBrowser.className) void loadClassBrowserCategories();
    });
    document.getElementById("classInspectClass").addEventListener("click", () => inspectClassBrowserTarget("class"));
    document.getElementById("classInspectMethod").addEventListener("click", () => inspectClassBrowserTarget("method"));
    document.getElementById("classInspectInstances").addEventListener("click", () => inspectClassBrowserTarget("instances"));
    document.getElementById("classFileOut").addEventListener("click", fileOutClassBrowser);
    document.getElementById("classesRun").addEventListener("click", searchClasses);
    document.getElementById("classDescribe").addEventListener("click", describeClass);
    document.getElementById("codegenRun").addEventListener("click", previewCodegen);

    setupFloatingWindows();
    loadConfig().then(refreshStatus).catch((error) => setStatus(false, error.message));
  </script>
</body>
</html>`;
}
