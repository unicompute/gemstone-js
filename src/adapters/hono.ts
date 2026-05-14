import { SessionPool, type PoolConfig } from "../pool.ts";
import { RequestScope, type TransactionPolicy } from "../scope.ts";

export interface HonoGemStoneOptions extends PoolConfig {
  pool?: SessionPool;
  serverErrorStatus?: number;
  transactionPolicy?: TransactionPolicy;
}

export function gemstoneHono(options: HonoGemStoneOptions = {}) {
  const pool = options.pool ?? new SessionPool(options);
  const serverErrorStatus = options.serverErrorStatus ?? 400;
  const transactionPolicy = options.transactionPolicy;

  return async function gemstoneSessionMiddleware(c: any, next: () => Promise<void>) {
    const scope = new RequestScope({ pool, serverErrorStatus, transactionPolicy });
    c.set?.("gemstoneScope", scope);
    c.set?.("gemstoneSession", await scope.session());
    try {
      await next();
    } catch (error) {
      try {
        await scope.finalize(error);
      } catch {
        // Preserve the application error.
      }
      throw error;
    }

    const response = c.res;
    await scope.finalize(undefined, { responseStatus: response?.status });
  };
}
