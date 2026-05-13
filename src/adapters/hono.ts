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
      const response = c.res;
      if (response?.status && response.status >= 400) {
        await lease.session.abort();
      } else {
        await lease.session.commit();
      }
      await lease.release({ clean: true });
    } catch (error) {
      await lease.session.abort().catch(() => {});
      await lease.release({ clean: true });
      throw error;
    }
  };
}
