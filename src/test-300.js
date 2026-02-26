const telq = require("./telq");
const sendspeed = require("./sendspeed");
const { routes } = require("./config");
const telegram = require("./telegram");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TEST_ROUTES = [
  routes.find((r) => r.id === 1897), // Pushfy v2 Principal
  routes.find((r) => r.id === 1898), // Sona V2 (bet3)
  routes.find((r) => r.id === 1909), // Infobip Blend 35
];

const PERSONAL_NUMBERS = [
  { phone: "5511982060158", name: "SP" },
  { phone: "5521966110808", name: "RJ" },
  { phone: "5551986090147", name: "Bruno" },
];

const NETWORKS = [
  { mcc: "724", mnc: "05", name: "Claro", count: 33 },
  { mcc: "724", mnc: "06", name: "Vivo", count: 33 },
  { mcc: "724", mnc: "02", name: "TIM", count: 34 },
];

(async () => {
  const startTime = Date.now();
  console.log("=== TESTE 300 ENVIOS ===");
  console.log("Rotas:", TEST_ROUTES.map((r) => r.name).join(", "));
  console.log("Operadoras: Claro (33), Vivo (33), TIM (34)");
  console.log("");

  await telegram.sendMessage(
    "🚀 <b>TESTE GRANDE INICIADO</b>\n\n" +
      "300 envios TelQ + 9 SMS pessoais\n" +
      "Rotas: Pushfy v2, Sona bet3, Infobip Blend 35\n" +
      "Operadoras: Claro, Vivo, TIM\n\n" +
      "Aguarde o relatorio..."
  );

  // Store all test data
  const allTests = []; // { route, network, telqTestId, telqPhone, testIdText, traceId, telqStatus, delay }

  // 1. For each route, request TelQ numbers and send SMS
  for (const route of TEST_ROUTES) {
    console.log(`\n--- ${route.name} ---`);

    for (const net of NETWORKS) {
      console.log(`  ${net.name}: requesting ${net.count} test numbers...`);

      // TelQ batch max is 200, we need at most 34 per batch
      const destinations = Array(net.count).fill({ mcc: net.mcc, mnc: net.mnc });

      let telqTests;
      try {
        telqTests = await telq.createTests(destinations);
      } catch (err) {
        console.error(`  ERROR requesting TelQ for ${net.name}: ${err.message}`);
        continue;
      }

      let sent = 0;
      let failed = 0;

      for (const tt of telqTests) {
        if (tt.errorMessage) {
          failed++;
          continue;
        }

        try {
          const res = await sendspeed.sendSms(route, tt.phoneNumber, "Test " + tt.testIdText);
          allTests.push({
            route: route.name,
            supplier: route.supplier,
            routeId: route.id,
            network: net.name,
            telqTestId: tt.id,
            telqPhone: tt.phoneNumber,
            testIdText: tt.testIdText,
            traceId: res.trace_id || null,
            sendSuccess: res.success === true,
            telqStatus: null,
            delay: null,
            textDelivered: null,
            senderDelivered: null,
          });
          sent++;
        } catch (err) {
          failed++;
        }

        // Small delay to avoid rate limiting
        await sleep(150);
      }

      console.log(`  ${net.name}: ${sent} sent, ${failed} failed`);
    }

    // Send to personal numbers via this route
    for (const p of PERSONAL_NUMBERS) {
      try {
        await sendspeed.sendSms(route, p.phone, `Teste Chip Farm - ${route.name}`);
        console.log(`  Personal ${p.name}: sent`);
      } catch (err) {
        console.log(`  Personal ${p.name}: FAILED`);
      }
      await sleep(150);
    }
  }

  const totalSent = allTests.filter((t) => t.sendSuccess).length;
  console.log(`\n=== ${totalSent} SMS enviados. Aguardando resultados TelQ... ===\n`);

  // 2. Poll TelQ for results (max 10 min)
  const maxPolls = 60;
  const pollInterval = 10000;

  for (let attempt = 1; attempt <= maxPolls; attempt++) {
    await sleep(pollInterval);

    const pending = allTests.filter((t) => t.telqStatus === null && t.telqTestId);
    if (pending.length === 0) break;

    // Poll in small batches to avoid hammering the API
    let resolved = 0;
    for (const test of pending) {
      try {
        const result = await telq.getTestResult(test.telqTestId);
        if (result.receiptStatus && result.receiptStatus !== "WAIT") {
          test.telqStatus = result.receiptStatus;
          test.delay = result.receiptDelay;
          test.textDelivered = result.textDelivered;
          test.senderDelivered = result.senderDelivered;
          resolved++;
        }
      } catch (err) {
        // ignore, retry next round
      }
    }

    const stillPending = pending.length - resolved;
    const totalResolved = allTests.filter((t) => t.telqStatus !== null).length;
    console.log(`Poll ${attempt}/${maxPolls}: +${resolved} resolved (${totalResolved}/${totalSent} total, ${stillPending} pending)`);

    if (stillPending === 0) break;
  }

  // Mark remaining as NOT_DELIVERED
  for (const t of allTests) {
    if (t.telqStatus === null) t.telqStatus = "NOT_DELIVERED";
  }

  // 3. Build report
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const totalDelivered = allTests.filter((t) => t.telqStatus === "POSITIVE").length;
  const overallRate = ((totalDelivered / totalSent) * 100).toFixed(1);

  console.log("\n\n========================================");
  console.log("         RELATORIO FINAL");
  console.log("========================================\n");
  console.log(`Total: ${totalSent} testes | Entregues: ${totalDelivered} (${overallRate}%) | Tempo: ${duration} min\n`);

  // Per route x network breakdown
  const report = {};
  for (const t of allTests) {
    const key = `${t.route}|||${t.network}`;
    if (!report[key]) {
      report[key] = { route: t.route, supplier: t.supplier, network: t.network, total: 0, delivered: 0, delays: [] };
    }
    report[key].total++;
    if (t.telqStatus === "POSITIVE") {
      report[key].delivered++;
      if (t.delay) report[key].delays.push(t.delay);
    }
  }

  // Per route totals
  const routeTotals = {};
  for (const t of allTests) {
    if (!routeTotals[t.route]) routeTotals[t.route] = { total: 0, delivered: 0, delays: [] };
    routeTotals[t.route].total++;
    if (t.telqStatus === "POSITIVE") {
      routeTotals[t.route].delivered++;
      if (t.delay) routeTotals[t.route].delays.push(t.delay);
    }
  }

  // Console output
  for (const [, data] of Object.entries(report)) {
    const rate = ((data.delivered / data.total) * 100).toFixed(1);
    const avgDelay = data.delays.length ? (data.delays.reduce((a, b) => a + b, 0) / data.delays.length).toFixed(1) : "N/A";
    const icon = parseFloat(rate) >= 95 ? "✅" : parseFloat(rate) >= 80 ? "⚠️" : "❌";
    console.log(`${icon} ${data.route} → ${data.network}: ${rate}% (${data.delivered}/${data.total}) | Latencia: ${avgDelay}s`);
  }

  // Route summary
  console.log("\n--- RESUMO POR ROTA ---");
  for (const [routeName, data] of Object.entries(routeTotals)) {
    const rate = ((data.delivered / data.total) * 100).toFixed(1);
    const avgDelay = data.delays.length ? (data.delays.reduce((a, b) => a + b, 0) / data.delays.length).toFixed(1) : "N/A";
    console.log(`${routeName}: ${rate}% entrega | Latencia media: ${avgDelay}s | (${data.delivered}/${data.total})`);
  }

  // 4. Format and send Telegram report
  let tgMsg = `<b>RELATORIO - TESTE 300 ENVIOS</b>\n`;
  tgMsg += `${new Date().toLocaleDateString("pt-BR")} | Duracao: ${duration} min\n\n`;
  tgMsg += `<b>GERAL:</b> ${totalDelivered}/${totalSent} entregues (${overallRate}%)\n`;
  tgMsg += `${"─".repeat(35)}\n\n`;

  // Per route
  for (const [routeName, data] of Object.entries(routeTotals)) {
    const rate = ((data.delivered / data.total) * 100).toFixed(1);
    const avgDelay = data.delays.length ? (data.delays.reduce((a, b) => a + b, 0) / data.delays.length).toFixed(1) : "N/A";
    const icon = parseFloat(rate) >= 95 ? "🟢" : parseFloat(rate) >= 80 ? "🟡" : "🔴";
    tgMsg += `${icon} <b>${routeName}</b>: ${rate}% | ${avgDelay}s\n`;
  }

  tgMsg += `\n<b>DETALHAMENTO</b>\n`;
  for (const [, data] of Object.entries(report)) {
    const rate = ((data.delivered / data.total) * 100).toFixed(1);
    const avgDelay = data.delays.length ? (data.delays.reduce((a, b) => a + b, 0) / data.delays.length).toFixed(1) : "N/A";
    const icon = parseFloat(rate) >= 95 ? "🟢" : parseFloat(rate) >= 80 ? "🟡" : "🔴";
    tgMsg += `${icon} ${data.route} → ${data.network}: ${rate}% (${data.delivered}/${data.total}) | ${avgDelay}s\n`;
  }

  // Best route per network
  tgMsg += `\n<b>RECOMENDACAO</b>\n`;
  const networkBest = {};
  for (const [, data] of Object.entries(report)) {
    const rate = data.delivered / data.total;
    const avgDelay = data.delays.length ? data.delays.reduce((a, b) => a + b, 0) / data.delays.length : 999;
    if (!networkBest[data.network] || rate > networkBest[data.network].rate || (rate === networkBest[data.network].rate && avgDelay < networkBest[data.network].avgDelay)) {
      networkBest[data.network] = { route: data.route, rate, avgDelay };
    }
  }
  for (const [network, best] of Object.entries(networkBest)) {
    const rate = (best.rate * 100).toFixed(1);
    tgMsg += `→ ${network}: usar <b>${best.route}</b> (${rate}%)\n`;
  }

  tgMsg += `\nSMS pessoais enviados: ${PERSONAL_NUMBERS.map((p) => p.name).join(", ")}`;

  await telegram.sendMessage(tgMsg);

  console.log("\n✅ Relatorio enviado no Telegram.");
  console.log("========================================\n");
})();
