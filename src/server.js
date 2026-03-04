const express = require("express");
const path = require("path");
const { config, routes, targetNetworks } = require("./config");
const db = require("./db");
const campaignsRouter = require("./api/campaigns");
const reportsRouter = require("./api/reports");
const telq = require("./telq");

const app = express();
app.use(express.json());

// Debug: log EVERY incoming request
app.use((req, res, next) => {
  if (!req.url.startsWith("/api/") && !req.url.startsWith("/js/") && !req.url.startsWith("/css/") && req.url !== "/" && req.url !== "/health" && !req.url.endsWith(".html") && !req.url.endsWith(".ico")) {
    console.log(`[REQUEST] ${req.method} ${req.url} headers:`, JSON.stringify(req.headers["content-type"] || "none"), "body:", JSON.stringify(req.body));
  }
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, "../public")));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ─── SendSpeed callback (preserved from callback-server.js) ───
app.post("/callback/sendspeed", (req, res) => {
  console.log(`[SendSpeed Callback] RAW BODY:`, JSON.stringify(req.body));
  const callbacks = Array.isArray(req.body) ? req.body : [req.body];
  for (const cb of callbacks) {
    if (cb.messageId && cb.status) {
      console.log(`[SendSpeed Callback] traceId=${cb.messageId} status=${cb.status}`);
      db.updateSendspeedCallback(cb.messageId, cb.status);
    }
  }
  // Responder no formato que a SendSpeed espera
  const first = callbacks[0];
  res.json({ messageId: first?.messageId || "", message: "OK", status: 200 });
});

// ─── API routes ───
app.use("/api/campaigns", campaignsRouter);
app.use("/api/reports", reportsRouter);

// Available routes
app.get("/api/routes", (req, res) => {
  res.json(routes.map((r) => ({ id: r.id, name: r.name, supplier: r.supplier, type: r.type, tier: r.tier })));
});

// Available networks (from config + optional TelQ live)
app.get("/api/networks", async (req, res) => {
  try {
    const live = await telq.getNetworks();
    res.json(live);
  } catch {
    // Fallback to configured networks
    res.json(targetNetworks);
  }
});

// Dashboard summary
app.get("/api/dashboard", (req, res) => {
  const latestRun = db.getLatestRun();
  const runs = db.getTestRuns(5);

  let summary = { latestRun: null, overallRate: 0, bestRoute: null, alerts: [], recentRuns: runs };

  if (latestRun) {
    const results = db.getRunResults(latestRun.id);
    const scores = db.getRunScores(latestRun.id);
    const total = results.length;
    const delivered = results.filter((r) => r.telq_status === "POSITIVE").length;
    const fakeDlrs = results.filter((r) => r.fake_dlr === 1).length;

    const best = scores.length ? scores.reduce((a, b) => (a.score > b.score ? a : b)) : null;

    const alerts = [];
    for (const s of scores) {
      if (s.delivery_rate < 80) alerts.push(`${s.route_name} → ${s.network_name}: ${s.delivery_rate}% entrega`);
      if (s.fake_dlr_rate > 5) alerts.push(`${s.route_name} → ${s.network_name}: ${s.fake_dlr_rate}% fake DLR`);
    }

    summary = {
      latestRun,
      totalTests: total,
      overallRate: total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0,
      fakeDlrs,
      bestRoute: best ? `${best.route_name} (${best.score})` : null,
      alerts,
      recentRuns: runs,
      scores,
    };
  }

  res.json(summary);
});

// AI campaign builder — natural language → structured config
app.post("/api/campaign-ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  const routesList = routes.map((r) => `ID ${r.id}: ${r.name} (${r.supplier} - ${r.type})`).join("\n");

  // Get all Brazilian networks from TelQ for the AI to know about
  let networksList;
  try {
    const live = await telq.getNetworks();
    const seen = new Set();
    const unique = live.filter((n) => {
      const key = `${n.mcc}-${n.mnc}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    networksList = unique.map((n) => `MCC ${n.mcc} MNC ${n.mnc}: ${n.name || n.providerName || "MNC " + n.mnc}`).join("\n");
  } catch {
    networksList = targetNetworks.map((n) => `MCC ${n.mcc} MNC ${n.mnc}: ${n.name}`).join("\n");
  }

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Voce e um assistente que monta campanhas de teste de SMS. O usuario vai descrever o que quer em linguagem natural e voce deve retornar APENAS um JSON valido (sem markdown, sem explicacao) com a estrutura da campanha.

Rotas disponiveis:
${routesList}

Operadoras disponiveis (brasileiras):
${networksList}

Estrutura do JSON de resposta:
{
  "name": "Nome da campanha",
  "route_mode": "qty" ou "pct",
  "total_tests": numero ou null (obrigatorio se route_mode = "pct"),
  "routes": [{"id": ID_NUMERICO, "value": NUMERO}],
  "networks": [
    {"mcc": "724", "mnc": "05", "name": "Claro", "percentage": 25},
    {"other": true, "percentage": 25}
  ],
  "cron_schedule": "cron string ou null",
  "personal_numbers": [array de telefones ou null]
}

REGRAS:
- route_mode "qty": cada rota tem "value" = quantidade absoluta de disparos
- route_mode "pct": cada rota tem "value" = percentual (soma = 100%), e "total_tests" e obrigatorio
- networks: cada operadora tem "percentage" (soma de todos = 100%)
- Se o usuario mencionar "outras operadoras" ou quiser cobrir operadoras menores, adicione {"other": true, "percentage": X}
- Se o usuario disser "todas as rotas", inclua todas. Se disser "Sona" inclua todas as rotas Sona. Mesma logica para fornecedor/tipo.
- Se nao especificar cron, use null.
- Se o usuario der quantidades absolutas por rota (ex: "100 da Sona, 120 da Pushfy"), use route_mode "qty".
- Se o usuario falar em % por rota, use route_mode "pct".
- As 3 operadoras principais sao Claro (724-05), TIM (724-02), Vivo (724-06). Se o usuario nao especificar distribuicao, use partes iguais entre as mencionadas.

Pedido do usuario: ${prompt}`,
        },
      ],
    });

    const text = msg.content[0].text.trim();
    const json = JSON.parse(text);
    res.json(json);
  } catch (err) {
    console.error("[AI Campaign]", err.message);
    res.status(500).json({ error: "Falha ao interpretar. Tente reformular." });
  }
});

// ─── Sheets management endpoints ───
app.post("/api/sheets/rebuild", async (req, res) => {
  const sheets = require("./sheets");
  res.json({ ok: true, message: "Rebuild started" });
  try {
    await sheets.rebuildAllSheets();
    console.log("[API] Sheets rebuild complete");
  } catch (err) {
    console.error("[API] Sheets rebuild failed:", err.message);
  }
});

app.post("/api/sheets/format", async (req, res) => {
  const sheets = require("./sheets");
  try {
    await sheets.applyFormatting();
    res.json({ ok: true, message: "Formatting applied" });
  } catch (err) {
    console.error("[API] Sheets format failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Run test now (ad-hoc, uses all routes/networks)
app.post("/api/run-now", async (req, res) => {
  const { runFullTest } = require("./run-test");
  res.json({ ok: true, message: "Test started" });
  try {
    await runFullTest();
  } catch (err) {
    console.error("[API] Ad-hoc test failed:", err.message);
  }
});

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(config.callbackServer.port, () => {
      console.log(`[Server] listening on port ${config.callbackServer.port}`);
      console.log(`[Server] Dashboard: http://localhost:${config.callbackServer.port}`);
      resolve(server);
    });
  });
}

module.exports = { startServer, app };
