const telq = require("./telq");
const sendspeed = require("./sendspeed");
const { routes } = require("./config");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  try {
    // 1. Pedir numero de teste da TelQ (Claro = MCC 724, MNC 05)
    console.log("[1] Pedindo numero de teste da TelQ (Claro)...");
    const tests = await telq.createTests([{ mcc: "724", mnc: "05" }]);

    if (!tests.length || tests[0].errorMessage) {
      console.error("TelQ falhou:", tests[0] ? tests[0].errorMessage : "sem resposta");
      return;
    }

    const telqTest = tests[0];
    console.log("Numero TelQ (Claro):", telqTest.phoneNumber);
    console.log("TestIdText:", telqTest.testIdText);
    console.log("Test ID:", telqTest.id);

    // 2. Rota Pushfy Premium
    const route = routes.find((r) => r.id === 1903);
    console.log("\n[2] Enviando SMS via", route.name);

    // 2a. Enviar pro numero TelQ
    console.log("\n>> Enviando pro TelQ:", telqTest.phoneNumber);
    const res1 = await sendspeed.sendSms(route, telqTest.phoneNumber, "Test " + telqTest.testIdText);
    console.log("SendSpeed response (TelQ):", JSON.stringify(res1));

    // 2b. Enviar pro Bruno
    console.log("\n>> Enviando pro Bruno: 5551986090147");
    const res2 = await sendspeed.sendSms(route, "5551986090147", "Teste Chip Farm - Pushfy Premium via Claro");
    console.log("SendSpeed response (Bruno):", JSON.stringify(res2));

    // 3. Resumo
    console.log("\n=== RESUMO ===");
    console.log("TelQ Test ID:", telqTest.id);
    console.log("TelQ Phone:", telqTest.phoneNumber);
    console.log("Rota:", route.name);
    console.log("Trace ID (TelQ):", res1.trace_id || "N/A");
    console.log("Trace ID (Bruno):", res2.trace_id || "N/A");

    // 4. Poll TelQ por resultado
    console.log("\n[3] Aguardando resultado da TelQ (polling a cada 10s, max 5min)...");
    for (let i = 1; i <= 30; i++) {
      await sleep(10000);
      const result = await telq.getTestResult(telqTest.id);
      console.log(`  Poll ${i}: status=${result.receiptStatus} delay=${result.receiptDelay || "-"}s`);

      if (result.receiptStatus && result.receiptStatus !== "WAIT") {
        console.log("\n=== RESULTADO TELQ ===");
        console.log("Status:", result.receiptStatus);
        console.log("Recebido em:", result.smsReceivedAt);
        console.log("Latencia:", result.receiptDelay, "s");
        console.log("Texto entregue:", result.textDelivered);
        console.log("Sender entregue:", result.senderDelivered);
        return;
      }
    }

    console.log("\nTimeout - TelQ nao recebeu o SMS em 5 minutos.");
  } catch (err) {
    console.error("Erro:", err.message);
  }
})();
