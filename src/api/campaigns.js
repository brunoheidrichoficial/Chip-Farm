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
  const { name, routes: routeData, networks } = req.body;
  if (!name || !routeData || !networks) {
    return res.status(400).json({ error: "name, routes, and networks are required" });
  }
  const id = db.createCampaign(req.body);
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

  const { runFullTest } = require("../run-test");
  res.json({ ok: true, message: "Test started" });

  try {
    // Detect new format: routes are objects with {id, value} and campaign has route_mode
    const isNewFormat = campaignRoutes.length > 0 && typeof campaignRoutes[0] === "object";

    if (isNewFormat) {
      await runFullTest({
        campaignId: campaign.id,
        route_mode: campaign.route_mode || "qty",
        total_tests: campaign.total_tests,
        routes: campaignRoutes,
        networks: campaignNetworks,
      });
    } else {
      const selectedRoutes = routes.filter((r) => campaignRoutes.includes(r.id));
      const selectedNetworks = campaignNetworks.length ? campaignNetworks : targetNetworks;

      await runFullTest({
        campaignId: campaign.id,
        routes: selectedRoutes,
        networks: selectedNetworks,
        testsPerCombo: campaign.tests_per_combo || 1,
      });
    }
  } catch (err) {
    console.error(`[API] Campaign ${campaign.id} test failed:`, err.message);
  }
});

module.exports = router;
