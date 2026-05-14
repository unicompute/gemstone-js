import Fastify from "fastify";
import {
  ObjectLog,
  SessionPool,
  gemstoneFastify,
  type RequestScope,
  type Session,
} from "gemstone-js";

declare module "fastify" {
  interface FastifyRequest {
    gemstoneScope?: RequestScope;
    gemstoneSession?: Session;
  }
}

const pool = new SessionPool({
  name: "fastify-web",
  minSize: 1,
  maxSize: 4,
  validationQuery: "1 + 1",
});

await pool.warm();

const app = Fastify({ logger: true });
await gemstoneFastify(app, { pool, serverErrorStatus: 500 });

app.get("/health/gemstone", async (request) => {
  const stone = await request.gemstoneSession!.eval("System stoneName");
  return {
    ok: true,
    stone,
    pool: pool.snapshot(),
  };
});

app.post("/object-log", async (request, reply) => {
  const body = request.body as { label?: unknown } | undefined;
  const label = String(body?.label ?? "gemstone-js fastify event");
  await new ObjectLog(request.gemstoneSession!).info(label);
  return reply.status(201).send({ ok: true, label });
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: "0.0.0.0", port });

async function shutdown() {
  await app.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
