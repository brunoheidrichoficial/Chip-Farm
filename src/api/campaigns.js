const express = require("express");
const router = express.Router();
const db = require("../db");
const { routes, targetNetworks } = require("../config");

// List all campaigns
router.get("/", (req, res) => {
  const campaigns = db.getCampaigns();
  res.json(campaigns);
});

// Get single campaign
router.get("/:id", (req, res) => {
  const campaign = db.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  res.json(campaign);
});

// Create campaign
router.post("/", (req, res) => {
  const { name, routes: routeIds, networks, tests_per_combo, personal_numbers, cron_schedule } = req.body;
  if (!name || !routeIds || !networks) {
    return res.status(400).json({ error: "name, routes, and networks are required" });
  }
  const id = db.createCampaign({ name, routes: routeIds, networks, tests_per_combo, personal_numbers, cron_schedule });
  res.json({ id, ok: true });
});

// Update campaign
router.put("/:id", (req, res) => {
  const campaign = db.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  db.updateCampaign(req.params.id, req.body);
  res.json({ ok: true });
});

// Run a campaign's test
router.post("/:id/run", async (req, res) => {
  const campaign = db.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const campaignRoutes = JSON.parse(campaign.routes);
  const campaignNetworks = JSON.parse(campaign.networks);

  // Filter configured routes to only those in the campaign
  const selectedRoutes = routes.filter((r) => campaignRoutes.includes(r.id));
  const selectedNetworks = campaignNetworks.length
    ? campaignNetworks
    : targetNetworks;

  // Run test asynchronously
  const { runFullTest } = require("../run-test");
  res.json({ ok: true, message: "Test started" });

  try {
    await runFullTest({
      routes: selectedRoutes,
      networks: selectedNetworks,
      testsPerCombo: campaign.tests_per_combo || 1,
    });
  } catch (err) {
    console.error(`[API] Campaign ${campaign.id} test failed:`, err.message);
  }
});

module.exports = router;
