import {
  CommitConflictError,
  GStore,
  GStoreAbortTransaction,
  PersistentRoot,
  Session,
  commitWithConflictDetails,
  nestedTransaction,
  runTransactionWithRetry,
  type GStoreJsonValue,
} from "gemstone-js";

const suffix = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const names = {
  manualCommit: `TxnManualCommit${suffix}`,
  manualAbort: `TxnManualAbort${suffix}`,
  scoped: `TxnScoped${suffix}`,
  scopedRollback: `TxnScopedRollback${suffix}`,
  retry: `TxnRetry${suffix}`,
  nestedOuter: `TxnNestedOuter${suffix}`,
  nestedInner: `TxnNestedInner${suffix}`,
  visibility: `TxnVisibility${suffix}`,
  gstore: `TxnGStore${suffix}`,
  gstoreAbort: `TxnGStoreAbort${suffix}`,
};

await using session = await Session.connect(Session.configFromEnv());

const root = PersistentRoot.userGlobals(session);

const result = {
  manualCommit: await manualCommitExample(session, root, names.manualCommit),
  manualAbort: await manualAbortExample(session, root, names.manualAbort),
  scopedCommit: await scopedCommitExample(session, root, names.scoped),
  scopedRollback: await scopedRollbackExample(session, root, names.scopedRollback),
  retryAfterConflict: await retryAfterConflictExample(session, root, names.retry),
  nestedRollback: await nestedRollbackExample(session, root, names.nestedOuter, names.nestedInner),
  crossSessionVisibility: await crossSessionVisibilityExample(session, root, names.visibility),
  gstoreSnapshot: await gstoreSnapshotExample(session, names.gstore),
  gstoreAbort: await gstoreAbortExample(session, names.gstoreAbort),
};

console.dir(result, { depth: null });

async function manualCommitExample(
  session: Session,
  root: PersistentRoot,
  name: string,
) {
  await removeExistingGlobals(session, [name]);

  const before = await root.has(name);
  const draft = await root.setDict(name, {
    status: "draft",
    customer: "Tariq",
    amount: 100,
    currency: "GBP",
  });

  await draft.setAllValue({
    status: "ready-to-commit",
    reviewed: true,
  });

  const beforeCommit = {
    existsInCurrentTransaction: await root.has(name),
    needsCommit: await optionalTransactionStatus(() => session.needsCommit()),
    draft: await draft.toObject({ maxEntries: 20 }),
  };

  await session.commit();

  return {
    before,
    beforeCommit,
    afterCommit: await root.getDictObject(name, { maxEntries: 20 }),
  };
}

async function manualAbortExample(
  session: Session,
  root: PersistentRoot,
  name: string,
) {
  await removeExistingGlobals(session, [name]);

  let dirtyBeforeAbort: boolean | string = false;
  let errorMessage = "";

  try {
    await root.setValue(name, "this value is intentionally discarded");
    dirtyBeforeAbort = await optionalTransactionStatus(() => session.needsCommit());
    throw new Error("application validation failed");
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    await session.abort();
  }

  return {
    dirtyBeforeAbort,
    errorMessage,
    existsAfterAbort: await root.has(name),
  };
}

async function scopedCommitExample(
  session: Session,
  root: PersistentRoot,
  name: string,
) {
  await removeExistingGlobals(session, [name]);

  const receipt = await session.withTransaction(async (transactionSession) => {
    const transactionRoot = PersistentRoot.userGlobals(transactionSession);
    await transactionRoot.setDict(name, {
      status: "committed-by-withTransaction",
      lineCount: 2,
      total: 100,
    });
    return {
      dirtyInsideCallback: await optionalTransactionStatus(() => transactionSession.needsCommit()),
      activeInsideCallback: await optionalTransactionStatus(() => transactionSession.inTransaction()),
    };
  });

  return {
    receipt,
    afterCallbackCommit: await root.getDictObject(name, { maxEntries: 20 }),
  };
}

async function scopedRollbackExample(
  session: Session,
  root: PersistentRoot,
  name: string,
) {
  await removeExistingGlobals(session, [name]);

  let callbackError = "";
  try {
    await session.withTransaction(async (transactionSession) => {
      await PersistentRoot.userGlobals(transactionSession).setDict(name, {
        status: "should-roll-back",
        reason: "callback throws",
      });
      throw new Error("withTransaction callback failed");
    });
  } catch (error) {
    callbackError = error instanceof Error ? error.message : String(error);
  }

  return {
    callbackError,
    existsAfterAutomaticAbort: await root.has(name),
  };
}

async function retryAfterConflictExample(
  session: Session,
  root: PersistentRoot,
  name: string,
) {
  await removeExistingGlobals(session, [name]);

  let workAttempts = 0;
  let commitAttempts = 0;
  const conflictReports: string[] = [];

  const value = await runTransactionWithRetry(
    async (transactionSession) => {
      workAttempts += 1;
      await PersistentRoot.userGlobals(transactionSession).setDict(name, {
        status: "committed-after-retry",
        workAttempt: workAttempts,
      });
      return `attempt-${workAttempts}`;
    },
    {
      session,
      attempts: 2,
      onConflict: async (retry) => {
        conflictReports.push(await retry.format(undefined, { includeSummaries: false }));
      },
      commit: async (transactionSession) => {
        commitAttempts += 1;
        if (commitAttempts === 1) {
          throw new CommitConflictError("simulated write/write conflict for transaction example");
        }
        await commitWithConflictDetails(transactionSession);
      },
    },
  );

  return {
    value,
    workAttempts,
    commitAttempts,
    conflictReports,
    afterRetryCommit: await root.getDictObject(name, { maxEntries: 20 }),
  };
}

async function nestedRollbackExample(
  session: Session,
  root: PersistentRoot,
  outerName: string,
  innerName: string,
) {
  await removeExistingGlobals(session, [outerName, innerName]);

  await root.setValue(outerName, "outer-before-nested");
  let nestedError = "";

  try {
    await nestedTransaction(session, async (nestedSession) => {
      await PersistentRoot.userGlobals(nestedSession).setValue(innerName, "nested-discarded");
      throw new Error("discard only the nested transaction");
    });
  } catch (error) {
    nestedError = error instanceof Error ? error.message : String(error);
  }

  await root.setValue(outerName, "outer-committed-after-nested-abort");
  await session.commit();

  return {
    nestedError,
    outerAfterCommit: await root.getValue(outerName),
    innerExistsAfterNestedAbort: await root.has(innerName),
  };
}

async function crossSessionVisibilityExample(
  session: Session,
  root: PersistentRoot,
  name: string,
) {
  await removeExistingGlobals(session, [name]);

  await root.setDict(name, {
    status: "uncommitted",
    phase: "current-session-only",
  });

  const beforeCommit = {
    currentSessionSeesIt: await root.has(name),
    secondSessionSeesIt: await secondSessionHas(name),
  };

  await session.commit();

  const afterCommit = {
    currentSessionValue: await root.getDictObject(name, { maxEntries: 20 }),
    secondSessionValue: await secondSessionDict(name),
  };

  return {
    beforeCommit,
    afterCommit,
  };
}

async function gstoreSnapshotExample(session: Session, name: string) {
  await GStore.remove(session, name);
  await session.commit().catch(() => undefined);

  const store = await GStore.open(session, name);

  const writeReceipt = await store.transaction((transaction) => {
    const before = transaction.toObject();
    transaction.setAll({
      status: "ready",
      invoice: {
        number: "INV-1001",
        amount: 100,
        currency: "GBP",
      },
    });
    return {
      before,
      dirtyBeforeCommit: transaction.dirty,
      keysBeforeCommit: transaction.keys(),
    };
  });

  const snapshot = await store.transaction(
    (transaction): Record<string, GStoreJsonValue> => transaction.toObject(),
    { readOnly: true },
  );

  return {
    writeReceipt,
    snapshot,
  };
}

async function gstoreAbortExample(session: Session, name: string) {
  await GStore.remove(session, name);
  await session.commit().catch(() => undefined);

  const store = await GStore.open(session, name);

  await store.transaction((transaction) => {
    transaction.set("keep", {
      status: "committed",
      amount: 100,
    });
  });

  const abortResult = await store.transaction((transaction) => {
    transaction.set("keep", {
      status: "discarded",
      amount: 999,
    });
    transaction.set("temporary", "discarded");
    throw new GStoreAbortTransaction("discard buffered GStore changes");
  });

  return {
    abortResult,
    snapshotAfterAbort: await store.transaction(
      (transaction): Record<string, GStoreJsonValue> => transaction.toObject(),
      { readOnly: true },
    ),
  };
}

async function removeExistingGlobals(session: Session, names: readonly string[]): Promise<void> {
  const removed = await PersistentRoot.userGlobals(session).removeAll(names);
  if (Object.values(removed).some(Boolean)) {
    await session.commit();
  } else {
    await session.abort().catch(() => undefined);
  }
}

async function secondSessionHas(name: string): Promise<boolean> {
  return Session.withEnv(async (session) => PersistentRoot.userGlobals(session).has(name));
}

async function secondSessionDict(name: string): Promise<Record<string, unknown> | null> {
  return Session.withEnv(async (session) => PersistentRoot.userGlobals(session).getDictObject(name, { maxEntries: 20 }));
}

async function optionalTransactionStatus<T>(read: () => Promise<T>): Promise<T | string> {
  try {
    return await read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `unavailable: ${message}`;
  }
}
