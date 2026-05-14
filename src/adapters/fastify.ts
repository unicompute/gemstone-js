import { SessionPool, type PoolConfig } from "../pool.ts";
import { RequestScope, type TransactionPolicy } from "../scope.ts";

export interface FastifyGemStoneOptions extends PoolConfig {
  pool?: SessionPool;
  serverErrorStatus?: number;
  transactionPolicy?: TransactionPolicy;
}

export async function gemstoneFastify(fastify: any, options: FastifyGemStoneOptions = {}): Promise<void> {
  const pool = options.pool ?? new SessionPool(options);
  const serverErrorStatus = options.serverErrorStatus ?? 400;
  const transactionPolicy = options.transactionPolicy;

  fastify.decorateRequest("gemstoneSession", null);

  fastify.addHook("onRequest", async (request: any) => {
    const scope = new RequestScope({ pool, serverErrorStatus, transactionPolicy });
    request.gemstoneScope = scope;
    request.gemstoneSession = await scope.session();
  });

  fastify.addHook("onResponse", async (request: any, reply: any) => {
    await finalizeRequestScope(request, undefined, reply.statusCode);
  });

  fastify.addHook("onError", async (request: any, _reply: any, error: unknown) => {
    try {
      await finalizeRequestScope(request, error ?? new Error("request failed"));
    } catch {
      // Preserve the application error Fastify is already handling.
    }
  });

  fastify.addHook("onClose", async () => {
    await pool.close();
  });
}

async function finalizeRequestScope(request: any, error?: unknown, responseStatus?: number): Promise<void> {
  const scope = request.gemstoneScope;
  if (!scope) return;
  request.gemstoneScope = undefined;
  await scope.finalize(error, { responseStatus });
}
