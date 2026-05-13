import { SessionPool, type PoolConfig } from "../pool.ts";

export interface HonoGemStoneOptions extends PoolConfig {
  pool?: SessionPool;
}

export function gemstoneHono(options: HonoGemStoneOptions = {}) {
  const pool = options.pool ?? new SessionPool(options);

  return async function gemstoneSessionMiddleware(c: any, next: () => Promise<void>) {
    const lease = await pool.acquire();
    c.set?.("gemstoneSession", lease.session);
    try {
      await next();
    } catch (error) {
      try {
        await finalizeLease(lease, false);
      } catch {
        // Preserve the application error.
      }
      throw error;
    }

    const response = c.res;
    await finalizeLease(lease, !(response?.status && response.status >= 400));
  };
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
