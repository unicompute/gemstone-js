import { Session } from "./client.ts";
import { PooledSession, SessionPool, type PooledSessionReleaseOptions } from "./pool.ts";
import type { SessionConfig } from "./types.ts";

type MaybePromise<T> = T | Promise<T>;

export type TransactionPolicy = "manual" | "commitOnSuccess" | "abortOnExit";

export type TransactionFinalizationAction =
  | "none"
  | "commit"
  | "abort"
  | "abort_failed"
  | "abort_after_commit_failed"
  | "already_finalized";

export interface TransactionFinalization {
  action: TransactionFinalizationAction;
  clean: boolean;
  discard: boolean;
}

export interface RequestFailureOptions {
  error?: unknown;
  responseStatus?: number;
  serverErrorStatus?: number;
}

export interface TransactionSession {
  commit(): Promise<void>;
  abort(): Promise<void>;
}

export interface TransactionScopeOptions {
  transactionPolicy?: TransactionPolicy;
  serverErrorStatus?: number;
}

export interface RequestScopeOptions extends TransactionScopeOptions {
  session?: Session;
  pool?: SessionPool;
  sessionFactory?: () => MaybePromise<Session>;
  sessionConfig?: SessionConfig;
  acquireTimeoutMs?: number;
}

export interface RequestScopeFinalizeOptions {
  responseStatus?: number;
}

export function requestFailed(options: RequestFailureOptions = {}): boolean {
  if (options.error !== undefined && options.error !== null) return true;
  if (options.responseStatus === undefined) return false;
  return Math.trunc(options.responseStatus) >= (options.serverErrorStatus ?? 500);
}

export class TransactionScope<T extends TransactionSession = Session> {
  readonly session: T;
  readonly transactionPolicy: TransactionPolicy;
  readonly serverErrorStatus: number;
  lastOutcome: TransactionFinalization = finalization("none", false);

  constructor(session: T, options: TransactionScopeOptions = {}) {
    this.session = session;
    this.transactionPolicy = options.transactionPolicy ?? "commitOnSuccess";
    this.serverErrorStatus = options.serverErrorStatus ?? 500;
  }

  async finalize(error?: unknown, options: RequestScopeFinalizeOptions = {}): Promise<TransactionFinalization> {
    if (requestFailed({ error, responseStatus: options.responseStatus, serverErrorStatus: this.serverErrorStatus })) {
      this.lastOutcome = await this.#abort(false);
      return this.lastOutcome;
    }
    if (this.transactionPolicy === "commitOnSuccess") {
      this.lastOutcome = await this.#commit();
      return this.lastOutcome;
    }
    if (this.transactionPolicy === "abortOnExit") {
      this.lastOutcome = await this.#abort(true);
      return this.lastOutcome;
    }
    this.lastOutcome = finalization("none", false);
    return this.lastOutcome;
  }

  async #commit(): Promise<TransactionFinalization> {
    try {
      await this.session.commit();
      return finalization("commit", true);
    } catch (error) {
      try {
        await this.session.abort();
      } catch {
        this.lastOutcome = finalization("abort_after_commit_failed", false, true);
        throw error;
      }
      this.lastOutcome = finalization("abort_after_commit_failed", true);
      throw error;
    }
  }

  async #abort(raiseErrors: boolean): Promise<TransactionFinalization> {
    try {
      await this.session.abort();
      return finalization("abort", true);
    } catch (error) {
      this.lastOutcome = finalization("abort_failed", false, true);
      if (raiseErrors) throw error;
      return this.lastOutcome;
    }
  }
}

export class RequestScope implements AsyncDisposable {
  readonly transactionPolicy: TransactionPolicy;
  readonly serverErrorStatus: number;
  #session: Session | undefined;
  #lease: PooledSession | undefined;
  #finalized = false;
  #ownsSession = false;
  #options: RequestScopeOptions;

  constructor(options: RequestScopeOptions = {}) {
    const providerCount = Number(options.session !== undefined)
      + Number(options.pool !== undefined)
      + Number(options.sessionFactory !== undefined)
      + Number(options.sessionConfig !== undefined);
    if (providerCount > 1) {
      throw new TypeError("RequestScope accepts only one of session, pool, sessionFactory, or sessionConfig.");
    }
    this.#options = options;
    this.transactionPolicy = options.transactionPolicy ?? "commitOnSuccess";
    this.serverErrorStatus = options.serverErrorStatus ?? 500;
  }

  get activeSession(): Session | undefined {
    return this.#session;
  }

  async session(): Promise<Session> {
    if (this.#session) return this.#session;
    if (this.#finalized) throw new Error("RequestScope has already been finalized.");

    if (this.#options.session) {
      this.#session = this.#options.session;
      return this.#session;
    }
    if (this.#options.pool) {
      this.#lease = await this.#options.pool.acquire(this.#options.acquireTimeoutMs);
      this.#session = this.#lease.session;
      return this.#session;
    }
    if (this.#options.sessionFactory) {
      this.#session = await this.#options.sessionFactory();
      this.#ownsSession = true;
      return this.#session;
    }
    if (this.#options.sessionConfig) {
      this.#session = await Session.connect(this.#options.sessionConfig);
      this.#ownsSession = true;
      return this.#session;
    }
    throw new Error("RequestScope needs a session, pool, sessionFactory, or sessionConfig.");
  }

  async finalize(error?: unknown, options: RequestScopeFinalizeOptions = {}): Promise<TransactionFinalization> {
    if (this.#finalized) return finalization("already_finalized", true);
    this.#finalized = true;
    const session = this.#session;
    if (!session) return finalization("none", true);

    const transaction = new TransactionScope(session, {
      transactionPolicy: this.transactionPolicy,
      serverErrorStatus: this.serverErrorStatus,
    });
    let outcome = finalization("none", false);
    try {
      outcome = await transaction.finalize(error, options);
      return outcome;
    } catch (finalizeError) {
      outcome = transaction.lastOutcome;
      throw finalizeError;
    } finally {
      await this.#release(outcome);
      this.#session = undefined;
      this.#lease = undefined;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.finalize();
  }

  async #release(outcome: TransactionFinalization): Promise<void> {
    const releaseOptions: PooledSessionReleaseOptions = {
      clean: outcome.clean,
      discard: outcome.discard,
    };
    if (this.#lease) {
      await this.#lease.release(releaseOptions);
      return;
    }
    if (this.#ownsSession && this.#session) {
      await this.#session.logout();
    }
  }
}

export function sessionScope(options: RequestScopeOptions = {}): RequestScope {
  return new RequestScope(options);
}

export async function withSessionScope<T>(
  options: RequestScopeOptions,
  work: (session: Session, scope: RequestScope) => MaybePromise<T>,
): Promise<T> {
  const scope = new RequestScope(options);
  try {
    const session = await scope.session();
    const result = await work(session, scope);
    await scope.finalize();
    return result;
  } catch (error) {
    try {
      await scope.finalize(error);
    } catch {
      // Preserve the application error that made the scoped work fail.
    }
    throw error;
  }
}

function finalization(
  action: TransactionFinalizationAction,
  clean: boolean,
  discard = false,
): TransactionFinalization {
  return { action, clean, discard };
}
