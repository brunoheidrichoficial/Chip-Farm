const { config, TIERS, getRouteTier } = require("./config");

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

// Format the daily report for Telegram — grouped by tier
function formatReport(scores, runResults, runId) {
  const now = new Date().toLocaleDateString("pt-BR");
  // Filter out TEST_NUMBER_OFFLINE — TelQ chip offline, not a route issue
  const validResults = runResults.filter((r) => r.telq_status !== "TEST_NUMBER_OFFLINE");
  const totalTests = validResults.length;
  const delivered = validResults.filter((r) => r.telq_status === "POSITIVE").length;
  const overallRate = totalTests > 0 ? ((delivered / totalTests) * 100).toFixed(1) : "0";
  const fakeDlrs = validResults.filter((r) => r.fake_dlr === 1).length;

  // Compute SendSpeed callback stats per route/network
  const cbStats = {};
  for (const r of validResults) {
    const key = `${r.route_id}__${r.network_name}`;
    if (!cbStats[key]) cbStats[key] = { total: 0, delivered: 0, failed: 0, pending: 0 };
    cbStats[key].total++;
    if (r.sendspeed_status === "delivered") cbStats[key].delivered++;
    else if (r.sendspeed_status === "failed" || r.sendspeed_status === "undelivered" || r.sendspeed_status === "invalid") cbStats[key].failed++;
    else cbStats[key].pending++;
  }

  let msg = `<b>RELATORIO DIARIO - ${now}</b>\n`;
  msg += `<b>Run #${runId}</b>\n\n`;
  msg += `Testes: ${totalTests} | Entrega real: ${overallRate}% | Fake DLRs: ${fakeDlrs}\n`;
  msg += `${"─".repeat(40)}\n\n`;

  // Group scores by tier
  const byTier = {};
  for (const s of scores) {
    const tier = s.tier || getRouteTier(s.routeId) || "SEM_TIER";
    if (!byTier[tier]) byTier[tier] = [];
    byTier[tier].push(s);
  }

  // Iterate tiers in defined order
  const tierOrder = [...TIERS, "SEM_TIER"];
  for (const tier of tierOrder) {
    const tierScores = byTier[tier];
    if (!tierScores || !tierScores.length) continue;

    msg += `<b>━━━ ${tier} ━━━</b>\n\n`;

    // Group by network within tier
    const byNetwork = {};
    for (const s of tierScores) {
      if (!byNetwork[s.networkName]) byNetwork[s.networkName] = [];
      byNetwork[s.networkName].push(s);
    }

    for (const [network, networkScores] of Object.entries(byNetwork)) {
      const sorted = networkScores.sort((a, b) => b.score - a.score);
      msg += `<b>${network}</b>\n`;

      for (const s of sorted) {
        const icon = s.deliveryRate >= 95 ? "🟢" : s.deliveryRate >= 80 ? "🟡" : "🔴";
        const latency = s.avgLatency != null ? `${s.avgLatency}s` : "N/A";

        const cb = cbStats[`${s.routeId}__${s.networkName}`];
        const cbRate = cb && cb.total > 0 ? Math.round((cb.delivered / cb.total) * 10000) / 100 : null;
        const cbLabel = cbRate != null ? ` | CB: ${cbRate}%` : "";
        const fakeDlrFlag = s.fakeDlrRate > 0 ? ` | FakeDLR: ${s.fakeDlrRate}%` : "";

        msg += `${icon} ${s.routeName}: ${s.deliveryRate}% | ${latency}${cbLabel}${fakeDlrFlag} | Score: ${s.score}\n`;
      }
      msg += "\n";
    }

    // Recommendation per tier — best route per network WITHIN this tier
    msg += `<b>RECOMENDACAO ${tier}</b>\n`;
    for (const [network, networkScores] of Object.entries(byNetwork)) {
      const best = networkScores.sort((a, b) => b.score - a.score)[0];
      if (best) {
        const latency = best.avgLatency != null ? ` | ${best.avgLatency}s` : "";
        msg += `→ ${network}: usar <b>${best.routeName}</b> (${best.deliveryRate}%${latency})\n`;
      }
    }
    msg += "\n";
  }

  // Alerts — global across all tiers
  const alerts = [];
  for (const s of scores) {
    if (s.deliveryRate < 80) alerts.push(`${s.routeName} para ${s.networkName}: apenas ${s.deliveryRate}% entrega`);
    if (s.fakeDlrRate > 5) alerts.push(`${s.routeName} para ${s.networkName}: ${s.fakeDlrRate}% fake DLR`);

    const cb = cbStats[`${s.routeId}__${s.networkName}`];
    if (cb) {
      const cbRate = Math.round((cb.delivered / cb.total) * 10000) / 100;
      if (cbRate >= 95 && s.deliveryRate < 80) {
        alerts.push(`${s.routeName} para ${s.networkName}: CB diz ${cbRate}% mas entrega real ${s.deliveryRate}%`);
      }
    }
  }

  if (alerts.length) {
    msg += `<b>ALERTAS</b>\n`;
    for (const a of alerts) msg += `⚠ ${a}\n`;
  }

  return msg;
}

module.exports = { sendMessage, formatReport };
