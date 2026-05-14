import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  ObjectLog,
  SessionPool,
  gemstoneHono,
  type RequestScope,
  type Session,
} from "gemstone-js";

type Variables = {
  gemstoneScope: RequestScope;
  gemstoneSession: Session;
};

const pool = new SessionPool({
  name: "hono-web",
  minSize: 1,
  maxSize: 4,
  validationQuery: "1 + 1",
});

await pool.warm();

const app = new Hono<{ Variables: Variables }>();
app.use("*", gemstoneHono({ pool, serverErrorStatus: 500 }));

app.get("/health/gemstone", async (c) => {
  const session = c.get("gemstoneSession");
  const stone = await session.eval("System stoneName");
  return c.json({
    ok: true,
    stone,
    pool: pool.snapshot(),
  });
});

app.post("/object-log", async (c) => {
  const body = await c.req.json<{ label?: unknown }>().catch(() => ({}));
  const label = String(body.label ?? "gemstone-js hono event");
  await new ObjectLog(c.get("gemstoneSession")).info(label);
  return c.json({ ok: true, label }, 201);
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port });
console.log(`Hono GemStone example listening on http://localhost:${port}`);

async function shutdown() {
  server.close();
  await pool.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
