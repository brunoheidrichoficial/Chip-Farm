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

const NETWORKS = [
  { mcc: "724", mnc: "05", name: "Claro" },
  { mcc: "724", mnc: "06", name: "Vivo" },
  { mcc: "724", mnc: "02", name: "TIM" },
];

const PERSONAL_NUMBERS = [
  { phone: "5511982060158", name: "SP" },
  { phone: "5521966110808", name: "RJ" },
  { phone: "5551986090147", name: "Bruno" },
];

(async () => {
  const startTime = Date.now();
  console.log("=== TESTE RAPIDO: 1 por rota x operadora (9 testes TelQ + 9 pessoais) ===\n");

  const allTests = [];

  for (const route of TEST_ROUTES) {
    console.log(`--- ${route.name} ---`);

    // Request 1 number per operator in a single batch
    const destinations = NETWORKS.map((n) => ({ mcc: n.mcc, mnc: n.mnc }));

    let telqTests;
    try {
      telqTests = await telq.createTests(destinations);
    } catch (err) {
      console.error(`  TelQ ERRO: ${err.message}`);
      continue;
    }

    for (let i = 0; i < telqTests.length; i++) {
      const tt = telqTests[i];
      const net = NETWORKS[i] || { name: "?" };

      if (tt.errorMessage) {
        console.log(`  ${net.name}: TelQ erro - ${tt.errorMessage}`);
        continue;
      }

      const res = await sendspeed.sendSms(route, tt.phoneNumber, "Test " + tt.testIdText);
      console.log(`  ${net.name}: phone=${tt.phoneNumber} testId=${tt.testIdText} trace=${res.trace_id || "FAIL"}`);

      allTests.push({
        route: route.name,
        supplier: route.supplier,
        network: net.name,
        telqTestId: tt.id,
        testIdText: tt.testIdText,
        traceId: res.trace_id || null,
        telqStatus: null,
        delay: null,
        textDelivered: null,
        senderDelivered: null,
      });

      await sleep(200);
    }

    // Personal numbers
    for (const p of PERSONAL_NUMBERS) {
      await sendspeed.sendSms(route, p.phone, `Teste Chip Farm - ${route.name}`);
      console.log(`  Pessoal ${p.name}: enviado`);
      await sleep(200);
    }

    console.log("");
  }

  console.log(`${allTests.length} testes TelQ enviados. Polling resultados...\n`);

  // Poll for results
  for (let attempt = 1; attempt <= 36; attempt++) {
    await sleep(10000);
    const pending = allTests.filter((t) => t.telqStatus === null);
    if (pending.length === 0) break;

    for (const test of pending) {
      try {
        const result = await telq.getTestResult(test.telqTestId);
        if (result.receiptStatus && result.receiptStatus !== "WAIT") {
          test.telqStatus = result.receiptStatus;
          test.delay = result.receiptDelay;
          test.textDelivered = result.textDelivered;
          test.senderDelivered = result.senderDelivered;
        }
      } catch (err) {}
    }

    const resolved = allTests.filter((t) => t.telqStatus !== null).length;
    console.log(`Poll ${attempt}: ${resolved}/${allTests.length} resolvidos`);
    if (resolved === allTests.length) break;
  }

  // Mark remaining
  for (const t of allTests) {
    if (t.telqStatus === null) t.telqStatus = "NOT_DELIVERED";
  }

  // Build report
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const delivered = allTests.filter((t) => t.telqStatus === "POSITIVE").length;

  console.log("\n========================================");
  console.log("         RESULTADO FINAL");
  console.log("========================================\n");

  let tgMsg = `<b>TESTE RAPIDO - ${new Date().toLocaleDateString("pt-BR")}</b>\n`;
  tgMsg += `${allTests.length} testes | Duracao: ${duration} min\n`;
  tgMsg += `${"─".repeat(35)}\n\n`;

  for (const route of TEST_ROUTES) {
    const routeTests = allTests.filter((t) => t.route === route.name);
    const routeDelivered = routeTests.filter((t) => t.telqStatus === "POSITIVE").length;
    const routeRate = routeTests.length ? ((routeDelivered / routeTests.length) * 100).toFixed(0) : "0";
    const routeIcon = routeDelivered === routeTests.length ? "🟢" : routeDelivered > 0 ? "🟡" : "🔴";

    console.log(`${route.name} (${routeRate}% geral)`);
    tgMsg += `${routeIcon} <b>${route.name}</b> (${routeRate}%)\n`;

    for (const t of routeTests) {
      const icon = t.telqStatus === "POSITIVE" ? "✅" : "❌";
      const lat = t.delay ? `${t.delay}s` : "-";
      const sender = t.senderDelivered || "-";
      console.log(`  ${icon} ${t.network}: ${t.telqStatus} | Latencia: ${lat} | Sender: ${sender}`);
      tgMsg += `  ${icon} ${t.network}: ${t.telqStatus} | ${lat} | Sender: ${sender}\n`;
    }
    console.log("");
    tgMsg += "\n";
  }

  const overallRate = allTests.length ? ((delivered / allTests.length) * 100).toFixed(0) : "0";
  console.log(`GERAL: ${delivered}/${allTests.length} entregues (${overallRate}%)`);
  tgMsg += `<b>GERAL:</b> ${delivered}/${allTests.length} entregues (${overallRate}%)\n`;
  tgMsg += `\nSMS pessoais enviados para SP, RJ e Bruno (3 rotas cada)`;

  await telegram.sendMessage(tgMsg);
  console.log("\n✅ Relatorio enviado no Telegram.");
})();
