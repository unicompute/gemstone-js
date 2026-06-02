import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { GStore, Session, type GStoreJsonValue } from "gemstone-js";

type BookStatus = "available" | "borrowed";

interface LibraryBook {
  id: string;
  title: string;
  author: string;
  status: BookStatus;
  borrower: string;
  updatedAt: string;
}

interface LibraryDocument {
  version: number;
  books: LibraryBook[];
}

const STORE_NAME = "ExampleLibraryBooks";
const DOCUMENT_KEY = "library";
const clients = new Set<ServerResponse>();

const server = createServer((request, response) => {
  void route(request, response).catch((error) => writeError(response, error));
});

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3027);
server.listen(port, host, () => {
  console.log(`Library books example listening on http://${host}:${port}`);
});

process.once("SIGINT", () => shutdown());
process.once("SIGTERM", () => shutdown());

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = requestUrl(request);

  if (request.method === "GET" && url.pathname === "/") {
    writeHtml(response, libraryHtml());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/books") {
    writeJson(response, 200, await readLibrary());
    return;
  }

  if (request.method === "GET" && url.pathname === "/events") {
    await openEvents(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reset") {
    const snapshot = await resetLibrary();
    broadcast(snapshot);
    writeJson(response, 200, snapshot);
    return;
  }

  const borrowMatch = url.pathname.match(/^\/api\/books\/([^/]+)\/borrow$/);
  if (request.method === "POST" && borrowMatch) {
    const body = await readJsonBody(request);
    const snapshot = await updateBookStatus(decodeURIComponent(borrowMatch[1]), "borrowed", stringField(body, "borrower") || "Patron");
    broadcast(snapshot);
    writeJson(response, 200, snapshot);
    return;
  }

  const returnMatch = url.pathname.match(/^\/api\/books\/([^/]+)\/return$/);
  if (request.method === "POST" && returnMatch) {
    const snapshot = await updateBookStatus(decodeURIComponent(returnMatch[1]), "available", "");
    broadcast(snapshot);
    writeJson(response, 200, snapshot);
    return;
  }

  writeJson(response, 404, { error: "not found" });
}

async function readLibrary(): Promise<LibraryDocument> {
  return withLibraryStore(async (store) => {
    const document = await store.transaction((transaction) => {
      if (transaction.has(DOCUMENT_KEY)) return fromJsonValue(transaction.get(DOCUMENT_KEY));
      const seeded = seedLibrary();
      transaction.set(DOCUMENT_KEY, toJsonValue(seeded));
      return seeded;
    });
    return requireLibraryDocument(document, "Read library");
  });
}

async function resetLibrary(): Promise<LibraryDocument> {
  const next = seedLibrary();
  return withLibraryStore(async (store) => {
    await store.transaction((transaction) => {
      transaction.set(DOCUMENT_KEY, toJsonValue(next));
    });
    return next;
  });
}

async function updateBookStatus(id: string, status: BookStatus, borrower: string): Promise<LibraryDocument> {
  return withLibraryStore(async (store) => {
    const document = await store.transaction((transaction) => {
      const document = fromJsonValue(transaction.get(DOCUMENT_KEY));
      const book = document.books.find((candidate) => candidate.id === id);
      if (!book) throw new HttpError(404, `Unknown book: ${id}`);
      if (status === "borrowed" && book.status === "borrowed") {
        throw new HttpError(409, `${book.title} is already borrowed by ${book.borrower || "another patron"}.`);
      }
      if (status === "available" && book.status === "available") {
        throw new HttpError(409, `${book.title} is already available.`);
      }

      const next: LibraryDocument = {
        version: document.version + 1,
        books: document.books.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                status,
                borrower: status === "borrowed" ? borrower : "",
                updatedAt: new Date().toISOString(),
              }
            : candidate
        ),
      };

      transaction.set(DOCUMENT_KEY, toJsonValue(next));
      return next;
    });
    return requireLibraryDocument(document, "Update book status");
  });
}

async function withLibraryStore<T>(work: (store: GStore) => Promise<T>): Promise<T> {
  const session = await Session.connect(Session.configFromEnv());
  try {
    const store = await GStore.open(session, STORE_NAME);
    return await work(store);
  } finally {
    await session.logout().catch(() => undefined);
  }
}

async function openEvents(response: ServerResponse): Promise<void> {
  const snapshot = await readLibrary();
  clients.add(response);
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
  });
  response.write("event: library\n");
  response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
}

function broadcast(snapshot: LibraryDocument): void {
  const payload = `event: library\ndata: ${JSON.stringify(snapshot)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function seedLibrary(): LibraryDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    books: [
      { id: "practical-smalltalk", title: "Practical Smalltalk", author: "Dan Shafer", status: "available", borrower: "", updatedAt: now },
      { id: "design-principles", title: "Design Principles Behind Smalltalk", author: "Daniel H. H. Ingalls", status: "borrowed", borrower: "Ada", updatedAt: now },
      { id: "gemstone-systems", title: "GemStone Systems Administration", author: "GemTalk Systems", status: "available", borrower: "", updatedAt: now },
      { id: "object-databases", title: "Object Databases in Practice", author: "Library Staff", status: "borrowed", borrower: "Grace", updatedAt: now },
    ],
  };
}

function toJsonValue(document: LibraryDocument): GStoreJsonValue {
  return document as unknown as GStoreJsonValue;
}

function fromJsonValue(value: GStoreJsonValue | undefined): LibraryDocument {
  if (!isRecord(value) || !Array.isArray(value.books)) return seedLibrary();
  const books = value.books
    .map((book) => normalizeBook(book))
    .filter((book): book is LibraryBook => book !== null);
  if (!books.length) return seedLibrary();
  return {
    version: safeInteger(value.version, 1),
    books,
  };
}

function requireLibraryDocument(value: LibraryDocument | undefined, operation: string): LibraryDocument {
  if (value) return value;
  throw new HttpError(409, `${operation} did not produce a library snapshot.`);
}

function normalizeBook(value: unknown): LibraryBook | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const title = stringValue(value.title);
  if (!id || !title) return null;
  const status = value.status === "borrowed" ? "borrowed" : "available";
  return {
    id,
    title,
    author: stringValue(value.author) || "Unknown",
    status,
    borrower: status === "borrowed" ? stringValue(value.borrower) || "Patron" : "",
    updatedAt: stringValue(value.updatedAt) || new Date().toISOString(),
  };
}

function requestUrl(request: IncomingMessage): URL {
  const host = request.headers.host ?? "127.0.0.1";
  return new URL(request.url ?? "/", `http://${host}`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function stringField(value: unknown, key: string): string | undefined {
  return isRecord(value) ? stringValue(value[key]) || undefined : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function writeHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function writeError(response: ServerResponse, error: unknown): void {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : String(error);
  writeJson(response, status, { error: message });
}

function shutdown(): void {
  for (const client of clients) client.end();
  clients.clear();
  server.close();
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function libraryHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GemStone Library Books</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f6f7f9;
    --text: #20242c;
    --muted: #667085;
    --panel: #ffffff;
    --line: #d7dce5;
    --available: #116b45;
    --borrowed: #9a3412;
    --accent: #255f9f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
  }
  header {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 18px;
    border-bottom: 1px solid var(--line);
    background: #fff;
  }
  h1 { margin: 0; font-size: 18px; }
  main { padding: 18px; }
  .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .status { color: var(--muted); }
  button {
    height: 32px;
    border: 1px solid var(--line);
    background: #fff;
    color: var(--text);
    padding: 0 10px;
    font: inherit;
    cursor: pointer;
  }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button:disabled { color: #98a2b3; cursor: not-allowed; background: #f2f4f7; }
  .screens { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .screen {
    min-width: 0;
    background: var(--panel);
    border: 1px solid var(--line);
  }
  .screen h2 {
    margin: 0;
    padding: 12px;
    font-size: 14px;
    border-bottom: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .book-list { display: grid; }
  .book {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    padding: 12px;
    border-bottom: 1px solid var(--line);
  }
  .book:last-child { border-bottom: 0; }
  .title { font-weight: 650; }
  .meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .badge {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 8px;
    border: 1px solid var(--line);
    font-size: 12px;
    white-space: nowrap;
  }
  .badge.available { color: var(--available); border-color: #99d6bc; background: #ecfdf3; }
  .badge.borrowed { color: var(--borrowed); border-color: #fdba74; background: #fff7ed; }
  .actions { display: flex; align-items: center; gap: 6px; }
  .empty { padding: 12px; color: var(--muted); }
  @media (max-width: 860px) {
    .screens { grid-template-columns: 1fr; }
    .book { grid-template-columns: 1fr; }
    .actions { justify-content: flex-start; }
  }
</style>
</head>
<body>
<header>
  <h1>GemStone Library Books</h1>
  <span class="status" id="connectionStatus">Connecting...</span>
</header>
<main>
  <div class="toolbar">
    <button class="primary" id="reset">Reset Seed Data</button>
    <span class="status" id="version">Version pending</span>
  </div>
  <div class="screens">
    <section class="screen" data-client="Front Desk"><h2><span>Front Desk Client</span><span data-client-version></span></h2><div class="book-list" data-books></div></section>
    <section class="screen" data-client="Reading Room"><h2><span>Reading Room Client</span><span data-client-version></span></h2><div class="book-list" data-books></div></section>
  </div>
</main>
<script>
  let snapshot = { version: 0, books: [] };
  const status = document.getElementById("connectionStatus");
  const version = document.getElementById("version");

  document.getElementById("reset").addEventListener("click", () => { void post("/api/reset").catch(showError); });
  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    if (action === "borrow") {
      const borrower = button.closest("[data-client]")?.dataset.client || "Patron";
      void post("/api/books/" + encodeURIComponent(id) + "/borrow", { borrower }).catch(showError);
    } else if (action === "return") {
      void post("/api/books/" + encodeURIComponent(id) + "/return").catch(showError);
    }
  });

  async function post(path, body) {
    const payload = await fetchJson(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    update(payload);
  }

  async function loadInitial() {
    update(await fetchJson("/api/books"));
  }

  function connectEvents() {
    const events = new EventSource("/events");
    events.addEventListener("open", () => { status.textContent = "Live updates connected"; });
    events.addEventListener("error", () => { status.textContent = "Live updates reconnecting"; });
    events.addEventListener("library", (event) => {
      try {
        update(JSON.parse(event.data));
      } catch (error) {
        showError(error);
      }
    });
  }

  function update(next) {
    const valid = normalizeSnapshot(next);
    if (!valid) {
      showError(new Error(errorMessage(next, "Invalid library snapshot.")));
      return;
    }
    snapshot = valid;
    version.textContent = "Library version " + snapshot.version;
    for (const screen of document.querySelectorAll("[data-client]")) {
      screen.querySelector("[data-client-version]").textContent = "v" + snapshot.version;
      screen.querySelector("[data-books]").innerHTML = snapshot.books.length
        ? snapshot.books.map((book) => renderBook(book)).join("")
        : '<div class="empty">No books found.</div>';
    }
  }

  async function fetchJson(path, options) {
    const response = await fetch(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(payload, response.statusText));
    return payload;
  }

  function normalizeSnapshot(value) {
    if (!value || !Array.isArray(value.books)) return null;
    return {
      version: Number.isSafeInteger(value.version) ? value.version : 0,
      books: value.books.map(normalizeBook).filter(Boolean),
    };
  }

  function normalizeBook(value) {
    if (!value || typeof value !== "object") return null;
    const id = stringValue(value.id);
    const title = stringValue(value.title);
    if (!id || !title) return null;
    const status = value.status === "borrowed" ? "borrowed" : "available";
    return {
      id,
      title,
      author: stringValue(value.author) || "Unknown",
      status,
      borrower: status === "borrowed" ? stringValue(value.borrower) || "Patron" : "",
      updatedAt: stringValue(value.updatedAt) || new Date().toISOString(),
    };
  }

  function renderBook(book) {
    const available = book.status === "available";
    return '<article class="book">' +
      '<div><div class="title">' + escapeHtml(book.title) + '</div>' +
      '<div class="meta">' + escapeHtml(book.author) + '</div>' +
      '<div class="meta">Updated ' + escapeHtml(new Date(book.updatedAt).toLocaleTimeString()) + (book.borrower ? ' by ' + escapeHtml(book.borrower) : '') + '</div></div>' +
      '<div class="actions"><span class="badge ' + book.status + '">' + (available ? 'Available' : 'Borrowed') + '</span>' +
      '<button data-action="borrow" data-id="' + escapeHtml(book.id) + '"' + (available ? '' : ' disabled') + '>Borrow</button>' +
      '<button data-action="return" data-id="' + escapeHtml(book.id) + '"' + (available ? ' disabled' : '') + '>Return</button></div>' +
      '</article>';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function stringValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function errorMessage(value, fallback) {
    if (value instanceof Error) return value.message;
    if (value && typeof value === "object" && typeof value.error === "string") return value.error;
    return fallback || String(value);
  }

  function showError(error) {
    status.textContent = errorMessage(error, "Library update failed.");
  }

  loadInitial().then(connectEvents).catch(showError);
</script>
</body>
</html>`;
}
