const express = require("express");
const router = express.Router();
const db = require("../db");

// List test runs
router.get("/", (req, res) => {
  const runs = db.getTestRuns(parseInt(req.query.limit) || 20);
  res.json(runs);
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
