import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { ObjectLog, gemstoneFetch } from "gemstone-js";

const app = gemstoneFetch(async (request, { session }) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health/gemstone") {
    return Response.json({
      ok: true,
      stone: await session.eval("System stoneName"),
      pool: app.pool.snapshot(),
    });
  }

  if (request.method === "POST" && url.pathname === "/object-log") {
    const body = await request.json().catch(() => ({})) as { label?: unknown };
    const label = String(body.label ?? "gemstone-js fetch event");
    await new ObjectLog(session).info(label);
    return Response.json({ ok: true, label }, { status: 201 });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}, {
  name: "fetch-web",
  minSize: 1,
  maxSize: 4,
  validationQuery: "1 + 1",
});

await app.pool.warm();

const server = createServer(async (incoming, outgoing) => {
  try {
    const response = await app(toFetchRequest(incoming));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500, { "content-type": "application/json" });
    outgoing.end(JSON.stringify({ error: "internal error" }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Fetch GemStone example listening on http://localhost:${port}`);
});

async function shutdown() {
  server.close();
  await app.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

function toFetchRequest(incoming: IncomingMessage): Request {
  const protocol = incoming.socket.encrypted ? "https" : "http";
  const host = incoming.headers.host ?? "localhost";
  const url = `${protocol}://${host}${incoming.url ?? "/"}`;
  const method = incoming.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers: incoming.headers as HeadersInit,
    body: hasBody ? Readable.toWeb(incoming) as ReadableStream : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}
