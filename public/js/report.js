let allResults = [];
let detailsExpanded = false;

async function init() {
  const params = new URLSearchParams(window.location.search);
  const runId = params.get("runId");
  if (!runId) {
    document.getElementById("reportTitle").textContent = "Run nao especificado";
    return;
  }

  document.getElementById("reportTitle").textContent = `Relatorio - Run #${runId}`;

  const [reportRes, scoresRes] = await Promise.all([
    fetch(`/api/reports/${runId}`),
    fetch(`/api/reports/${runId}/scores`),
  ]);

  if (!reportRes.ok) {
    document.getElementById("reportTitle").textContent = "Run nao encontrado";
    return;
  }

  const report = await reportRes.json();
  const scores = await scoresRes.json();

  allResults = report.results || [];
  renderSummary(allResults);
  renderScores(scores);
  renderResults(allResults);
}

function renderSummary(results) {
  const total = results.length;
  const delivered = results.filter((r) => r.telq_status === "POSITIVE").length;
  const fakeDlrs = results.filter((r) => r.fake_dlr === 1).length;
  const latencies = results
    .filter((r) => r.telq_delay_seconds != null)
    .map((r) => r.telq_delay_seconds);
  const avgLat = latencies.length
    ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)
    : null;

  document.getElementById("totalTests").textContent = total;

  const rate = total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0;
  const rateEl = document.getElementById("deliveryRate");
  rateEl.textContent = rate + "%";
  rateEl.className = "card-value " + (rate >= 95 ? "good" : rate >= 80 ? "warn" : "bad");

  const fakeDlrEl = document.getElementById("fakeDlrs");
  fakeDlrEl.textContent = fakeDlrs;
  fakeDlrEl.className = "card-value " + (fakeDlrs === 0 ? "good" : "bad");

  document.getElementById("avgLatency").textContent = avgLat ? avgLat + "s" : "N/A";
}

function renderScores(scores) {
  const content = document.getElementById("scoresContent");
  if (!scores.length) {
    content.innerHTML =
      '<div class="empty-state"><div class="icon">📊</div><p>Sem scores calculados para este run</p></div>';
    return;
  }

  // Group by tier, then by route within tier
  const TIER_ORDER = ["DIAMOND", "PLATINUM", "GOLD", "SILVER", "OTP", ""];
  const byTier = {};
  for (const s of scores) {
    const tier = s.tier || "";
    if (!byTier[tier]) byTier[tier] = {};
    const key = s.route_id || s.route_name;
    if (!byTier[tier][key]) byTier[tier][key] = { route_name: s.route_name, supplier: s.supplier, networks: [] };
    byTier[tier][key].networks.push(s);
  }

  let html = "";
  for (const tier of TIER_ORDER) {
    const tierRoutes = byTier[tier];
    if (!tierRoutes) continue;

    if (tier) {
      html += `<div style="display:flex;align-items:center;gap:12px;margin:28px 0 12px;padding:10px 20px;background:linear-gradient(135deg,#1c4e6b,#2a7a9b);border-radius:10px;color:white;font-size:16px;font-weight:700;letter-spacing:1px">${tier}</div>`;
    }

    for (const [, group] of Object.entries(tierRoutes)) {
      const sorted = group.networks.sort((a, b) => b.score - a.score);

      const totalSamples = sorted.reduce((s, n) => s + n.sample_size, 0);
      const totalDelivered = sorted.reduce((s, n) => s + Math.round(n.delivery_rate * n.sample_size / 100), 0);
      const totalRate = totalSamples > 0 ? Math.round((totalDelivered / totalSamples) * 1000) / 10 : 0;

      html += `<h3 style="margin:16px 0 8px;font-size:15px;color:var(--green-dark)">${group.route_name} <small style="color:var(--text-light);font-weight:400">${group.supplier} | ${totalSamples} testes | ${totalRate}% entrega</small></h3>`;
      html +=
        '<div class="table-wrap"><table><thead><tr><th>Operadora</th><th>Entrega</th><th>Latencia</th><th>Fake DLR</th><th>Score</th><th>Amostras</th></tr></thead><tbody>';
      for (const s of sorted) {
        const badgeClass =
          s.delivery_rate >= 95
            ? "badge-green"
            : s.delivery_rate >= 80
            ? "badge-yellow"
            : "badge-red";
        const latency = s.avg_latency != null ? s.avg_latency + "s" : "N/A";
        const fakeBadge = s.fake_dlr_rate > 0 ? "badge-red" : "badge-green";
        html += `<tr>
          <td><strong>${s.network_name}</strong></td>
          <td><span class="badge ${badgeClass}">${s.delivery_rate}%</span></td>
          <td>${latency}</td>
          <td><span class="badge ${fakeBadge}">${s.fake_dlr_rate}%</span></td>
          <td><strong>${s.score}</strong></td>
          <td>${s.sample_size}</td>
        </tr>`;
      }
      html += "</tbody></table></div>";
    }
  }
  content.innerHTML = html;
}

function renderResults(results) {
  const tbody = document.getElementById("resultsTable");
  if (!results.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-state"><p>Sem resultados</p></td></tr>';
    return;
  }

  tbody.innerHTML = results
    .map((r) => {
      const ssStatus = r.sendspeed_status
        ? `<span class="badge badge-green">${r.sendspeed_status}</span>`
        : '<span class="badge badge-yellow">Pendente</span>';

      let telqBadge;
      if (r.telq_status === "POSITIVE")
        telqBadge = '<span class="badge badge-green">POSITIVE</span>';
      else if (r.telq_status === "NOT_DELIVERED")
        telqBadge = '<span class="badge badge-red">NOT_DELIVERED</span>';
      else if (r.telq_status)
        telqBadge = `<span class="badge badge-yellow">${r.telq_status}</span>`;
      else telqBadge = '<span class="badge badge-yellow">Pendente</span>';

      const latency =
        r.telq_delay_seconds != null ? r.telq_delay_seconds.toFixed(1) + "s" : "--";

      const fakeDlr = r.fake_dlr
        ? '<span class="badge badge-red">SIM</span>'
        : '<span class="badge badge-green">NAO</span>';

      return `<tr>
        <td>${r.route_name}<br><small style="color:var(--text-light)">${r.supplier}</small></td>
        <td>${r.network_name}</td>
        <td><small>${r.telq_phone || "--"}</small></td>
        <td>${ssStatus}</td>
        <td>${telqBadge}</td>
        <td>${latency}</td>
        <td>${fakeDlr}</td>
      </tr>`;
    })
    .join("");
}

function toggleDetails() {
  detailsExpanded = !detailsExpanded;
  // For now just scroll to the results table
  document.getElementById("resultsTable").scrollIntoView({ behavior: "smooth" });
}

init();
