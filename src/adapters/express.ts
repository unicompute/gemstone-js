import { SessionPool, type PoolConfig } from "../pool.ts";
import { RequestScope, type TransactionPolicy } from "../scope.ts";

export interface ExpressGemStoneOptions extends PoolConfig {
  pool?: SessionPool;
  commitOnStatusBelow?: number;
  serverErrorStatus?: number;
  transactionPolicy?: TransactionPolicy;
}

export function gemstoneExpress(options: ExpressGemStoneOptions = {}) {
  const pool = options.pool ?? new SessionPool(options);
  const serverErrorStatus = options.serverErrorStatus ?? options.commitOnStatusBelow ?? 400;
  const transactionPolicy = options.transactionPolicy;

  return async function gemstoneSessionMiddleware(req: any, res: any, next: (error?: unknown) => void) {
    const scope = new RequestScope({ pool, serverErrorStatus, transactionPolicy });
    try {
      req.gemstoneScope = scope;
      req.gemstoneSession = await scope.session();
    } catch (error) {
      next(error);
      return;
    }

    let released = false;
    const release = async (error?: unknown) => {
      if (released) return;
      released = true;
      try {
        await scope.finalize(error, { responseStatus: res.statusCode });
      } catch (releaseError) {
        if (!error) next(releaseError);
      }
    };

    res.on?.("finish", () => release());
    res.on?.("close", () => release(new Error("response closed")));
    next();
  };
}
