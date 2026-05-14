import type { Session } from "../client.ts";
import { SessionPool, type PoolConfig } from "../pool.ts";
import { RequestScope, type TransactionPolicy } from "../scope.ts";

type MaybePromise<T> = T | Promise<T>;

export interface FetchGemStoneOptions extends PoolConfig {
  pool?: SessionPool;
  serverErrorStatus?: number;
  transactionPolicy?: TransactionPolicy;
}

export interface GemStoneFetchContext {
  request: Request;
  scope: RequestScope;
  session: Session;
}

export type GemStoneFetchHandler = (
  request: Request,
  context: GemStoneFetchContext,
) => MaybePromise<Response>;

export interface GemStoneFetchApp {
  (request: Request): Promise<Response>;
  readonly pool: SessionPool;
  close(): Promise<void>;
}

export function gemstoneFetch(
  handler: GemStoneFetchHandler,
  options: FetchGemStoneOptions = {},
): GemStoneFetchApp {
  const pool = options.pool ?? new SessionPool(options);
  const serverErrorStatus = options.serverErrorStatus ?? 400;
  const transactionPolicy = options.transactionPolicy;

  const app = async function gemstoneFetchHandler(request: Request): Promise<Response> {
    return withGemStoneFetch(request, { pool, serverErrorStatus, transactionPolicy }, handler);
  } as GemStoneFetchApp;

  Object.defineProperties(app, {
    pool: {
      enumerable: true,
      value: pool,
    },
    close: {
      enumerable: true,
      value: () => pool.close(),
    },
  });

  return app;
}

export async function withGemStoneFetch(
  request: Request,
  options: FetchGemStoneOptions,
  handler: GemStoneFetchHandler,
): Promise<Response> {
  const pool = options.pool ?? new SessionPool(options);
  const ownsPool = options.pool === undefined;
  const scope = new RequestScope({
    pool,
    serverErrorStatus: options.serverErrorStatus ?? 400,
    transactionPolicy: options.transactionPolicy,
  });

  try {
    const session = await scope.session();
    const response = await handler(request, { request, scope, session });
    assertResponse(response);
    await scope.finalize(undefined, { responseStatus: response.status });
    return response;
  } catch (error) {
    try {
      if (error instanceof Response) {
        await scope.finalize(undefined, { responseStatus: error.status });
      } else {
        await scope.finalize(error);
      }
    } catch {
      // Preserve the handler error or thrown Response.
    }
    throw error;
  } finally {
    if (ownsPool) await pool.close();
  }
}

function assertResponse(value: unknown): asserts value is Response {
  if (!(value instanceof Response)) {
    throw new TypeError("gemstoneFetch handlers must return a Response.");
  }
}
