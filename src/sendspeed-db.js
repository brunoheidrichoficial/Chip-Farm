const mysql = require("mysql2/promise");
const { config } = require("./config");
const db = require("./db");

let pool = null;

function getPool() {
  if (pool) return pool;
  if (!config.sendspeedDb.host) return null;

  pool = mysql.createPool({
    host: config.sendspeedDb.host,
    port: config.sendspeedDb.port,
    user: config.sendspeedDb.user,
    password: config.sendspeedDb.password,
    database: config.sendspeedDb.database,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 3,
  });
  return pool;
}

/**
 * Fetch callback statuses from SendSpeed MySQL for a given run's trace_ids.
 * Updates local SQLite with the results.
 * Returns { updated, statuses } with count and distribution.
 */
async function fetchCallbacks(runId) {
  const p = getPool();
  if (!p) {
    console.log("[SendSpeed DB] Desabilitado (sem credenciais MySQL)");
    return { updated: 0, statuses: {} };
  }

  const results = db.getRunResults(runId);
  const traceIds = results.filter(r => r.trace_id).map(r => r.trace_id);
  if (!traceIds.length) return { updated: 0, statuses: {} };

  const placeholders = traceIds.map(() => "?").join(",");
  const [rows] = await p.query(
    `SELECT trace_id, supplier_status FROM sms_sent WHERE trace_id IN (${placeholders})`,
    traceIds
  );

  let updated = 0;
  const statuses = {};
  for (const row of rows) {
    const status = (row.supplier_status || "").toLowerCase();
    statuses[status] = (statuses[status] || 0) + 1;
    if (status) {
      db.updateSendspeedCallback(row.trace_id, status);
      updated++;
    }
  }

  console.log(`[SendSpeed DB] ${updated}/${traceIds.length} callbacks atualizados | ${JSON.stringify(statuses)}`);
  return { updated, statuses };
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { fetchCallbacks, close };
