const express = require("express");
const router = express.Router();
const db = require("../db");
const { getRouteTier } = require("../config");

// List test runs
router.get("/", (req, res) => {
  const runs = db.getTestRuns(parseInt(req.query.limit) || 20);
  res.json(runs);
});

// Aggregated results with filters
// GET /api/reports/aggregated?campaigns=1,2&dateFrom=2026-01-01&dateTo=2026-02-28&routes=1897,1900&networks=Claro,TIM
router.get("/aggregated", (req, res) => {
  const filters = {};

  if (req.query.campaigns) {
    filters.campaignIds = req.query.campaigns.split(",").map(Number).filter(Boolean);
  }
  if (req.query.dateFrom) {
    filters.dateFrom = req.query.dateFrom;
  }
  if (req.query.dateTo) {
    filters.dateTo = req.query.dateTo;
  }
  if (req.query.routes) {
    filters.routeIds = req.query.routes.split(",").map(Number).filter(Boolean);
  }
  if (req.query.networks) {
    filters.networkNames = req.query.networks.split(",").filter(Boolean);
  }
  if (req.query.tier) {
    filters.tier = req.query.tier;
  }

  const rows = db.getAggregatedResults(filters);

  // Compute rates and scores per row
  const results = rows.map((r) => {
    const deliveryRate = r.sent > 0 ? r.delivered / r.sent : 0;
    const fakeDlrRate = r.sent > 0 ? r.fake_dlrs / r.sent : 0;
    const latencyScore = r.avg_latency != null ? Math.max(0, 1 - r.avg_latency / 10) : 0.5;
    const score = Math.round((deliveryRate * 70 + (1 - fakeDlrRate) * 20 + latencyScore * 10) * 100) / 100;

    return {
      route_id: r.route_id,
      route_name: r.route_name,
      supplier: r.supplier,
      route_type: r.route_type,
      tier: r.tier || getRouteTier(r.route_id) || null,
      network_name: r.network_name,
      network_mcc: r.network_mcc,
      network_mnc: r.network_mnc,
      sent: r.sent,
      delivered: r.delivered,
      undelivered: r.undelivered,
      fake_dlrs: r.fake_dlrs,
      delivery_rate: Math.round(deliveryRate * 10000) / 100,
      fake_dlr_rate: Math.round(fakeDlrRate * 10000) / 100,
      avg_latency: r.avg_latency != null ? Math.round(r.avg_latency * 100) / 100 : null,
      score,
    };
  });

  res.json(results);
});

// Filter options — distinct routes and networks that exist in data
router.get("/filter-options", (req, res) => {
  const routes = db.getDistinctRoutes();
  const networks = db.getDistinctNetworks();
  res.json({ routes, networks });
});

// Get a specific run's full results
router.get("/:runId", (req, res) => {
  const run = db.getTestRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  const results = db.getRunResults(run.id);
  res.json({ run, results });
});

// Get scores for a run
router.get("/:runId/scores", (req, res) => {
  const run = db.getTestRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  const scores = db.getRunScores(run.id);
  res.json(scores);
});

module.exports = router;
