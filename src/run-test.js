const { config, routes, targetNetworks } = require("./config");
const telq = require("./telq");
const sendspeed = require("./sendspeed");
const db = require("./db");
const telegram = require("./telegram");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFullTest(campaignConfig) {
  const startTime = new Date();
  console.log(`\n[Test] Starting full test at ${startTime.toISOString()}`);

  // Use campaign config or defaults
  const testRoutes = (campaignConfig && campaignConfig.routes) || routes;
  const configNetworks = (campaignConfig && campaignConfig.networks) || targetNetworks;
  const testsPerCombo = (campaignConfig && campaignConfig.testsPerCombo) || 1;

  // 1. Create a new run
  const runId = db.createRun();
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

  // Filter to our target networks (only those available on TelQ right now)
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

  // 3. For each route x network combination, request TelQ number and send SMS
  const callbackUrl = `${config.callbackServer.publicUrl}/callback/sendspeed`;
  let testCount = 0;

  for (const route of testRoutes) {
    // Request test numbers from TelQ for all target networks at once (repeated per testsPerCombo)
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

      // Send SMS via SendSpeed with testIdText in the body
      const smsText = `Test ${tt.testIdText}`;
      let sendResult;
      try {
        sendResult = await sendspeed.sendSms(route, tt.phoneNumber, smsText, callbackUrl);
      } catch (err) {
        console.error(`[Test] SendSpeed send failed: route=${route.name} phone=${tt.phoneNumber}: ${err.message}`);
        sendResult = { success: false, error: err.message };
      }

      // Save to DB
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

      // Small delay between sends to avoid rate limiting
      await sleep(200);
    }
  }

  console.log(`\n[Test] All ${testCount} SMS sent. Waiting for results...`);
  await telegram.sendMessage(`🚀 Teste iniciado: ${testCount} SMS enviados por ${testRoutes.length} rotas x ${networksToTest.length} operadoras. Aguardando resultados...`);

  // 4. Poll TelQ for results
  console.log(`[Test] Polling TelQ for results (max ${config.test.maxPollAttempts} attempts)...`);

  for (let attempt = 1; attempt <= config.test.maxPollAttempts; attempt++) {
    await sleep(config.test.pollIntervalMs);

    const pending = db.getPendingTelqTests(runId);
    if (!pending.length) {
      console.log(`[Test] All results received at attempt ${attempt}`);
      break;
    }

    // Check each pending test
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

    const stillPending = pending.length - resolved;
    console.log(`[Test] Poll ${attempt}/${config.test.maxPollAttempts}: ${resolved} resolved, ${stillPending} pending`);

    if (stillPending === 0) break;
  }

  // 5. Mark remaining as NOT_DELIVERED and detect fake DLRs
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

  // Wait a bit more for any late SendSpeed callbacks
  await sleep(5000);

  db.markFakeDlrs(runId);
  db.finishRun(runId, testCount);

  // 6. Calculate scores
  const scores = db.calculateScores(runId);
  const results = db.getRunResults(runId);

  // 7. Send report via Telegram
  const report = telegram.formatReport(scores, results, runId);
  await telegram.sendMessage(report);

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
