import { ObjectLog, gemstoneFetch } from "gemstone-js";

export const runtime = "nodejs";

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
    const label = String(body.label ?? "gemstone-js route-handler event");
    await new ObjectLog(session).info(label);
    return Response.json({ ok: true, label }, { status: 201 });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}, {
  name: "route-handler-web",
  minSize: 1,
  maxSize: 4,
  validationQuery: "1 + 1",
});

export async function GET(request: Request): Promise<Response> {
  return app(request);
}

export async function POST(request: Request): Promise<Response> {
  return app(request);
}

export async function shutdownGemStoneRouteHandler(): Promise<void> {
  await app.close();
}
