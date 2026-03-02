const { config, routes, targetNetworks } = require("./config");
const telq = require("./telq");
const sendspeed = require("./sendspeed");
const db = require("./db");
const telegram = require("./telegram");
const sheets = require("./sheets");
const sendspeedDb = require("./sendspeed-db");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a flat list of { route, network, count } from the new campaign config format.
 * Handles route_mode qty/pct and network percentage distribution.
 */
function buildTestPlan(campaignConfig, availableNetworks) {
  const routeMode = campaignConfig.routeMode || campaignConfig.route_mode || "qty";
  const totalTests = campaignConfig.totalTests || campaignConfig.total_tests || 0;
  const configRoutes = campaignConfig.routes || [];
  const configNetworks = campaignConfig.networks || [];

  // Calculate absolute qty per route
  const routeQtys = [];
  for (const r of configRoutes) {
    let qty;
    if (routeMode === "pct") {
      qty = Math.round((totalTests * r.value) / 100);
    } else {
      qty = r.value || 1;
    }
    // r might be a full route object or just {id, value}
    const fullRoute = routes.find((fr) => fr.id === (r.id || r));
    if (fullRoute) {
      routeQtys.push({ route: fullRoute, qty });
    }
  }

  // Separate explicit networks from "other"
  const explicitNetworks = configNetworks.filter((n) => !n.other);
  const otherEntry = configNetworks.find((n) => n.other);

  // Filter explicit networks to those available on TelQ
  const validExplicit = explicitNetworks.filter((target) =>
    availableNetworks.some((n) => n.mcc === target.mcc && n.mnc === target.mnc && !n.portedFromMnc)
  );

  // For "other": find TelQ networks NOT in the explicit list
  let otherNetworks = [];
  if (otherEntry && otherEntry.percentage > 0) {
    const explicitKeys = new Set(explicitNetworks.map((n) => `${n.mcc}-${n.mnc}`));
    // Deduplicate available networks
    const seen = new Set();
    otherNetworks = availableNetworks.filter((n) => {
      const key = `${n.mcc}-${n.mnc}`;
      if (seen.has(key) || explicitKeys.has(key) || n.portedFromMnc) return false;
      seen.add(key);
      return true;
    });
  }

  // Build the plan
  const plan = [];

  for (const { route, qty } of routeQtys) {
    let remaining = qty;

    // Distribute among explicit networks by percentage
    for (const net of validExplicit) {
      const count = Math.round((qty * net.percentage) / 100);
      if (count > 0) {
        plan.push({ route, network: net, count });
        remaining -= count;
      }
    }

    // Distribute "other" among the other networks equally
    if (otherEntry && otherEntry.percentage > 0 && otherNetworks.length > 0) {
      const otherTotal = Math.round((qty * otherEntry.percentage) / 100);
      const perNetwork = Math.floor(otherTotal / otherNetworks.length);
      let otherRemaining = otherTotal;

      for (let i = 0; i < otherNetworks.length; i++) {
        const count = i === otherNetworks.length - 1 ? otherRemaining : perNetwork;
        if (count > 0) {
          plan.push({ route, network: otherNetworks[i], count });
          otherRemaining -= count;
        }
      }
    }
  }

  return plan;
}

async function runFullTest(campaignConfig) {
  const startTime = new Date();
  console.log(`\n[Test] Starting full test at ${startTime.toISOString()}`);

  // Detect new vs old format
  const isNewFormat = campaignConfig && (campaignConfig.routeMode || campaignConfig.route_mode);

  // 1. Create a new run (with campaign_id if available)
  const campaignId = campaignConfig && campaignConfig.campaignId;
  const runId = db.createRun(campaignId);
  console.log(`[Test] Run #${runId} created`);

  // 2. Get available TelQ networks for Brazil
  let availableNetworks;
  try {
    availableNetworks = await telq.getNetworks();
  } catch (err) {
    console.error(`[Test] Failed to get TelQ networks: ${err.message}`);
    await telegram.sendMessage(`❌ Teste falhou: nao consegui conectar na TelQ\n${err.message}`);
    return;
  }

  if (isNewFormat) {
    // ─── New format: granular distribution ───
    const plan = buildTestPlan(campaignConfig, availableNetworks);

    if (!plan.length) {
      console.error("[Test] No valid route/network combinations in plan");
      await telegram.sendMessage("❌ Teste falhou: nenhuma combinacao rota/operadora valida");
      return;
    }

    const totalDisparos = plan.reduce((s, p) => s + p.count, 0);
    console.log(`[Test] New format: ${plan.length} combos, ${totalDisparos} total dispatches`);
    for (const p of plan) {
      console.log(`[Test]   ${p.route.name} → ${p.network.name || "MNC-" + p.network.mnc}: ${p.count} tests`);
    }

    const callbackUrl = `${config.callbackServer.publicUrl}/callback/sendspeed`;
    let testCount = 0;

    for (const { route, network, count } of plan) {
      // Request test numbers from TelQ
      const destinations = [];
      for (let i = 0; i < count; i++) {
        destinations.push({ mcc: network.mcc, mnc: network.mnc });
      }

      let telqTests;
      try {
        telqTests = await telq.createTests(destinations);
      } catch (err) {
        console.error(`[Test] TelQ createTests failed for ${route.name} → ${network.name || network.mnc}: ${err.message}`);
        continue;
      }

      for (const tt of telqTests) {
        if (tt.errorMessage) {
          console.warn(`[Test] TelQ error for ${route.name} → ${tt.destinationNetwork?.mnc}: ${tt.errorMessage}`);
          continue;
        }

        const smsText = `Test ${tt.testIdText}`;
        let sendResult;
        try {
          sendResult = await sendspeed.sendSms(route, tt.phoneNumber, smsText, callbackUrl);
        } catch (err) {
          console.error(`[Test] SendSpeed send failed: route=${route.name} phone=${tt.phoneNumber}: ${err.message}`);
          sendResult = { success: false, error: err.message };
        }

        db.insertResult({
          runId,
          routeId: route.id,
          routeName: route.name,
          supplier: route.supplier,
          routeType: route.type,
          traceId: sendResult.trace_id || null,
          telqTestId: tt.id,
          telqPhone: tt.phoneNumber,
          telqTestIdText: tt.testIdText,
          networkMcc: tt.destinationNetwork.mcc,
          networkMnc: tt.destinationNetwork.mnc,
          networkName: network.name || `MNC-${tt.destinationNetwork.mnc}`,
        });

        testCount++;
        console.log(`[Test] ${testCount}/${totalDisparos} | ${route.name} → ${network.name || network.mnc} (${tt.phoneNumber}) | trace=${sendResult.trace_id || "FAIL"}`);

        await sleep(200);
      }
    }

    console.log(`\n[Test] All ${testCount} SMS sent. Waiting for results...`);
    await telegram.sendMessage(`🚀 Teste iniciado: ${testCount} SMS enviados. Aguardando resultados...`);

  } else {
    // ─── Legacy format: tests_per_combo ───
    const testRoutes = (campaignConfig && campaignConfig.routes) || routes;
    const configNetworks = (campaignConfig && campaignConfig.networks) || targetNetworks;
    const testsPerCombo = (campaignConfig && campaignConfig.testsPerCombo) || 1;

    const networksToTest = configNetworks.filter((target) =>
      availableNetworks.some((n) => n.mcc === target.mcc && n.mnc === target.mnc && !n.portedFromMnc)
    );

    if (!networksToTest.length) {
      console.error("[Test] No target networks available on TelQ right now");
      await telegram.sendMessage("❌ Teste falhou: nenhuma operadora alvo disponivel na TelQ agora");
      return;
    }

    console.log(`[Test] Networks available: ${networksToTest.map((n) => n.name).join(", ")}`);
    console.log(`[Test] Routes to test: ${testRoutes.length}`);
    console.log(`[Test] Tests per combo: ${testsPerCombo}`);
    console.log(`[Test] Total combinations: ${testRoutes.length * networksToTest.length * testsPerCombo}`);

    const callbackUrl = `${config.callbackServer.publicUrl}/callback/sendspeed`;
    let testCount = 0;

    for (const route of testRoutes) {
      const destinations = [];
      for (let i = 0; i < testsPerCombo; i++) {
        for (const n of networksToTest) {
          destinations.push({ mcc: n.mcc, mnc: n.mnc });
        }
      }

      let telqTests;
      try {
        telqTests = await telq.createTests(destinations);
      } catch (err) {
        console.error(`[Test] TelQ createTests failed for route ${route.name}: ${err.message}`);
        continue;
      }

      for (const tt of telqTests) {
        if (tt.errorMessage) {
          console.warn(`[Test] TelQ error for ${route.name} → ${tt.destinationNetwork?.mnc}: ${tt.errorMessage}`);
          continue;
        }

        const network = networksToTest.find((n) => n.mnc === tt.destinationNetwork.mnc) || {
          name: `MNC-${tt.destinationNetwork.mnc}`,
        };

        const smsText = `Test ${tt.testIdText}`;
        let sendResult;
        try {
          sendResult = await sendspeed.sendSms(route, tt.phoneNumber, smsText, callbackUrl);
        } catch (err) {
          console.error(`[Test] SendSpeed send failed: route=${route.name} phone=${tt.phoneNumber}: ${err.message}`);
          sendResult = { success: false, error: err.message };
        }

        db.insertResult({
          runId,
          routeId: route.id,
          routeName: route.name,
          supplier: route.supplier,
          routeType: route.type,
          traceId: sendResult.trace_id || null,
          telqTestId: tt.id,
          telqPhone: tt.phoneNumber,
          telqTestIdText: tt.testIdText,
          networkMcc: tt.destinationNetwork.mcc,
          networkMnc: tt.destinationNetwork.mnc,
          networkName: network.name,
        });

        testCount++;
        console.log(`[Test] ${testCount} | ${route.name} → ${network.name} (${tt.phoneNumber}) | trace=${sendResult.trace_id || "FAIL"}`);

        await sleep(200);
      }
    }

    console.log(`\n[Test] All ${testCount} SMS sent. Waiting for results...`);
    await telegram.sendMessage(`🚀 Teste iniciado: ${testCount} SMS enviados por ${testRoutes.length} rotas x ${networksToTest.length} operadoras. Aguardando resultados...`);
  }

  // 4. Poll TelQ for results + fetch SendSpeed callbacks periodically
  console.log(`[Test] Polling TelQ for results (max ${config.test.maxPollAttempts} attempts)...`);

  let lastSheetsPush = 0;
  const SHEETS_PUSH_INTERVAL = 120000; // push parcial a cada 2 min

  for (let attempt = 1; attempt <= config.test.maxPollAttempts; attempt++) {
    await sleep(config.test.pollIntervalMs);

    const pending = db.getPendingTelqTests(runId);
    if (!pending.length) {
      console.log(`[Test] All results received at attempt ${attempt}`);
      break;
    }

    let resolved = 0;
    for (const p of pending) {
      try {
        const result = await telq.getTestResult(p.telq_test_id);

        if (result.receiptStatus && result.receiptStatus !== "WAIT") {
          db.updateTelqResult(p.telq_test_id, {
            status: result.receiptStatus,
            receivedAt: result.smsReceivedAt || null,
            delay: result.receiptDelay || null,
            textDelivered: result.textDelivered || null,
            senderDelivered: result.senderDelivered || null,
          });
          resolved++;
        }
      } catch (err) {
        // Ignore individual poll errors, will retry next round
      }
    }

    // Fetch SendSpeed callbacks from MySQL periodically
    if (attempt % 4 === 0) {
      try {
        await sendspeedDb.fetchCallbacks(runId);
      } catch (err) {
        console.warn(`[Test] SendSpeed DB fetch failed: ${err.message}`);
      }
    }

    // Push parcial to Sheets every ~2 min
    const now = Date.now();
    if (now - lastSheetsPush >= SHEETS_PUSH_INTERVAL) {
      try {
        const partialResults = db.getRunResults(runId);
        const partialDelivered = partialResults.filter(r => r.telq_status === "POSITIVE").length;
        const partialCb = partialResults.filter(r => r.sendspeed_status).length;
        console.log(`[Test] Sheets parcial: ${partialDelivered} delivered, ${partialCb} callbacks`);
        // Will do full push at end — parcial just logs progress
        lastSheetsPush = now;
      } catch (err) {
        // Non-critical
      }
    }

    const stillPending = pending.length - resolved;
    console.log(`[Test] Poll ${attempt}/${config.test.maxPollAttempts}: ${resolved} resolved, ${stillPending} pending`);

    if (stillPending === 0) break;
  }

  // 5. Mark remaining as NOT_DELIVERED
  const finalPending = db.getPendingTelqTests(runId);
  for (const p of finalPending) {
    db.updateTelqResult(p.telq_test_id, {
      status: "NOT_DELIVERED",
      receivedAt: null,
      delay: null,
      textDelivered: null,
      senderDelivered: null,
    });
  }

  await sleep(5000);

  // 6. Final fetch of SendSpeed callbacks from MySQL
  try {
    await sendspeedDb.fetchCallbacks(runId);
  } catch (err) {
    console.warn(`[Test] Final SendSpeed DB fetch failed: ${err.message}`);
  }

  // 7. Detect fake DLRs (now with real callback data)
  db.markFakeDlrs(runId);

  const results = db.getRunResults(runId);
  const testCount = results.length;
  db.finishRun(runId, testCount);

  // 8. Calculate scores
  const scores = db.calculateScores(runId);

  // 9. Send report via Telegram
  const report = telegram.formatReport(scores, results, runId);
  await telegram.sendMessage(report);

  // 10. Push final to Google Sheets
  try {
    await sheets.pushResults(scores, results, runId);
  } catch (err) {
    console.error("[Test] Sheets push failed:", err.message);
  }

  const duration = ((Date.now() - startTime.getTime()) / 1000 / 60).toFixed(1);
  console.log(`\n[Test] Run #${runId} complete. ${testCount} tests in ${duration} min.`);

  return { runId, testCount, scores };
}

// Allow running directly: node src/run-test.js
if (require.main === module) {
  const { startServer } = require("./server");
  startServer().then(() => {
    runFullTest()
      .then((result) => {
        console.log("[Test] Done:", result ? `${result.testCount} tests` : "failed");
        process.exit(0);
      })
      .catch((err) => {
        console.error("[Test] Fatal:", err);
        process.exit(1);
      });
  });
}

module.exports = { runFullTest };
