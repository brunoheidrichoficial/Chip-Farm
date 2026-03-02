const { google } = require("googleapis");
const { config } = require("./config");

let sheetsClient = null;

function getAuth() {
  if (!config.sheets.credentials) return null;

  let creds;
  try {
    creds = JSON.parse(config.sheets.credentials);
  } catch {
    // Try as file path
    const fs = require("fs");
    const path = require("path");
    const resolved = path.resolve(__dirname, "..", config.sheets.credentials);
    if (!fs.existsSync(resolved)) {
      console.warn("[Sheets] Credentials file not found:", resolved);
      return null;
    }
    creds = JSON.parse(fs.readFileSync(resolved, "utf8"));
  }

  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheets() {
  if (sheetsClient) return sheetsClient;
  const auth = getAuth();
  if (!auth) return null;
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

async function ensureHeaders(sheetName, headers) {
  const sheets = getSheets();
  if (!sheets) return;
  const spreadsheetId = config.sheets.spreadsheetId;

  // Check if sheet tab exists, create if not
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some((s) => s.properties.title === sheetName);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });
    }
  } catch (err) {
    console.error(`[Sheets] Error checking/creating tab "${sheetName}":`, err.message);
    return;
  }

  // Check if headers exist (row 1)
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:Z1`,
    });
    if (!res.data.values || !res.data.values.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
  } catch (err) {
    console.error(`[Sheets] Error setting headers for "${sheetName}":`, err.message);
  }
}

const RESULTS_HEADERS = [
  "Data", "Run", "Rota", "Fornecedor", "Operadora",
  "Testes", "Entrega TelQ %", "Callback SS %", "Fake DLR %",
  "Latencia Media (s)", "Score",
];

const RECOMENDACOES_HEADERS = [
  "Data", "Run", "Operadora", "Melhor Rota", "Fornecedor",
  "Entrega %", "Latencia (s)", "Score", "CB SendSpeed %",
];

const RANKING_HEADERS = [
  "Data", "Run", "Posicao", "Rota", "Fornecedor",
  "Score Geral", "Entrega Media %", "Latencia Media (s)",
  "Fake DLR %", "CB SendSpeed %", "Operadoras Testadas",
];

async function pushResults(scores, runResults, runId) {
  const sheets = getSheets();
  if (!sheets) {
    console.log("[Sheets] Desabilitado (sem credenciais)");
    return;
  }

  const spreadsheetId = config.sheets.spreadsheetId;
  if (!spreadsheetId) {
    console.log("[Sheets] Desabilitado (sem GOOGLE_SHEET_ID)");
    return;
  }

  const now = new Date().toLocaleDateString("pt-BR");

  // Compute SendSpeed callback stats per route/network
  const cbStats = {};
  for (const r of runResults) {
    const key = `${r.route_id}__${r.network_name}`;
    if (!cbStats[key]) cbStats[key] = { total: 0, delivered: 0 };
    cbStats[key].total++;
    if (r.sendspeed_status === "delivered") cbStats[key].delivered++;
  }

  // Ensure tabs + headers
  await ensureHeaders("Resultados", RESULTS_HEADERS);
  await ensureHeaders("Recomendacoes", RECOMENDACOES_HEADERS);
  await ensureHeaders("Ranking Geral", RANKING_HEADERS);

  // Build rows for Resultados
  const resultRows = scores.map((s) => {
    const cb = cbStats[`${s.routeId}__${s.networkName}`];
    const cbRate = cb && cb.total > 0 ? Math.round((cb.delivered / cb.total) * 10000) / 100 : "";
    return [
      now, runId, s.routeName, s.supplier, s.networkName,
      s.sampleSize, s.deliveryRate, cbRate, s.fakeDlrRate,
      s.avgLatency != null ? s.avgLatency : "", s.score,
    ];
  });

  // Build rows for Recomendacoes (best per network)
  const byNetwork = {};
  for (const s of scores) {
    if (!byNetwork[s.networkName]) byNetwork[s.networkName] = [];
    byNetwork[s.networkName].push(s);
  }

  const recoRows = [];
  for (const [network, networkScores] of Object.entries(byNetwork)) {
    const best = networkScores.sort((a, b) => b.score - a.score)[0];
    if (best) {
      const cb = cbStats[`${best.routeId}__${best.networkName}`];
      const cbRate = cb && cb.total > 0 ? Math.round((cb.delivered / cb.total) * 10000) / 100 : "";
      recoRows.push([
        now, runId, network, best.routeName, best.supplier,
        best.deliveryRate, best.avgLatency != null ? best.avgLatency : "", best.score, cbRate,
      ]);
    }
  }

  // Build rows for Ranking Geral (aggregate per route across all networks)
  const byRoute = {};
  for (const s of scores) {
    if (!byRoute[s.routeId]) byRoute[s.routeId] = { routeName: s.routeName, supplier: s.supplier, scores: [], deliveries: [], latencies: [], fakeDlrs: [], cbDelivered: 0, cbTotal: 0, networks: [] };
    const r = byRoute[s.routeId];
    r.scores.push(s.score);
    r.deliveries.push(s.deliveryRate);
    if (s.avgLatency != null) r.latencies.push(s.avgLatency);
    r.fakeDlrs.push(s.fakeDlrRate);
    r.networks.push(s.networkName);
    const cb = cbStats[`${s.routeId}__${s.networkName}`];
    if (cb) { r.cbDelivered += cb.delivered; r.cbTotal += cb.total; }
  }

  const rankingEntries = Object.values(byRoute).map(r => {
    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100 : 0;
    return {
      routeName: r.routeName,
      supplier: r.supplier,
      scoreGeral: avg(r.scores),
      entregaMedia: avg(r.deliveries),
      latenciaMedia: r.latencies.length ? avg(r.latencies) : "",
      fakeDlr: avg(r.fakeDlrs),
      cbRate: r.cbTotal > 0 ? Math.round((r.cbDelivered / r.cbTotal) * 10000) / 100 : "",
      networks: r.networks.join(", "),
    };
  }).sort((a, b) => b.scoreGeral - a.scoreGeral);

  const rankingRows = rankingEntries.map((r, i) => [
    now, runId, i + 1, r.routeName, r.supplier,
    r.scoreGeral, r.entregaMedia, r.latenciaMedia,
    r.fakeDlr, r.cbRate, r.networks,
  ]);

  // Append to sheets
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Resultados!A2",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: resultRows },
    });
    console.log(`[Sheets] ${resultRows.length} linhas adicionadas em Resultados`);
  } catch (err) {
    console.error("[Sheets] Erro ao gravar Resultados:", err.message);
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Recomendacoes!A2",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: recoRows },
    });
    console.log(`[Sheets] ${recoRows.length} linhas adicionadas em Recomendacoes`);
  } catch (err) {
    console.error("[Sheets] Erro ao gravar Recomendacoes:", err.message);
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Ranking Geral!A2",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rankingRows },
    });
    console.log(`[Sheets] ${rankingRows.length} linhas adicionadas em Ranking Geral`);
  } catch (err) {
    console.error("[Sheets] Erro ao gravar Ranking Geral:", err.message);
  }
}

module.exports = { pushResults };
