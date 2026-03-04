#!/usr/bin/env node
// Rebuild all Google Sheets tabs from DB data
// Usage: node rebuild-sheets.js

const { rebuildAllSheets, applyFormatting } = require("./src/sheets");

(async () => {
  try {
    console.log("[Rebuild] Iniciando rebuild completo das planilhas...");
    await rebuildAllSheets();
    console.log("[Rebuild] Aplicando formatacao...");
    await applyFormatting();
    console.log("[Rebuild] Concluido!");
  } catch (err) {
    console.error("[Rebuild] Erro:", err);
    process.exit(1);
  }
})();
