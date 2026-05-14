import { Session } from "./client.ts";
import type { PoolStats, SessionConfig } from "./types.ts";

export interface PoolConfig extends SessionConfig {
  minSize?: number;
  maxSize?: number;
  idleTimeoutMs?: number;
  maxSessionAgeMs?: number;
  maxSessionUses?: number;
  healthCheck?: (session: Session) => MaybePromise<boolean>;
  validationQuery?: string;
  validationIntervalMs?: number;
  acquireTimeoutMs?: number;
}

export interface PooledSessionReleaseOptions {
  discard?: boolean;
  clean?: boolean;
}

export interface PoolWithSessionOptions {
  acquireTimeoutMs?: number;
  release?: PooledSessionReleaseOptions;
}

type MaybePromise<T> = T | Promise<T>;

export class PooledSession implements AsyncDisposable {
  readonly session: Session;
  #pool: SessionPool | undefined;
  #releasePromise: Promise<void> | undefined;

  constructor(pool: SessionPool, session: Session) {
    this.#pool = pool;
    this.session = session;
  }

  release(options: PooledSessionReleaseOptions = {}): Promise<void> {
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
  metadata: SessionMetadata;
}

interface SessionMetadata {
  createdAt: number;
  lastUsedAt: number;
  validatedAt: number;
  useCount: number;
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
  #recycleAgeDiscards = 0;
  #recycleUseDiscards = 0;
  #idleTimeoutDiscards = 0;
  #acquireWaitsTotal = 0;
  #acquireWaitMsTotal = 0;
  #closed = false;
  #waiters: Waiter[] = [];
  #sweeper: ReturnType<typeof setInterval> | undefined;
  #metadata = new WeakMap<Session, SessionMetadata>();

  constructor(config: PoolConfig = {}) {
    const minSize = config.minSize ?? 0;
    const maxSize = config.maxSize ?? 4;
    if (!Number.isSafeInteger(maxSize) || maxSize < 1) throw new RangeError("SessionPool maxSize must be a positive safe integer.");
    if (!Number.isSafeInteger(minSize) || minSize < 0) throw new RangeError("SessionPool minSize must be a non-negative safe integer.");
    if (minSize > maxSize) throw new RangeError("SessionPool minSize cannot exceed maxSize.");
    if (config.idleTimeoutMs !== undefined && (!Number.isFinite(config.idleTimeoutMs) || config.idleTimeoutMs < 0)) {
      throw new RangeError("SessionPool idleTimeoutMs must be a non-negative finite number.");
    }
    if (config.maxSessionAgeMs !== undefined && (!Number.isFinite(config.maxSessionAgeMs) || config.maxSessionAgeMs < 0)) {
      throw new RangeError("SessionPool maxSessionAgeMs must be a non-negative finite number.");
    }
    if (config.maxSessionUses !== undefined && (!Number.isSafeInteger(config.maxSessionUses) || config.maxSessionUses < 1)) {
      throw new RangeError("SessionPool maxSessionUses must be a positive safe integer.");
    }
    if (config.acquireTimeoutMs !== undefined && (!Number.isFinite(config.acquireTimeoutMs) || config.acquireTimeoutMs < 0)) {
      throw new RangeError("SessionPool acquireTimeoutMs must be a non-negative finite number.");
    }
    if (config.validationIntervalMs !== undefined && (!Number.isFinite(config.validationIntervalMs) || config.validationIntervalMs < 0)) {
      throw new RangeError("SessionPool validationIntervalMs must be a non-negative finite number.");
    }
    const validationIntervalMs = config.validationIntervalMs ?? (config.validationQuery === undefined ? undefined : 0);
    const validationQuery = config.validationQuery ?? (validationIntervalMs === undefined ? undefined : "1 + 1");
    this.config = { ...config, minSize, maxSize, validationIntervalMs, validationQuery };
  }

  async warm(count = this.config.minSize): Promise<number> {
    this.#ensureOpen();
    this.#ensureSweeper();
    const target = normalizeWarmTarget(count, this.config.maxSize);
    let warmed = 0;
    while (this.#created < target) {
      const session = await this.#createSession();
      this.#idle.push({ session, metadata: this.#metadataFor(session) });
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
      const recycleReason = this.#recycleReason(idle.metadata);
      if (recycleReason) {
        await this.#discard(idle.session, recycleReason);
        return this.acquire(timeoutMs);
      }
      if (await this.#validateIfNeeded(idle.session, idle.metadata)) {
        this.#markCheckedOut(idle.metadata);
        this.#recordAcquireWait(started);
        return new PooledSession(this, idle.session);
      }
      await this.#discard(idle.session);
      return this.acquire(timeoutMs);
    }

    if (this.#created < this.config.maxSize) {
      const session = await this.#createSession();
      this.#markCheckedOut(this.#metadataFor(session));
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

  async withSession<T>(
    fn: (session: Session, lease: PooledSession) => MaybePromise<T>,
    options: PoolWithSessionOptions = {},
  ): Promise<T> {
    const lease = await this.acquire(options.acquireTimeoutMs);
    try {
      const result = await fn(lease.session, lease);
      await lease.release(options.release);
      return result;
    } catch (error) {
      try {
        await lease.release();
      } catch {
        // Preserve the original application error.
      }
      throw error;
    }
  }

  async release(lease: PooledSession, options: PooledSessionReleaseOptions = {}): Promise<void> {
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

    const metadata = this.#metadataFor(session);
    metadata.lastUsedAt = Date.now();
    if (!await this.#validateIfNeeded(session, metadata)) {
      await this.#discard(session);
      await this.#serveWaiters();
      return;
    }

    const recycleReason = this.#recycleReason(metadata);
    if (recycleReason) {
      await this.#discard(session, recycleReason);
      await this.#serveWaiters();
      return;
    }

    const waiter = this.#waiters.shift();
    if (waiter) {
      this.#resolveWaiter(waiter, session);
      return;
    }

    const idle = { session, metadata };
    this.#idle.push(idle);
  }

  async sweepIdle(): Promise<number> {
    if (this.config.idleTimeoutMs === undefined) return 0;
    const now = Date.now();
    const keep: IdleSession[] = [];
    let swept = 0;
    for (const idle of this.#idle) {
      const canEvict = this.#created > this.config.minSize;
      if (canEvict && now - idle.metadata.lastUsedAt >= this.config.idleTimeoutMs) {
        swept += 1;
        await this.#discard(idle.session, "idleTimeout");
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
      pendingAcquires: this.#waiters.length,
      currentCapacity: this.#created,
      createdTotal: this.#createdTotal,
      evictedTotal: this.#evictedTotal,
      validationFailures: this.#validationFailures,
      recycleAgeDiscards: this.#recycleAgeDiscards,
      recycleUseDiscards: this.#recycleUseDiscards,
      idleTimeoutDiscards: this.#idleTimeoutDiscards,
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
      const session = await Session.connect(this.config);
      this.#metadata.set(session, {
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        validatedAt: 0,
        useCount: 0,
      });
      return session;
    } catch (error) {
      this.#created -= 1;
      throw error;
    }
  }

  async #discard(session: Session, reason?: SessionRecycleReason): Promise<void> {
    this.#created = Math.max(this.#created - 1, 0);
    this.#evictedTotal += 1;
    if (reason === "maxAge") this.#recycleAgeDiscards += 1;
    if (reason === "maxUses") this.#recycleUseDiscards += 1;
    if (reason === "idleTimeout") this.#idleTimeoutDiscards += 1;
    this.#metadata.delete(session);
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

  async #validateIfNeeded(session: Session, metadata: SessionMetadata): Promise<boolean> {
    const healthCheck = this.config.healthCheck;
    const query = this.config.validationQuery;
    if (!healthCheck && (!query || this.config.validationIntervalMs === undefined)) return true;
    if (Date.now() - metadata.validatedAt < (this.config.validationIntervalMs ?? 0)) return true;
    try {
      if (healthCheck && !await healthCheck(session)) {
        this.#validationFailures += 1;
        return false;
      }
      if (query) await session.execute(query);
      metadata.validatedAt = Date.now();
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
    this.#markCheckedOut(this.#metadataFor(session));
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

  #metadataFor(session: Session): SessionMetadata {
    const metadata = this.#metadata.get(session);
    if (metadata) return metadata;
    const createdAt = Date.now();
    const created = { createdAt, lastUsedAt: createdAt, validatedAt: 0, useCount: 0 };
    this.#metadata.set(session, created);
    return created;
  }

  #markCheckedOut(metadata: SessionMetadata): void {
    metadata.useCount += 1;
  }

  #recycleReason(metadata: SessionMetadata): SessionRecycleReason | undefined {
    if (this.config.maxSessionAgeMs !== undefined && Date.now() - metadata.createdAt >= this.config.maxSessionAgeMs) {
      return "maxAge";
    }
    if (this.config.maxSessionUses !== undefined && metadata.useCount >= this.config.maxSessionUses) {
      return "maxUses";
    }
    return undefined;
  }
}

type SessionRecycleReason = "idleTimeout" | "maxAge" | "maxUses";

function normalizeWarmTarget(count: number, maxSize: number): number {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("SessionPool warm count must be a non-negative safe integer.");
  }
  return Math.min(count, maxSize);
}
