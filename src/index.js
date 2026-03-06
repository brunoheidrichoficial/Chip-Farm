const cron = require("node-cron");
const { config } = require("./config");
const { startServer } = require("./server");
const { runFullTest } = require("./run-test");
const telegram = require("./telegram");

async function main() {
  console.log("=== SendSpeed Chip Farm ===");
  console.log(`Cron: ${config.cronSchedule}`);
  console.log(`Callback server: port ${config.callbackServer.port}`);
  console.log();

  // Start callback server
  await startServer();

  // Cron desabilitado — reativar quando teste estiver consolidado
  /*
  cron.schedule(config.cronSchedule, async () => {
    console.log(`\n[Cron] Triggered at ${new Date().toISOString()}`);
    try {
      await runFullTest();
    } catch (err) {
      console.error("[Cron] Test failed:", err);
      await telegram.sendMessage(`❌ Teste diario falhou:\n${err.message}`);
    }
  });
  */

  console.log(`[Scheduler] Cron DESABILITADO (modo manual) — schedule configurado: ${config.cronSchedule}`);
  console.log("[Scheduler] Disparos somente via dashboard ou API\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
