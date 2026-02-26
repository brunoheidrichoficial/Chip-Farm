const { config } = require("./config");

async function sendMessage(text) {
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;

  // Telegram max message length is 4096
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, 4000));
    remaining = remaining.slice(4000);
  }

  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text: chunk,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      console.error(`[Telegram] Failed to send: ${res.status} ${await res.text()}`);
    }
  }
}

// Format the daily report for Telegram
function formatReport(scores, runResults, runId) {
  const now = new Date().toLocaleDateString("pt-BR");
  const totalTests = runResults.length;
  const delivered = runResults.filter((r) => r.telq_status === "POSITIVE").length;
  const overallRate = totalTests > 0 ? ((delivered / totalTests) * 100).toFixed(1) : "0";
  const fakeDlrs = runResults.filter((r) => r.fake_dlr === 1).length;

  let msg = `<b>RELATORIO DIARIO - ${now}</b>\n`;
  msg += `<b>Run #${runId}</b>\n\n`;
  msg += `Testes: ${totalTests} | Entrega real: ${overallRate}% | Fake DLRs: ${fakeDlrs}\n`;
  msg += `${"─".repeat(40)}\n\n`;

  // Group scores by network
  const byNetwork = {};
  for (const s of scores) {
    if (!byNetwork[s.networkName]) byNetwork[s.networkName] = [];
    byNetwork[s.networkName].push(s);
  }

  for (const [network, networkScores] of Object.entries(byNetwork)) {
    const sorted = networkScores.sort((a, b) => b.score - a.score);
    msg += `<b>${network}</b>\n`;

    for (const s of sorted) {
      const icon = s.deliveryRate >= 95 ? "🟢" : s.deliveryRate >= 80 ? "🟡" : "🔴";
      const latency = s.avgLatency != null ? `${s.avgLatency}s` : "N/A";
      const fakeDlr = s.fakeDlrRate > 0 ? ` | FakeDLR: ${s.fakeDlrRate}%` : "";
      msg += `${icon} ${s.routeName}: ${s.deliveryRate}% | ${latency}${fakeDlr} | Score: ${s.score}\n`;
    }
    msg += "\n";
  }

  // Best route per network
  msg += `<b>RECOMENDACAO</b>\n`;
  for (const [network, networkScores] of Object.entries(byNetwork)) {
    const best = networkScores.sort((a, b) => b.score - a.score)[0];
    if (best) msg += `→ ${network}: usar <b>${best.routeName}</b> (${best.deliveryRate}%)\n`;
  }

  // Alerts
  const alerts = [];
  for (const s of scores) {
    if (s.deliveryRate < 80) alerts.push(`${s.routeName} para ${s.networkName}: apenas ${s.deliveryRate}% entrega`);
    if (s.fakeDlrRate > 5) alerts.push(`${s.routeName} para ${s.networkName}: ${s.fakeDlrRate}% fake DLR`);
  }

  if (alerts.length) {
    msg += `\n<b>ALERTAS</b>\n`;
    for (const a of alerts) msg += `⚠ ${a}\n`;
  }

  return msg;
}

module.exports = { sendMessage, formatReport };
