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
    await finalizeRequestLease(request, reply.statusCode < 400);
  });

  fastify.addHook("onError", async (request: any) => {
    try {
      await finalizeRequestLease(request, false);
    } catch {
      // Preserve the application error Fastify is already handling.
    }
  });

  fastify.addHook("onClose", async () => {
    await pool.close();
  });
}

async function finalizeRequestLease(request: any, commit: boolean): Promise<void> {
  const lease = request.gemstoneLease;
  if (!lease) return;
  request.gemstoneLease = undefined;
  await finalizeLease(lease, commit);
}

async function finalizeLease(lease: any, commit: boolean): Promise<void> {
  try {
    if (commit) {
      await lease.session.commit();
    } else {
      await lease.session.abort();
    }
    await lease.release({ clean: true });
  } catch (error) {
    await lease.release({ discard: true });
    throw error;
  }
}
