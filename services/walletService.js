// services/walletService.js
const { v4: uuidv4 } = require('uuid');
const db = require('../db'); // adapt path to your db export (pg pool)

/**
 * getWalletBalance(client_id)
 * returns: { balance, held, available }
 * Note: held = 0 for now (holds implemented later). available = balance - held
 */
async function getWalletBalance(client_id) {
  const r = await db.query(
    `SELECT amount FROM client_wallets WHERE client_id = $1 LIMIT 1`,
    [client_id]
  );
  const balance = r.rows.length ? Number(r.rows[0].amount) : 0.0;
  return { balance, held: 0.0, available: balance };
}

/**
 * getWalletTransactions(client_id, opts)
 * opts: { limit=50, offset=0, from, to, type }
 */
async function getWalletTransactions(client_id, opts = {}) {
  const { limit = 50, offset = 0, from, to, type } = opts;
  const params = [client_id];
  let idx = 2;
  let where = 'WHERE client_id = $1';

  if (type) {
    where += ` AND tr_type = $${idx++}`;
    params.push(type);
  }
  if (from) {
    where += ` AND updated_at >= $${idx++}`;
    params.push(from);
  }
  if (to) {
    where += ` AND updated_at <= $${idx++}`;
    params.push(to);
  }

  params.push(Number(limit));
  params.push(Number(offset));

  const q = `
    SELECT id, client_id, amount, tr_type, balance_after, description, updated_at
    FROM wallet_transactions
    ${where}
    ORDER BY updated_at DESC
    LIMIT $${idx++} OFFSET $${idx++}
  `;

  const r = await db.query(q, params);
  return r.rows;
}

/**
 * createWalletTransaction(txClient, payload)
 * - txClient: a pg client inside an open transaction (required)
 * - payload: { client_id, tr_type, amount, balance_after, description, idempotency_key (opt), reference_type, reference_id, created_by }
 *
 * returns created wallet_transactions row
 */
async function createWalletTransaction(txClient, payload) {
  if (!txClient) throw new Error('createWalletTransaction requires txClient (BEGIN transaction).');
  const {
    client_id,
    tr_type,
    amount,
    balance_after,
    description = '',
    idempotency_key = null,
    reference_type = null,
    reference_id = null,
    created_by = null,
  } = payload;

  // idempotency handling: if idempotency_key provided, try to return existing txn
  if (idempotency_key) {
    const check = await txClient.query(
      `SELECT * FROM wallet_transactions WHERE idempotency_key = $1 LIMIT 1`,
      [idempotency_key]
    );
    if (check.rows.length) return check.rows[0];
  }

  const id = uuidv4();
  const insertQ = `
    INSERT INTO wallet_transactions
      (id, client_id, amount, tr_type, balance_after, description, reference_type, reference_id, idempotency_key, created_by, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    RETURNING *
  `;
  const vals = [id, client_id, amount, tr_type, balance_after, description, reference_type, reference_id, idempotency_key, created_by];
  const r = await txClient.query(insertQ, vals);
  return r.rows[0];
}

/**
 * upsertWallet(client_id, delta_amount, options)
 * - delta_amount: positive to credit, negative to debit
 * - options: { reference_type, reference_id, description, idempotency_key, created_by }
 *
 * This function encapsulates:
 * BEGIN -> SELECT FOR UPDATE client_wallets -> insert row if not exists -> compute new balance -> UPDATE client_wallets -> INSERT wallet_transactions -> COMMIT
 *
 * Returns: { balance_after, txn }
 */
async function upsertWallet(client_id, delta_amount, options = {}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // fetch or create wallet row
    const sel = await client.query(
      `SELECT id, amount FROM client_wallets WHERE client_id = $1 FOR UPDATE`,
      [client_id]
    );

    if (sel.rows.length === 0) {
      // create wallet row if absent
      const wid = uuidv4();
      await client.query(
        `INSERT INTO client_wallets (id, client_id, amount, updated_at) VALUES ($1,$2,$3,NOW())`,
        [wid, client_id, 0.0]
      );
    }

    // re-select after potentially inserting
    const cur = await client.query(
      `SELECT id, amount FROM client_wallets WHERE client_id = $1 FOR UPDATE`,
      [client_id]
    );
    const current = cur.rows[0];
    const curAmount = Number(current.amount || 0);
    const newAmount = Number((curAmount + Number(delta_amount)).toFixed(2));

    // do not allow negative balance (unless you want overdraft)
    if (newAmount < 0) {
      await client.query('ROLLBACK');
      return { error: 'INSUFFICIENT_FUNDS', balance: curAmount };
    }

    // update wallet balance
    await client.query(
      `UPDATE client_wallets SET amount = $1, updated_at = NOW() WHERE client_id = $2`,
      [newAmount, client_id]
    );

    // create txn
    const tr_type = Number(delta_amount) >= 0 ? 'credit' : 'debit';
    const desc = options.description || (tr_type === 'credit' ? 'Wallet credit' : 'Wallet debit');

    const txn = await createWalletTransaction(client, {
      client_id,
      tr_type,
      amount: Math.abs(Number(delta_amount)),
      balance_after: newAmount,
      description: desc,
      idempotency_key: options.idempotency_key || null,
      reference_type: options.reference_type || null,
      reference_id: options.reference_id || null,
      created_by: options.created_by || null,
    });

    await client.query('COMMIT');
    return { balance_after: newAmount, txn };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getWalletBalance,
  getWalletTransactions,
  createWalletTransaction,
  upsertWallet,
};
