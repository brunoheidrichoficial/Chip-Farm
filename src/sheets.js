const { google } = require("googleapis");
const { config, TIERS, getRouteTier } = require("./config");

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

// Only write headers if the sheet is empty (no existing header row)
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

  // Only write headers if row 1 is empty
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A1:A1`,
    });
    if (res.data.values && res.data.values.length > 0 && res.data.values[0].length > 0) {
      return; // headers already present
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  } catch (err) {
    console.error(`[Sheets] Error setting headers for "${sheetName}":`, err.message);
  }
}

// ─── Headers (NO Tier column — tier is in the tab name) ───

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

const RANKING_GERAL_HEADERS = [
  "Posicao", "Rota", "Fornecedor", "Tier",
  "Score", "Entrega Pond %", "Latencia Score",
  "Fake DLR %", "CB SendSpeed %", "Testes", "Ultima Atualizacao",
];

// Helper: append rows to a sheet tab (ensures headers + appends data)
async function appendToSheet(sheetName, headers, rows) {
  if (!rows.length) return;
  const sheets = getSheets();
  if (!sheets) return;
  const spreadsheetId = config.sheets.spreadsheetId;

  await ensureHeaders(sheetName, headers);

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'!A2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
    console.log(`[Sheets] ${rows.length} linhas adicionadas em ${sheetName}`);
  } catch (err) {
    console.error(`[Sheets] Erro ao gravar ${sheetName}:`, err.message);
  }
}

// Build result/reco/ranking rows from a set of scores (already filtered by tier)
// NO Tier column in the rows — tier is conveyed by the tab name
function buildSheetData(scores, cbStats, runId, now) {
  // Result rows (11 cols)
  const resultRows = scores.map((s) => {
    const cb = cbStats[`${s.routeId}__${s.networkName}`];
    const cbRate = cb && cb.total > 0 ? Math.round((cb.delivered / cb.total) * 10000) / 100 : "";
    return [
      now, runId, s.routeName, s.supplier, s.networkName,
      s.sampleSize, s.deliveryRate, cbRate, s.fakeDlrRate,
      s.avgLatency != null ? s.avgLatency : "", s.score,
    ];
  });

  // Reco rows — best route per network (9 cols)
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

  // Ranking rows — aggregate per route (11 cols)
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
      routeName: r.routeName, supplier: r.supplier,
      scoreGeral: avg(r.scores), entregaMedia: avg(r.deliveries),
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

  return { resultRows, recoRows, rankingRows };
}

// ─── Push results: ONLY per-tier tabs (no global tabs) ───

async function pushResults(scores, runResults, runId, { skipFormatting = false } = {}) {
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

  // Compute SendSpeed callback stats per route/network (ALL results — CB is about SendSpeed, not TelQ)
  const cbStats = {};
  for (const r of runResults) {
    const key = `${r.route_id}__${r.network_name}`;
    if (!cbStats[key]) cbStats[key] = { total: 0, delivered: 0 };
    cbStats[key].total++;
    if (r.sendspeed_status === "delivered") cbStats[key].delivered++;
  }

  // Group scores by tier
  const byTier = {};
  for (const s of scores) {
    const tier = s.tier || getRouteTier(s.routeId) || null;
    if (!tier) continue;
    if (!byTier[tier]) byTier[tier] = [];
    byTier[tier].push(s);
  }

  // Push to per-tier tabs only
  for (const tier of TIERS) {
    const tierScores = byTier[tier];
    if (!tierScores || !tierScores.length) continue;

    const data = buildSheetData(tierScores, cbStats, runId, now);
    await appendToSheet(`Resultados ${tier}`, RESULTS_HEADERS, data.resultRows);
    await appendToSheet(`Recomendacoes ${tier}`, RECOMENDACOES_HEADERS, data.recoRows);
    await appendToSheet(`Ranking ${tier}`, RANKING_HEADERS, data.rankingRows);
  }

  if (!skipFormatting) {
    try { await updateRankingGeral(); }
    catch (err) { console.error("[Sheets] Ranking Geral failed:", err.message); }
    try { await applyFormatting(); }
    catch (err) { console.error("[Sheets] Formatting failed:", err.message); }
  }
}

// ─── Rebuild: wipe all sheets and reconstruct from DB ───

async function rebuildAllSheets() {
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

  const db = require("./db");

  // 1. Delete all existing tabs (except first — Sheets requires at least one)
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = meta.data.sheets;

  // Create a temp sheet first so we can delete everything else
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: "_temp" } } }],
    },
  });

  // Delete all original sheets
  const deleteReqs = existingSheets.map(s => ({
    deleteSheet: { sheetId: s.properties.sheetId },
  }));
  if (deleteReqs.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: deleteReqs },
    });
  }

  console.log(`[Sheets] Limpas ${existingSheets.length} abas existentes`);

  // 2. Get all runs that have scores
  const runs = db.getTestRuns(1000); // get up to 1000 runs
  let rebuiltRuns = 0;

  for (const run of runs.reverse()) { // oldest first
    const scores = db.getRunScores(run.id);
    if (!scores.length) continue;

    const results = db.getRunResults(run.id);

    // Map DB score rows to the format pushResults/buildSheetData expects
    const mappedScores = scores.map(s => ({
      routeId: s.route_id,
      routeName: s.route_name,
      supplier: s.supplier,
      networkName: s.network_name,
      deliveryRate: s.delivery_rate,
      avgLatency: s.avg_latency,
      fakeDlrRate: s.fake_dlr_rate,
      score: s.score,
      sampleSize: s.sample_size,
      tier: s.tier || getRouteTier(s.route_id) || null,
    }));

    await pushResults(mappedScores, results, run.id, { skipFormatting: true });
    rebuiltRuns++;
  }

  console.log(`[Sheets] Rebuild concluido: ${rebuiltRuns} runs processados`);

  // Update Ranking Geral + apply formatting once at the end
  try { await updateRankingGeral(); }
  catch (err) { console.error("[Sheets] Ranking Geral after rebuild failed:", err.message); }
  try { await applyFormatting(); }
  catch (err) { console.error("[Sheets] Formatting after rebuild failed:", err.message); }

  // 3. Delete _temp sheet
  try {
    const meta2 = await sheets.spreadsheets.get({ spreadsheetId });
    const tempSheet = meta2.data.sheets.find(s => s.properties.title === "_temp");
    if (tempSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteSheet: { sheetId: tempSheet.properties.sheetId } }],
        },
      });
    }
  } catch (err) {
    console.warn("[Sheets] Aviso ao deletar _temp:", err.message);
  }
}

// ─── Formatting (Executive Navy theme) ───

const COLORS = {
  headerBg:   { red: 0.11, green: 0.31, blue: 0.50 },
  white:      { red: 1.0,  green: 1.0,  blue: 1.0 },
  bodyLight:  { red: 0.96, green: 0.96, blue: 0.96 },
  textDark:   { red: 0.20, green: 0.20, blue: 0.20 },
  greenBg:    { red: 0.85, green: 0.92, blue: 0.83 },
  greenText:  { red: 0.15, green: 0.31, blue: 0.07 },
  yellowBg:   { red: 1.0,  green: 0.95, blue: 0.80 },
  yellowText: { red: 0.50, green: 0.38, blue: 0.0 },
  redBg:      { red: 0.96, green: 0.80, blue: 0.80 },
  redText:    { red: 0.40, green: 0.0,  blue: 0.0 },
  accentBlue: { red: 0.0,  green: 0.57, blue: 0.84 },
};
const FMT_END = 5000;

function _buildSheetFormat(sheetId, endCol, colWidths, centerCols, condRules) {
  const K = COLORS, E = FMT_END, r = [];
  r.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: E, startColumnIndex: 0, endColumnIndex: endCol }, cell: { userEnteredFormat: { backgroundColor: K.white, textFormat: { foregroundColor: K.textDark, fontSize: 10, fontFamily: "Roboto", bold: false }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", padding: { top: 4, bottom: 4, left: 6, right: 6 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } });
  r.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: endCol }, cell: { userEnteredFormat: { backgroundColor: K.headerBg, textFormat: { foregroundColor: K.white, fontSize: 11, bold: true, fontFamily: "Roboto" }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { top: 6, bottom: 6, left: 8, right: 8 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } });
  r.push({ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: "pixelSize" } });
  r.push({ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: E }, properties: { pixelSize: 30 }, fields: "pixelSize" } });
  r.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
  r.push({ updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: endCol }, bottom: { style: "SOLID_MEDIUM", color: K.accentBlue } } });
  for (const [col, size] of colWidths) r.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: col, endIndex: col + 1 }, properties: { pixelSize: size }, fields: "pixelSize" } });
  for (const col of centerCols) r.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat.horizontalAlignment" } });
  r.push({ addConditionalFormatRule: { rule: { ranges: [{ sheetId, startRowIndex: 1, endRowIndex: E, startColumnIndex: 0, endColumnIndex: endCol }], booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: "=ISEVEN(ROW())" }] }, format: { backgroundColor: K.bodyLight } } }, index: 0 } });
  r.push(...condRules);
  return r;
}

function _condHigh(sid, col, g, y) {
  const K = COLORS, E = FMT_END;
  return [
    { addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], booleanRule: { condition: { type: "NUMBER_GREATER_THAN_EQ", values: [{ userEnteredValue: String(g) }] }, format: { backgroundColor: K.greenBg, textFormat: { foregroundColor: K.greenText, bold: true } } } }, index: 0 } },
    { addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], booleanRule: { condition: { type: "NUMBER_GREATER_THAN_EQ", values: [{ userEnteredValue: String(y) }] }, format: { backgroundColor: K.yellowBg, textFormat: { foregroundColor: K.yellowText, bold: true } } } }, index: 1 } },
    { addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], booleanRule: { condition: { type: "NUMBER_LESS", values: [{ userEnteredValue: String(y) }] }, format: { backgroundColor: K.redBg, textFormat: { foregroundColor: K.redText, bold: true } } } }, index: 2 } },
  ];
}

function _condLow(sid, col, g, y) {
  const K = COLORS, E = FMT_END;
  return [
    { addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], booleanRule: { condition: { type: "NUMBER_LESS_THAN_EQ", values: [{ userEnteredValue: String(g) }] }, format: { backgroundColor: K.greenBg, textFormat: { foregroundColor: K.greenText, bold: true } } } }, index: 0 } },
    { addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], booleanRule: { condition: { type: "NUMBER_LESS_THAN_EQ", values: [{ userEnteredValue: String(y) }] }, format: { backgroundColor: K.yellowBg, textFormat: { foregroundColor: K.yellowText, bold: true } } } }, index: 1 } },
    { addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], booleanRule: { condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: String(y) }] }, format: { backgroundColor: K.redBg, textFormat: { foregroundColor: K.redText, bold: true } } } }, index: 2 } },
  ];
}

function _condGradient(sid, col) {
  const K = COLORS, E = FMT_END;
  return [{ addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], gradientRule: { minpoint: { color: K.redBg, type: "NUMBER", value: "60" }, midpoint: { color: K.yellowBg, type: "NUMBER", value: "85" }, maxpoint: { color: K.greenBg, type: "NUMBER", value: "100" } } }, index: 0 } }];
}

function _condPodium(sid, col) {
  const E = FMT_END;
  return [
    { addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], booleanRule: { condition: { type: "NUMBER_EQ", values: [{ userEnteredValue: "1" }] }, format: { backgroundColor: { red: 1, green: 0.95, blue: 0.7 }, textFormat: { foregroundColor: { red: 0.55, green: 0.43, blue: 0 }, bold: true } } } }, index: 0 } },
    { addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], booleanRule: { condition: { type: "NUMBER_EQ", values: [{ userEnteredValue: "2" }] }, format: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.92 }, textFormat: { foregroundColor: { red: 0.35, green: 0.35, blue: 0.4 }, bold: true } } } }, index: 1 } },
    { addConditionalFormatRule: { rule: { ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: E, startColumnIndex: col, endColumnIndex: col + 1 }], booleanRule: { condition: { type: "NUMBER_EQ", values: [{ userEnteredValue: "3" }] }, format: { backgroundColor: { red: 0.96, green: 0.87, blue: 0.75 }, textFormat: { foregroundColor: { red: 0.5, green: 0.31, blue: 0.12 }, bold: true } } } }, index: 2 } },
  ];
}

async function applyFormatting() {
  const sheets = getSheets();
  if (!sheets) return;
  const spreadsheetId = config.sheets.spreadsheetId;
  if (!spreadsheetId) return;

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties,conditionalFormats)" });
    const sm = {};
    meta.data.sheets.forEach(s => { sm[s.properties.title] = s.properties.sheetId; });

    // Clear all existing conditional rules
    const clearReqs = [];
    for (const s of meta.data.sheets) {
      if (s.conditionalFormats) {
        for (let i = s.conditionalFormats.length - 1; i >= 0; i--) {
          clearReqs.push({ deleteConditionalFormatRule: { sheetId: s.properties.sheetId, index: i } });
        }
      }
    }
    if (clearReqs.length) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: clearReqs } });
    }

    const allReqs = [];

    // Resultados tabs (11 cols, NO Tier column)
    // Cols: 0:Data 1:Run 2:Rota 3:Fornecedor 4:Operadora 5:Testes 6:Entrega% 7:CB% 8:FakeDLR% 9:Latencia 10:Score
    for (const [title, sid] of Object.entries(sm)) {
      if (title.startsWith("Resultados ")) {
        allReqs.push(..._buildSheetFormat(sid, 11,
          [[0,100],[1,55],[2,180],[3,110],[4,100],[5,65],[6,120],[7,120],[8,100],[9,135],[10,80]],
          [1,5,6,7,8,9,10],
          [..._condHigh(sid,6,95,80), ..._condHigh(sid,7,95,80), ..._condLow(sid,8,0,5), ..._condLow(sid,9,60,120), ..._condGradient(sid,10)]
        ));
      }
    }

    // Recomendacoes tabs (9 cols, NO Tier column)
    // Cols: 0:Data 1:Run 2:Operadora 3:MelhorRota 4:Fornecedor 5:Entrega% 6:Latencia 7:Score 8:CB%
    for (const [title, sid] of Object.entries(sm)) {
      if (title.startsWith("Recomendacoes ")) {
        allReqs.push(..._buildSheetFormat(sid, 9,
          [[0,100],[1,55],[2,100],[3,185],[4,110],[5,100],[6,105],[7,80],[8,130]],
          [1,5,6,7,8],
          [..._condHigh(sid,5,95,80), ..._condLow(sid,6,60,120), ..._condGradient(sid,7), ..._condHigh(sid,8,95,80)]
        ));
      }
    }

    // Ranking tabs (11 cols, NO Tier column)
    // Cols: 0:Data 1:Run 2:Posicao 3:Rota 4:Fornecedor 5:ScoreGeral 6:Entrega% 7:Latencia 8:FakeDLR% 9:CB% 10:Operadoras
    for (const [title, sid] of Object.entries(sm)) {
      if (title === "Ranking Geral") continue; // handled separately below
      if (title.startsWith("Ranking ")) {
        allReqs.push(..._buildSheetFormat(sid, 11,
          [[0,100],[1,55],[2,70],[3,185],[4,110],[5,105],[6,120],[7,130],[8,95],[9,115],[10,200]],
          [1,2,5,6,7,8,9],
          [..._condPodium(sid,2), ..._condGradient(sid,5), ..._condHigh(sid,6,95,80), ..._condLow(sid,7,60,120), ..._condLow(sid,8,0,5), ..._condHigh(sid,9,95,80)]
        ));
      }
    }

    // Ranking Geral tab (11 cols)
    // Cols: 0:Posicao 1:Rota 2:Fornecedor 3:Tier 4:Score 5:EntregaPond% 6:LatScore 7:FakeDLR% 8:CB% 9:Testes 10:UltimaAtualizacao
    if (sm["Ranking Geral"]) {
      const sid = sm["Ranking Geral"];
      allReqs.push(..._buildSheetFormat(sid, 11,
        [[0,70],[1,185],[2,110],[3,90],[4,80],[5,120],[6,105],[7,100],[8,110],[9,70],[10,160]],
        [0,4,5,6,7,8,9],
        [..._condPodium(sid,0), ..._condGradient(sid,4), ..._condHigh(sid,5,95,80), ..._condHigh(sid,6,80,50), ..._condLow(sid,7,0,5), ..._condHigh(sid,8,95,80)]
      ));
    }

    if (allReqs.length) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: allReqs } });
      console.log(`[Sheets] Formatacao aplicada (${allReqs.length} ops)`);
    }
  } catch (err) {
    console.error("[Sheets] Erro ao aplicar formatacao:", err.message);
  }
}

// ─── Update only CB% cells for a specific run (no rebuild needed) ───

async function updateRunCallbacks(runId) {
  const sheets = getSheets();
  if (!sheets) return;
  const spreadsheetId = config.sheets.spreadsheetId;
  if (!spreadsheetId) return;

  const db = require("./db");
  const results = db.getRunResults(runId);
  if (!results.length) return;

  // Compute CB stats per route/network
  const cbStats = {};
  for (const r of results) {
    const key = `${r.route_id}__${r.network_name}`;
    if (!cbStats[key]) cbStats[key] = { total: 0, delivered: 0 };
    cbStats[key].total++;
    if (r.sendspeed_status === "delivered") cbStats[key].delivered++;
  }

  // Aggregate CB per route (for Ranking tabs)
  const cbByRoute = {};
  for (const r of results) {
    if (!cbByRoute[r.route_id]) cbByRoute[r.route_id] = { delivered: 0, total: 0 };
    cbByRoute[r.route_id].total++;
    if (r.sendspeed_status === "delivered") cbByRoute[r.route_id].delivered++;
  }

  const runStr = String(runId);
  let totalUpdates = 0;

  // Get all sheet tabs
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const tabNames = meta.data.sheets.map(s => s.properties.title);

  for (const tab of tabNames) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tab}'!A:Z`,
    });
    const rows = res.data.values || [];
    if (rows.length < 2) continue;

    const updates = []; // { range, value }

    if (tab.startsWith("Resultados ")) {
      // Col B(1)=Run, Col C(2)=Rota, Col E(4)=Operadora, Col H(7)=CB%
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][1]) !== runStr) continue;
        const rota = rows[i][2];
        const oper = rows[i][4];
        // Find matching route_id by name
        const match = results.find(r => r.route_name === rota && r.network_name === oper);
        if (!match) continue;
        const cb = cbStats[`${match.route_id}__${oper}`];
        const cbRate = cb && cb.total > 0 ? Math.round((cb.delivered / cb.total) * 10000) / 100 : "";
        updates.push({ range: `'${tab}'!H${i + 1}`, values: [[cbRate]] });
      }
    } else if (tab.startsWith("Recomendacoes ")) {
      // Col B(1)=Run, Col C(2)=Operadora, Col D(3)=MelhorRota, Col I(8)=CB%
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][1]) !== runStr) continue;
        const oper = rows[i][2];
        const rota = rows[i][3];
        const match = results.find(r => r.route_name === rota && r.network_name === oper);
        if (!match) continue;
        const cb = cbStats[`${match.route_id}__${oper}`];
        const cbRate = cb && cb.total > 0 ? Math.round((cb.delivered / cb.total) * 10000) / 100 : "";
        updates.push({ range: `'${tab}'!I${i + 1}`, values: [[cbRate]] });
      }
    } else if (tab.startsWith("Ranking ")) {
      // Col B(1)=Run, Col D(3)=Rota, Col J(9)=CB%
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][1]) !== runStr) continue;
        const rota = rows[i][3];
        const match = results.find(r => r.route_name === rota);
        if (!match) continue;
        const cb = cbByRoute[match.route_id];
        const cbRate = cb && cb.total > 0 ? Math.round((cb.delivered / cb.total) * 10000) / 100 : "";
        updates.push({ range: `'${tab}'!J${i + 1}`, values: [[cbRate]] });
      }
    }

    if (updates.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: updates,
        },
      });
      totalUpdates += updates.length;
    }
  }

  console.log(`[Sheets] CB% atualizado: ${totalUpdates} celulas para run #${runId}`);
}

// ─── Patch scores in-place across all tabs (no rebuild) ───

async function patchAllScores() {
  const sheets = getSheets();
  if (!sheets) return;
  const spreadsheetId = config.sheets.spreadsheetId;
  if (!spreadsheetId) return;

  const db = require("./db");

  // Build lookup: run_id → route_name → network_name → score data
  const allRuns = db.getDb().prepare("SELECT DISTINCT run_id FROM route_scores ORDER BY run_id").all();
  const scoreLookup = {};
  for (const { run_id } of allRuns) {
    const scores = db.getRunScores(run_id);
    scoreLookup[run_id] = {};
    for (const s of scores) {
      if (!scoreLookup[run_id][s.route_name]) scoreLookup[run_id][s.route_name] = {};
      scoreLookup[run_id][s.route_name][s.network_name] = s;
    }
  }

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const tabNames = meta.data.sheets.map(s => s.properties.title);
  let totalUpdates = 0;

  for (const tab of tabNames) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'!A:Z` });
    const rows = res.data.values || [];
    if (rows.length < 2) continue;

    const updates = [];

    if (tab.startsWith("Resultados ")) {
      // Headers: Data(A), Run(B), Rota(C), Fornecedor(D), Operadora(E), Testes(F), Entrega%(G), CB%(H), FakeDLR%(I), Latencia(J), Score(K)
      for (let i = 1; i < rows.length; i++) {
        const runId = parseInt(rows[i][1]);
        const rota = rows[i][2];
        const oper = rows[i][4];
        const s = scoreLookup[runId] && scoreLookup[runId][rota] && scoreLookup[runId][rota][oper];
        if (!s) continue;
        const row = i + 1;
        updates.push({ range: `'${tab}'!F${row}`, values: [[s.sample_size]] });
        updates.push({ range: `'${tab}'!G${row}`, values: [[s.delivery_rate]] });
        updates.push({ range: `'${tab}'!I${row}`, values: [[s.fake_dlr_rate]] });
        updates.push({ range: `'${tab}'!J${row}`, values: [[s.avg_latency != null ? s.avg_latency : ""]] });
        updates.push({ range: `'${tab}'!K${row}`, values: [[s.score]] });
      }
    } else if (tab.startsWith("Recomendacoes ")) {
      // Headers: Data(A), Run(B), Operadora(C), MelhorRota(D), Fornecedor(E), Entrega%(F), Latencia(G), Score(H), CB%(I)
      for (let i = 1; i < rows.length; i++) {
        const runId = parseInt(rows[i][1]);
        const oper = rows[i][2];
        const rota = rows[i][3];
        const s = scoreLookup[runId] && scoreLookup[runId][rota] && scoreLookup[runId][rota][oper];
        if (!s) continue;
        const row = i + 1;
        updates.push({ range: `'${tab}'!F${row}`, values: [[s.delivery_rate]] });
        updates.push({ range: `'${tab}'!G${row}`, values: [[s.avg_latency != null ? s.avg_latency : ""]] });
        updates.push({ range: `'${tab}'!H${row}`, values: [[s.score]] });
      }
    } else if (tab.startsWith("Ranking ") && tab !== "Ranking Geral") {
      // Headers: Data(A), Run(B), Posicao(C), Rota(D), Fornecedor(E), ScoreGeral(F), EntregaMedia%(G), LatenciaMedia(H), FakeDLR%(I), CB%(J), Operadoras(K)
      for (let i = 1; i < rows.length; i++) {
        const runId = parseInt(rows[i][1]);
        const rota = rows[i][3];
        if (!scoreLookup[runId] || !scoreLookup[runId][rota]) continue;
        // Aggregate across networks for this route in this run
        const networks = scoreLookup[runId][rota];
        const vals = Object.values(networks);
        const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100 : 0;
        const scoreGeral = avg(vals.map(v => v.score));
        const entregaMedia = avg(vals.map(v => v.delivery_rate));
        const latencias = vals.filter(v => v.avg_latency != null).map(v => v.avg_latency);
        const latMedia = latencias.length ? avg(latencias) : "";
        const fakeDlr = avg(vals.map(v => v.fake_dlr_rate));
        const row = i + 1;
        updates.push({ range: `'${tab}'!F${row}`, values: [[scoreGeral]] });
        updates.push({ range: `'${tab}'!G${row}`, values: [[entregaMedia]] });
        updates.push({ range: `'${tab}'!H${row}`, values: [[latMedia]] });
        updates.push({ range: `'${tab}'!I${row}`, values: [[fakeDlr]] });
      }
    }

    if (updates.length) {
      // Batch in chunks of 500 to avoid API limits
      for (let j = 0; j < updates.length; j += 500) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "RAW", data: updates.slice(j, j + 500) },
        });
      }
      totalUpdates += updates.length;
      console.log(`[Sheets] Patched ${updates.length} cells in '${tab}'`);
    }
  }

  // Also update Ranking Geral
  await updateRankingGeral();

  console.log(`[Sheets] Patch completo: ${totalUpdates} celulas atualizadas`);
  return totalUpdates;
}

// ─── Ranking Geral: aggregate from route_scores (same source as per-tier rankings) ───

async function updateRankingGeral() {
  const sheets = getSheets();
  if (!sheets) return;
  const spreadsheetId = config.sheets.spreadsheetId;
  if (!spreadsheetId) return;

  const db = require("./db");

  // Get all run scores (same data that feeds per-tier Ranking tabs)
  const allRuns = db.getDb().prepare("SELECT DISTINCT run_id FROM route_scores ORDER BY run_id").all();
  if (!allRuns.length) return;

  // Also get raw results for CB% (callbacks are not in route_scores)
  const rawResults = db.getAllResults();

  // Aggregate scores per route: average of per-run scores (each run = equal weight)
  const byRoute = {};
  for (const { run_id } of allRuns) {
    const scores = db.getRunScores(run_id);
    // Aggregate per route within this run (same logic as buildSheetData ranking)
    const runByRoute = {};
    for (const s of scores) {
      if (!runByRoute[s.route_id]) runByRoute[s.route_id] = { routeName: s.route_name, supplier: s.supplier, tier: s.tier || getRouteTier(s.route_id) || "", scores: [], entregas: [], latencies: [], fakeDlrs: [], samples: 0 };
      const r = runByRoute[s.route_id];
      r.scores.push(s.score);
      r.entregas.push(s.delivery_rate);
      if (s.avg_latency != null) r.latencies.push(s.avg_latency);
      r.fakeDlrs.push(s.fake_dlr_rate);
      r.samples += s.sample_size;
    }
    // Each run produces one aggregated score per route
    for (const [routeId, r] of Object.entries(runByRoute)) {
      if (!byRoute[routeId]) byRoute[routeId] = { routeName: r.routeName, supplier: r.supplier, tier: r.tier, runScores: [], runEntregas: [], runLatencies: [], runFakeDlrs: [], totalSamples: 0 };
      const b = byRoute[routeId];
      const avg = arr => arr.length ? arr.reduce((a, c) => a + c, 0) / arr.length : 0;
      b.runScores.push(avg(r.scores));
      b.runEntregas.push(avg(r.entregas));
      if (r.latencies.length) b.runLatencies.push(avg(r.latencies));
      b.runFakeDlrs.push(avg(r.fakeDlrs));
      b.totalSamples += r.samples;
    }
  }

  // CB% from raw results (consistent denominator: count ALL results)
  const cbByRoute = {};
  for (const r of rawResults) {
    if (!cbByRoute[r.route_id]) cbByRoute[r.route_id] = { delivered: 0, total: 0 };
    cbByRoute[r.route_id].total++;
    if (r.sendspeed_status === "delivered") cbByRoute[r.route_id].delivered++;
  }

  const avg = arr => arr.length ? Math.round(arr.reduce((a, c) => a + c, 0) / arr.length * 100) / 100 : 0;

  const ranked = Object.entries(byRoute).map(([routeId, b]) => {
    const cb = cbByRoute[routeId];
    const cbRate = cb && cb.total > 0 ? Math.round((cb.delivered / cb.total) * 10000) / 100 : "";
    return {
      routeName: b.routeName, supplier: b.supplier, tier: b.tier,
      score: avg(b.runScores),
      entrega: avg(b.runEntregas),
      latScore: avg(b.runLatencies),
      fakeDlr: avg(b.runFakeDlrs),
      cbRate, total: b.totalSamples,
    };
  }).sort((a, b) => b.score - a.score);

  const now = new Date().toLocaleDateString("pt-BR") + " " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const rows = ranked.map((r, i) => [
    i + 1, r.routeName, r.supplier, r.tier,
    r.score, r.entrega, r.latScore, r.fakeDlr,
    r.cbRate, r.total, now,
  ]);

  const sheetName = "Ranking Geral";
  await ensureHeaders(sheetName, RANKING_GERAL_HEADERS);

  // Clear existing data (keep header) and write fresh
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${sheetName}'!A2:Z`,
    });
    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A2`,
        valueInputOption: "RAW",
        requestBody: { values: rows },
      });
    }
    console.log(`[Sheets] Ranking Geral atualizado: ${rows.length} rotas`);
  } catch (err) {
    console.error(`[Sheets] Erro ao atualizar Ranking Geral:`, err.message);
  }
}

module.exports = { pushResults, applyFormatting, rebuildAllSheets, updateRunCallbacks, updateRankingGeral, patchAllScores };
