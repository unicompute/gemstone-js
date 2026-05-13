import { SessionPool, type PoolConfig } from "../pool.ts";

export interface FastifyGemStoneOptions extends PoolConfig {
  pool?: SessionPool;
}

export async function gemstoneFastify(fastify: any, options: FastifyGemStoneOptions = {}): Promise<void> {
  const pool = options.pool ?? new SessionPool(options);

  fastify.decorateRequest("gemstoneSession", null);

  fastify.addHook("onRequest", async (request: any) => {
    const lease = await pool.acquire();
    request.gemstoneLease = lease;
    request.gemstoneSession = lease.session;
  });

  fastify.addHook("onResponse", async (request: any, reply: any) => {
    const lease = request.gemstoneLease;
    if (!lease) return;
    if (reply.statusCode >= 400) {
      await lease.session.abort();
    } else {
      await lease.session.commit();
    }
    await lease.release({ clean: true });
  });

  fastify.addHook("onError", async (request: any) => {
    const lease = request.gemstoneLease;
    if (!lease) return;
    await lease.session.abort().catch(() => {});
    await lease.release({ clean: true });
  });

  fastify.addHook("onClose", async () => {
    await pool.close();
  });
}
