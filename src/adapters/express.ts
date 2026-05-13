import { SessionPool, type PoolConfig } from "../pool.ts";

export interface ExpressGemStoneOptions extends PoolConfig {
  pool?: SessionPool;
  commitOnStatusBelow?: number;
}

export function gemstoneExpress(options: ExpressGemStoneOptions = {}) {
  const pool = options.pool ?? new SessionPool(options);
  const commitOnStatusBelow = options.commitOnStatusBelow ?? 400;

  return async function gemstoneSessionMiddleware(req: any, res: any, next: (error?: unknown) => void) {
    let lease;
    try {
      lease = await pool.acquire();
      req.gemstoneSession = lease.session;
    } catch (error) {
      next(error);
      return;
    }

    let released = false;
    const release = async (error?: unknown) => {
      if (released) return;
      released = true;
      try {
        if (error || res.statusCode >= commitOnStatusBelow) {
          await lease.session.abort();
          await lease.release({ clean: true });
        } else {
          await lease.session.commit();
          await lease.release({ clean: true });
        }
      } catch (releaseError) {
        await lease.release({ discard: true });
        if (!error) next(releaseError);
      }
    };

    res.on?.("finish", () => void release());
    res.on?.("close", () => void release(new Error("response closed")));
    next();
  };
}
