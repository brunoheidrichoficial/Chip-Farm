const Database = require("better-sqlite3");
const path = require("path");
const { getRouteTier } = require("./config");

const DB_PATH = path.resolve(__dirname, "../chipfarm.db");
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initTables();
    migrateTier();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      total_tests INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      campaign_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS test_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),

      -- SendSpeed side
      route_id INTEGER NOT NULL,
      route_name TEXT NOT NULL,
      supplier TEXT NOT NULL,
      route_type TEXT NOT NULL,
      trace_id TEXT,
      sendspeed_status TEXT,
      sendspeed_callback_at TEXT,

      -- TelQ side
      telq_test_id INTEGER,
      telq_phone TEXT,
      telq_test_id_text TEXT,
      telq_status TEXT,
      telq_received_at TEXT,
      telq_delay_seconds REAL,
      telq_text_delivered TEXT,
      telq_sender_delivered TEXT,

      -- Network
      network_mcc TEXT,
      network_mnc TEXT,
      network_name TEXT,

      -- Computed
      fake_dlr INTEGER DEFAULT 0,

      FOREIGN KEY (run_id) REFERENCES test_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_results_run ON test_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_results_trace ON test_results(trace_id);
    CREATE INDEX IF NOT EXISTS idx_results_telq ON test_results(telq_test_id);

    CREATE TABLE IF NOT EXISTS route_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now')),
      run_id INTEGER,
      route_id INTEGER NOT NULL,
      route_name TEXT NOT NULL,
      supplier TEXT NOT NULL,
      network_name TEXT NOT NULL,
      delivery_rate REAL,
      avg_latency REAL,
      fake_dlr_rate REAL,
      score REAL,
      sample_size INTEGER
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      routes TEXT NOT NULL,
      networks TEXT NOT NULL,
      tests_per_combo INTEGER DEFAULT 1,
      route_mode TEXT DEFAULT 'qty',
      total_tests INTEGER,
      personal_numbers TEXT,
      cron_schedule TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1
    );
  `);
}

function migrateTier() {
  // Add tier column to test_results and route_scores (idempotent)
  try { db.exec("ALTER TABLE test_results ADD COLUMN tier TEXT"); } catch (e) { /* column already exists */ }
  try { db.exec("ALTER TABLE route_scores ADD COLUMN tier TEXT"); } catch (e) { /* column already exists */ }

  // Backfill existing data based on route_id → tier mapping
  const tierMap = {
    GOLD: [1897, 1898, 1909],
    PLATINUM: [1910, 1900],
    DIAMOND: [1903, 1899, 1905],
    SILVER: [1901],
    OTP: [1902, 1904, 1906],
  };
  for (const [tier, ids] of Object.entries(tierMap)) {
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`UPDATE test_results SET tier = ? WHERE tier IS NULL AND route_id IN (${placeholders})`).run(tier, ...ids);
    db.prepare(`UPDATE route_scores SET tier = ? WHERE tier IS NULL AND route_id IN (${placeholders})`).run(tier, ...ids);
  }
}

// Insert a new test run
function createRun(campaignId) {
  if (campaignId) {
    const stmt = getDb().prepare("INSERT INTO test_runs (started_at, campaign_id) VALUES (datetime('now'), ?)");
    return stmt.run(campaignId).lastInsertRowid;
  }
  const stmt = getDb().prepare("INSERT INTO test_runs (started_at) VALUES (datetime('now'))");
  return stmt.run().lastInsertRowid;
}

function finishRun(runId, totalTests) {
  getDb().prepare("UPDATE test_runs SET finished_at = datetime('now'), total_tests = ?, status = 'done' WHERE id = ?").run(totalTests, runId);
}

// Insert a test result row (initially just the SendSpeed + TelQ request data)
function insertResult(data) {
  const stmt = getDb().prepare(`
    INSERT INTO test_results (run_id, route_id, route_name, supplier, route_type, trace_id, telq_test_id, telq_phone, telq_test_id_text, network_mcc, network_mnc, network_name, tier)
    VALUES (@runId, @routeId, @routeName, @supplier, @routeType, @traceId, @telqTestId, @telqPhone, @telqTestIdText, @networkMcc, @networkMnc, @networkName, @tier)
  `);
  return stmt.run({ ...data, tier: data.tier || getRouteTier(data.routeId) || null }).lastInsertRowid;
}

// Update with SendSpeed callback
function updateSendspeedCallback(traceId, status) {
  getDb().prepare("UPDATE test_results SET sendspeed_status = ?, sendspeed_callback_at = datetime('now') WHERE trace_id = ?").run(status, traceId);
}

// Update with TelQ result
function updateTelqResult(telqTestId, data) {
  getDb().prepare(`
    UPDATE test_results SET
      telq_status = @status,
      telq_received_at = @receivedAt,
      telq_delay_seconds = @delay,
      telq_text_delivered = @textDelivered,
      telq_sender_delivered = @senderDelivered
    WHERE telq_test_id = @telqTestId
  `).run({ telqTestId, ...data });
}

// Mark fake DLRs (SendSpeed says delivered but TelQ never received)
function markFakeDlrs(runId) {
  getDb().prepare(`
    UPDATE test_results SET fake_dlr = 1
    WHERE run_id = ? AND sendspeed_status = 'delivered' AND (telq_status IS NULL OR telq_status != 'POSITIVE')
  `).run(runId);
}

// Get all results for a run
function getRunResults(runId) {
  return getDb().prepare("SELECT * FROM test_results WHERE run_id = ? ORDER BY route_id, network_name").all(runId);
}

// Get results for last N days for trend analysis
function getRecentResults(days = 7) {
  return getDb().prepare(`
    SELECT * FROM test_results
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
  `).all(days);
}

// Calculate and store route scores
function calculateScores(runId) {
  const results = getRunResults(runId);
  if (!results.length) return [];

  // Clear existing scores for this run to avoid duplicates on recalculation
  getDb().prepare("DELETE FROM route_scores WHERE run_id = ?").run(runId);

  const groups = {};
  for (const r of results) {
    const key = `${r.route_id}__${r.network_name}`;
    if (!groups[key]) groups[key] = { ...r, tests: [] };
    groups[key].tests.push(r);
  }

  const scores = [];
  const insertScore = getDb().prepare(`
    INSERT INTO route_scores (run_id, route_id, route_name, supplier, network_name, delivery_rate, avg_latency, fake_dlr_rate, score, sample_size, tier)
    VALUES (@runId, @routeId, @routeName, @supplier, @networkName, @deliveryRate, @avgLatency, @fakeDlrRate, @score, @sampleSize, @tier)
  `);

  const insertMany = getDb().transaction((items) => {
    for (const item of items) insertScore.run(item);
  });

  for (const [, group] of Object.entries(groups)) {
    const tests = group.tests;
    const total = tests.length;
    const delivered = tests.filter((t) => t.telq_status === "POSITIVE").length;
    const fakeDlrs = tests.filter((t) => t.fake_dlr === 1).length;
    const latencies = tests.filter((t) => t.telq_delay_seconds != null).map((t) => t.telq_delay_seconds);
    const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

    // Weighted delivery: principal carriers (Claro/Vivo/TIM) = 1.0, MNC = 0.5
    const PRINCIPAL = ["Claro", "Vivo", "TIM"];
    let weightedDelivered = 0, weightedTotal = 0;
    for (const t of tests) {
      const w = PRINCIPAL.includes(t.network_name) ? 1.0 : 0.5;
      weightedTotal += w;
      if (t.telq_status === "POSITIVE") weightedDelivered += w;
    }
    const deliveryRate = weightedTotal > 0 ? weightedDelivered / weightedTotal : 0;
    const fakeDlrRate = total > 0 ? fakeDlrs / total : 0;

    // Tiered latency: <30s=1.0, 30-60s=0.8, 60-90s=0.5, 90-120s=0.25, >120s=0.0
    function latencyTier(s) {
      if (s < 30) return 1.0;
      if (s < 60) return 0.8;
      if (s < 90) return 0.5;
      if (s < 120) return 0.25;
      return 0.0;
    }
    const latencyScores = latencies.map(latencyTier);
    const latencyScore = latencyScores.length ? latencyScores.reduce((a, b) => a + b, 0) / latencyScores.length : 0;

    // Score = Entrega Ponderada (80) + Latência Escalonada (15) + Anti-FakeDLR (5)
    const score = Math.round((deliveryRate * 80 + latencyScore * 15 + (1 - fakeDlrRate) * 5) * 100) / 100;

    const entry = {
      runId,
      routeId: group.route_id,
      routeName: group.route_name,
      supplier: group.supplier,
      networkName: group.network_name,
      deliveryRate: Math.round(deliveryRate * 10000) / 100,
      avgLatency: avgLatency != null ? Math.round(avgLatency * 100) / 100 : null,
      fakeDlrRate: Math.round(fakeDlrRate * 10000) / 100,
      score,
      sampleSize: total,
      tier: group.tier || getRouteTier(group.route_id) || null,
    };
    scores.push(entry);
  }

  insertMany(scores);
  return scores;
}

// Get pending TelQ test IDs for a run (still waiting)
function getPendingTelqTests(runId) {
  return getDb().prepare("SELECT id, telq_test_id FROM test_results WHERE run_id = ? AND telq_status IS NULL AND telq_test_id IS NOT NULL").all(runId);
}

// ─── Campaign CRUD ───

function getCampaigns() {
  return getDb().prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all();
}

function getCampaign(id) {
  return getDb().prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
}

function createCampaign(data) {
  const stmt = getDb().prepare(`
    INSERT INTO campaigns (name, routes, networks, tests_per_combo, route_mode, total_tests, personal_numbers, cron_schedule)
    VALUES (@name, @routes, @networks, @testsPerCombo, @routeMode, @totalTests, @personalNumbers, @cronSchedule)
  `);
  return stmt.run({
    name: data.name,
    routes: JSON.stringify(data.routes),
    networks: JSON.stringify(data.networks),
    testsPerCombo: data.tests_per_combo || 1,
    routeMode: data.route_mode || 'qty',
    totalTests: data.total_tests || null,
    personalNumbers: data.personal_numbers ? JSON.stringify(data.personal_numbers) : null,
    cronSchedule: data.cron_schedule || null,
  }).lastInsertRowid;
}

function updateCampaign(id, data) {
  const stmt = getDb().prepare(`
    UPDATE campaigns SET name = @name, routes = @routes, networks = @networks,
    tests_per_combo = @testsPerCombo, route_mode = @routeMode, total_tests = @totalTests,
    personal_numbers = @personalNumbers, cron_schedule = @cronSchedule, active = @active WHERE id = @id
  `);
  return stmt.run({
    id,
    name: data.name,
    routes: JSON.stringify(data.routes),
    networks: JSON.stringify(data.networks),
    testsPerCombo: data.tests_per_combo || 1,
    routeMode: data.route_mode || 'qty',
    totalTests: data.total_tests || null,
    personalNumbers: data.personal_numbers ? JSON.stringify(data.personal_numbers) : null,
    cronSchedule: data.cron_schedule || null,
    active: data.active !== undefined ? data.active : 1,
  });
}

// ─── Filtered aggregated results ───

function getAggregatedResults(filters = {}) {
  let where = "1=1";
  const params = [];

  if (filters.campaignIds && filters.campaignIds.length) {
    const placeholders = filters.campaignIds.map(() => "?").join(",");
    where += ` AND r.campaign_id IN (${placeholders})`;
    params.push(...filters.campaignIds);
  }

  if (filters.dateFrom) {
    where += " AND tr.created_at >= ?";
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    where += " AND tr.created_at <= ?";
    params.push(filters.dateTo + " 23:59:59");
  }

  if (filters.routeIds && filters.routeIds.length) {
    const placeholders = filters.routeIds.map(() => "?").join(",");
    where += ` AND tr.route_id IN (${placeholders})`;
    params.push(...filters.routeIds);
  }

  if (filters.networkNames && filters.networkNames.length) {
    const placeholders = filters.networkNames.map(() => "?").join(",");
    where += ` AND tr.network_name IN (${placeholders})`;
    params.push(...filters.networkNames);
  }

  if (filters.tier) {
    where += " AND tr.tier = ?";
    params.push(filters.tier);
  }

  const sql = `
    SELECT
      tr.route_id, tr.route_name, tr.supplier, tr.route_type, tr.tier,
      tr.network_mcc, tr.network_mnc, tr.network_name,
      COUNT(*) as sent,
      SUM(CASE WHEN tr.telq_status = 'POSITIVE' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN tr.telq_status != 'POSITIVE' OR tr.telq_status IS NULL THEN 1 ELSE 0 END) as undelivered,
      SUM(CASE WHEN tr.fake_dlr = 1 THEN 1 ELSE 0 END) as fake_dlrs,
      AVG(CASE WHEN tr.telq_delay_seconds IS NOT NULL THEN tr.telq_delay_seconds END) as avg_latency
    FROM test_results tr
    JOIN test_runs r ON tr.run_id = r.id
    WHERE ${where}
    GROUP BY tr.route_id, tr.route_name, tr.supplier, tr.tier, tr.network_name
    ORDER BY tr.route_name, tr.network_name
  `;

  return getDb().prepare(sql).all(...params);
}

// Get distinct network names from test results
function getDistinctNetworks() {
  return getDb().prepare("SELECT DISTINCT network_name FROM test_results WHERE network_name IS NOT NULL ORDER BY network_name").all().map(r => r.network_name);
}

// Get distinct routes from test results
function getDistinctRoutes() {
  return getDb().prepare("SELECT DISTINCT route_id, route_name, supplier FROM test_results ORDER BY route_name").all();
}

function getAllResults() {
  return getDb().prepare("SELECT * FROM test_results ORDER BY run_id, route_id, network_name").all();
}

// ─── Report queries ───

function getTestRuns(limit = 20) {
  return getDb().prepare("SELECT * FROM test_runs ORDER BY id DESC LIMIT ?").all(limit);
}

function getTestRun(id) {
  return getDb().prepare("SELECT * FROM test_runs WHERE id = ?").get(id);
}

function getRunScores(runId) {
  return getDb().prepare("SELECT * FROM route_scores WHERE run_id = ? ORDER BY network_name, score DESC").all(runId);
}

function getLatestRun() {
  return getDb().prepare("SELECT * FROM test_runs ORDER BY id DESC LIMIT 1").get();
}

module.exports = {
  getDb,
  createRun,
  finishRun,
  insertResult,
  updateSendspeedCallback,
  updateTelqResult,
  markFakeDlrs,
  getRunResults,
  getRecentResults,
  calculateScores,
  getPendingTelqTests,
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  getTestRuns,
  getTestRun,
  getRunScores,
  getLatestRun,
  getAggregatedResults,
  getDistinctNetworks,
  getDistinctRoutes,
  getAllResults,
};
