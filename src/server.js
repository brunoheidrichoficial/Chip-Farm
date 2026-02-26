const express = require("express");
const path = require("path");
const { config, routes, targetNetworks } = require("./config");
const db = require("./db");
const campaignsRouter = require("./api/campaigns");
const reportsRouter = require("./api/reports");
const telq = require("./telq");

const app = express();
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, "../public")));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ─── SendSpeed callback (preserved from callback-server.js) ───
app.post("/callback/sendspeed", (req, res) => {
  const callbacks = Array.isArray(req.body) ? req.body : [req.body];
  for (const cb of callbacks) {
    if (cb.messageId && cb.status) {
      console.log(`[SendSpeed Callback] traceId=${cb.messageId} status=${cb.status}`);
      db.updateSendspeedCallback(cb.messageId, cb.status);
    }
  }
  res.json({ ok: true });
});

// ─── API routes ───
app.use("/api/campaigns", campaignsRouter);
app.use("/api/reports", reportsRouter);

// Available routes
app.get("/api/routes", (req, res) => {
  res.json(routes.map((r) => ({ id: r.id, name: r.name, supplier: r.supplier, type: r.type })));
});

// Available networks (from config + optional TelQ live)
app.get("/api/networks", async (req, res) => {
  try {
    const live = await telq.getNetworks();
    res.json(live);
  } catch {
    // Fallback to configured networks
    res.json(targetNetworks);
  }
});

// Dashboard summary
app.get("/api/dashboard", (req, res) => {
  const latestRun = db.getLatestRun();
  const runs = db.getTestRuns(5);

  let summary = { latestRun: null, overallRate: 0, bestRoute: null, alerts: [], recentRuns: runs };

  if (latestRun) {
    const results = db.getRunResults(latestRun.id);
    const scores = db.getRunScores(latestRun.id);
    const total = results.length;
    const delivered = results.filter((r) => r.telq_status === "POSITIVE").length;
    const fakeDlrs = results.filter((r) => r.fake_dlr === 1).length;

    const best = scores.length ? scores.reduce((a, b) => (a.score > b.score ? a : b)) : null;

    const alerts = [];
    for (const s of scores) {
      if (s.delivery_rate < 80) alerts.push(`${s.route_name} → ${s.network_name}: ${s.delivery_rate}% entrega`);
      if (s.fake_dlr_rate > 5) alerts.push(`${s.route_name} → ${s.network_name}: ${s.fake_dlr_rate}% fake DLR`);
    }

    summary = {
      latestRun,
      totalTests: total,
      overallRate: total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0,
      fakeDlrs,
      bestRoute: best ? `${best.route_name} (${best.score})` : null,
      alerts,
      recentRuns: runs,
      scores,
    };
  }

  res.json(summary);
});

// Run test now (ad-hoc, uses all routes/networks)
app.post("/api/run-now", async (req, res) => {
  const { runFullTest } = require("./run-test");
  res.json({ ok: true, message: "Test started" });
  try {
    await runFullTest();
  } catch (err) {
    console.error("[API] Ad-hoc test failed:", err.message);
  }
});

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(config.callbackServer.port, () => {
      console.log(`[Server] listening on port ${config.callbackServer.port}`);
      console.log(`[Server] Dashboard: http://localhost:${config.callbackServer.port}`);
      resolve(server);
    });
  });
}

module.exports = { startServer, app };
