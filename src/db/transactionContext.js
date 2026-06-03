const { AsyncLocalStorage } = require("node:async_hooks");
const { pool } = require("./pool");

const transactionStore = new AsyncLocalStorage();

/**
 * Active transaction client for the current async context, if any.
 */
function getTransactionClient() {
  return transactionStore.getStore()?.client ?? null;
}

/**
 * Run work inside BEGIN/COMMIT (or participate in an outer transaction).
 * All storage queries in the callback use the same connection via AsyncLocalStorage.
 */
async function withTransaction(fn) {
  const existing = getTransactionClient();
  if (existing) {
    return fn();
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await transactionStore.run({ client }, fn);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { getTransactionClient, withTransaction };
