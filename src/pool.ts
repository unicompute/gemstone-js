import { Session } from "./client.ts";
import type { PoolStats, SessionConfig } from "./types.ts";

export interface PoolConfig extends SessionConfig {
  minSize?: number;
  maxSize?: number;
  idleTimeoutMs?: number;
  validationQuery?: string;
  validationIntervalMs?: number;
  acquireTimeoutMs?: number;
}

export class PooledSession implements AsyncDisposable {
  readonly session: Session;
  #pool: SessionPool | undefined;
  #releasePromise: Promise<void> | undefined;

  constructor(pool: SessionPool, session: Session) {
    this.#pool = pool;
    this.session = session;
  }

  release(options: { discard?: boolean; clean?: boolean } = {}): Promise<void> {
    if (this.#releasePromise) return this.#releasePromise;
    const pool = this.#pool;
    this.#pool = undefined;
    this.#releasePromise = pool?.release(this, options) ?? Promise.resolve();
    return this.#releasePromise;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.release();
  }
}

interface IdleSession {
  session: Session;
  lastUsedAt: number;
  validatedAt: number;
}

interface Waiter {
  resolve(lease: PooledSession): void;
  reject(error: unknown): void;
  started: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class SessionPool implements AsyncDisposable {
  readonly config: Required<Pick<PoolConfig, "minSize" | "maxSize">> & PoolConfig;
  #idle: IdleSession[] = [];
  #created = 0;
  #createdTotal = 0;
  #evictedTotal = 0;
  #validationFailures = 0;
  #acquireWaitsTotal = 0;
  #acquireWaitMsTotal = 0;
  #closed = false;
  #waiters: Waiter[] = [];
  #sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(config: PoolConfig = {}) {
    const minSize = config.minSize ?? 0;
    const maxSize = config.maxSize ?? 4;
    if (maxSize < 1) throw new RangeError("SessionPool maxSize must be at least 1.");
    if (minSize < 0) throw new RangeError("SessionPool minSize must be at least 0.");
    if (minSize > maxSize) throw new RangeError("SessionPool minSize cannot exceed maxSize.");
    this.config = { ...config, minSize, maxSize };
  }

  async warm(count = this.config.minSize): Promise<number> {
    this.#ensureOpen();
    this.#ensureSweeper();
    const target = Math.min(Math.max(count, 0), this.config.maxSize);
    let warmed = 0;
    while (warmed < target && this.#created < this.config.maxSize) {
      const session = await this.#createSession();
      this.#idle.push({ session, lastUsedAt: Date.now(), validatedAt: 0 });
      warmed += 1;
    }
    return warmed;
  }

  async acquire(timeoutMs = this.config.acquireTimeoutMs): Promise<PooledSession> {
    this.#ensureOpen();
    this.#ensureSweeper();
    const started = performance.now();

    const idle = this.#idle.pop();
    if (idle) {
      if (await this.#validateIfNeeded(idle)) {
        this.#recordAcquireWait(started);
        return new PooledSession(this, idle.session);
      }
      await this.#discard(idle.session);
      return this.acquire(timeoutMs);
    }

    if (this.#created < this.config.maxSize) {
      const session = await this.#createSession();
      this.#recordAcquireWait(started);
      return new PooledSession(this, session);
    }

    return new Promise<PooledSession>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, started };
      waiter.timer = timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.#waiters = this.#waiters.filter((entry) => entry !== waiter);
            reject(new Error(`Timed out acquiring GemStone session after ${timeoutMs}ms.`));
          }, timeoutMs);
      this.#waiters.push(waiter);
    });
  }

  async release(lease: PooledSession, options: { discard?: boolean; clean?: boolean } = {}): Promise<void> {
    const session = lease.session;
    if (options.discard || this.#closed) {
      await this.#discard(session);
      await this.#serveWaiters();
      return;
    }

    if (!options.clean && !await this.#resetSession(session)) {
      await this.#discard(session);
      await this.#serveWaiters();
      return;
    }

    const idle = { session, lastUsedAt: Date.now(), validatedAt: 0 };
    if (!await this.#validateIfNeeded(idle)) {
      await this.#discard(session);
      await this.#serveWaiters();
      return;
    }

    const waiter = this.#waiters.shift();
    if (waiter) {
      this.#resolveWaiter(waiter, session);
      return;
    }

    idle.lastUsedAt = Date.now();
    if (idle.validatedAt === 0) idle.validatedAt = Date.now();
    this.#idle.push(idle);
  }

  async sweepIdle(): Promise<number> {
    if (this.config.idleTimeoutMs === undefined) return 0;
    const now = Date.now();
    const keep: IdleSession[] = [];
    let swept = 0;
    for (const idle of this.#idle) {
      const canEvict = this.#created > this.config.minSize;
      if (canEvict && now - idle.lastUsedAt >= this.config.idleTimeoutMs) {
        swept += 1;
        await this.#discard(idle.session);
      } else {
        keep.push(idle);
      }
    }
    this.#idle = keep;
    return swept;
  }

  stats(): PoolStats {
    return {
      inUse: Math.max(this.#created - this.#idle.length, 0),
      idle: this.#idle.length,
      currentCapacity: this.#created,
      createdTotal: this.#createdTotal,
      evictedTotal: this.#evictedTotal,
      validationFailures: this.#validationFailures,
      acquireWaitsTotal: this.#acquireWaitsTotal,
      acquireWaitMsTotal: this.#acquireWaitMsTotal,
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#sweeper) clearInterval(this.#sweeper);
    this.#sweeper = undefined;
    const waiters = this.#waiters.splice(0);
    for (const waiter of waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error("SessionPool is closed."));
    }
    const idle = this.#idle.splice(0);
    await Promise.all(idle.map((entry) => this.#discard(entry.session)));
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async #createSession(): Promise<Session> {
    this.#created += 1;
    this.#createdTotal += 1;
    try {
      return await Session.connect(this.config);
    } catch (error) {
      this.#created -= 1;
      throw error;
    }
  }

  async #discard(session: Session): Promise<void> {
    this.#created = Math.max(this.#created - 1, 0);
    this.#evictedTotal += 1;
    await session.logout().catch(() => {});
  }

  async #resetSession(session: Session): Promise<boolean> {
    try {
      await session.abort();
      return true;
    } catch {
      return false;
    }
  }

  async #validateIfNeeded(idle: IdleSession): Promise<boolean> {
    const query = this.config.validationQuery ?? (this.config.validationIntervalMs === undefined ? undefined : "1 + 1");
    if (!query || this.config.validationIntervalMs === undefined) return true;
    if (Date.now() - idle.validatedAt < this.config.validationIntervalMs) return true;
    try {
      await idle.session.execute(query);
      idle.validatedAt = Date.now();
      return true;
    } catch {
      this.#validationFailures += 1;
      return false;
    }
  }

  #ensureSweeper(): void {
    if (this.#sweeper || this.config.idleTimeoutMs === undefined) return;
    const interval = Math.max(Math.min(this.config.idleTimeoutMs, 30_000), 1_000);
    this.#sweeper = setInterval(() => {
      void this.sweepIdle();
    }, interval);
  }

  #recordAcquireWait(started: number): void {
    this.#acquireWaitsTotal += 1;
    this.#acquireWaitMsTotal += performance.now() - started;
  }

  #resolveWaiter(waiter: Waiter, session: Session): void {
    if (waiter.timer) clearTimeout(waiter.timer);
    this.#recordAcquireWait(waiter.started);
    waiter.resolve(new PooledSession(this, session));
  }

  async #serveWaiters(): Promise<void> {
    while (!this.#closed && this.#waiters.length > 0 && this.#created < this.config.maxSize) {
      const waiter = this.#waiters.shift();
      if (!waiter) return;
      try {
        const session = await this.#createSession();
        this.#resolveWaiter(waiter, session);
      } catch (error) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("SessionPool is closed.");
  }
}
