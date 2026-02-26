async function loadDashboard() {
  try {
    const [dashRes, campRes] = await Promise.all([
      fetch("/api/dashboard"),
      fetch("/api/campaigns"),
    ]);
    const dash = await dashRes.json();
    const campaigns = await campRes.json();

    renderCards(dash);
    renderRuns(dash.recentRuns || []);
    renderScores(dash.scores || []);
    renderCampaigns(campaigns);
  } catch (err) {
    console.error("Failed to load dashboard:", err);
  }
}

function renderCards(dash) {
  if (dash.latestRun) {
    const d = new Date(dash.latestRun.started_at + "Z");
    document.getElementById("lastRun").textContent = `Run #${dash.latestRun.id}`;
    document.getElementById("lastRunDetail").textContent = d.toLocaleString("pt-BR");

    const rate = dash.overallRate;
    const rateEl = document.getElementById("deliveryRate");
    rateEl.textContent = rate + "%";
    rateEl.className = "card-value " + (rate >= 95 ? "good" : rate >= 80 ? "warn" : "bad");
    document.getElementById("deliveryDetail").textContent =
      `${dash.totalTests} testes | ${dash.fakeDlrs} fake DLRs`;

    document.getElementById("bestRoute").textContent = dash.bestRoute || "--";

    const alerts = dash.alerts || [];
    document.getElementById("alertCount").textContent = alerts.length;
    document.getElementById("alertCount").className =
      "card-value " + (alerts.length === 0 ? "good" : "bad");
    document.getElementById("alertDetail").textContent =
      alerts.length ? alerts[0] : "Tudo OK";
  }
}

function renderRuns(runs) {
  const tbody = document.getElementById("runsTable");
  if (!runs.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><div class="icon">🌱</div><p>Nenhum teste executado ainda</p></td></tr>';
    return;
  }
  tbody.innerHTML = runs
    .map((r) => {
      const d = new Date(r.started_at + "Z");
      const statusBadge =
        r.status === "done"
          ? '<span class="badge badge-green">Concluido</span>'
          : '<span class="badge badge-yellow">Rodando...</span>';
      return `<tr>
        <td><strong>#${r.id}</strong></td>
        <td>${d.toLocaleString("pt-BR")}</td>
        <td>${r.total_tests || "--"}</td>
        <td>${statusBadge}</td>
        <td><a href="/report.html?runId=${r.id}" class="btn btn-sm btn-secondary">Ver Relatorio</a></td>
      </tr>`;
    })
    .join("");
}

function renderScores(scores) {
  const panel = document.getElementById("scoresPanel");
  const content = document.getElementById("scoresContent");
  if (!scores.length) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";

  // Group by network
  const byNetwork = {};
  for (const s of scores) {
    if (!byNetwork[s.network_name]) byNetwork[s.network_name] = [];
    byNetwork[s.network_name].push(s);
  }

  let html = "";
  for (const [network, nScores] of Object.entries(byNetwork)) {
    const sorted = nScores.sort((a, b) => b.score - a.score);
    html += `<h3 style="margin:16px 0 8px;font-size:15px;color:var(--green-dark)">${network}</h3>`;
    html += '<div class="table-wrap"><table><thead><tr><th>Rota</th><th>Entrega</th><th>Latencia</th><th>Fake DLR</th><th>Score</th></tr></thead><tbody>';
    for (const s of sorted) {
      const badgeClass =
        s.delivery_rate >= 95 ? "badge-green" : s.delivery_rate >= 80 ? "badge-yellow" : "badge-red";
      const latency = s.avg_latency != null ? s.avg_latency + "s" : "N/A";
      html += `<tr>
        <td>${s.route_name}<br><small style="color:var(--text-light)">${s.supplier}</small></td>
        <td><span class="badge ${badgeClass}">${s.delivery_rate}%</span></td>
        <td>${latency}</td>
        <td>${s.fake_dlr_rate}%</td>
        <td><strong>${s.score}</strong></td>
      </tr>`;
    }
    html += "</tbody></table></div>";
  }
  content.innerHTML = html;
}

function renderCampaigns(campaigns) {
  const tbody = document.getElementById("campaignsTable");
  if (!campaigns.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="empty-state"><div class="icon">📋</div><p>Nenhuma campanha criada</p></td></tr>';
    return;
  }
  tbody.innerHTML = campaigns
    .map((c) => {
      const routeIds = JSON.parse(c.routes);
      const networks = JSON.parse(c.networks);
      return `<tr>
        <td><strong>${c.name}</strong></td>
        <td>${routeIds.length} rotas</td>
        <td>${networks.map((n) => n.name).join(", ")}</td>
        <td>${c.tests_per_combo}</td>
        <td>${c.cron_schedule || "--"}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="runCampaign(${c.id})">Rodar</button>
          <a href="/campaign.html?id=${c.id}" class="btn btn-sm btn-secondary">Editar</a>
        </td>
      </tr>`;
    })
    .join("");
}

async function runNow() {
  const btn = document.getElementById("btnRunNow");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Rodando...';
  showToast("Teste iniciado! Aguarde os resultados...", "success");
  try {
    await fetch("/api/run-now", { method: "POST" });
  } catch (err) {
    showToast("Erro ao iniciar teste", "error");
  }
  btn.disabled = false;
  btn.innerHTML = "🚜 Rodar Teste Agora";
}

async function runCampaign(id) {
  showToast("Campanha disparada!", "success");
  try {
    await fetch(`/api/campaigns/${id}/run`, { method: "POST" });
  } catch (err) {
    showToast("Erro ao disparar campanha", "error");
  }
}

function showToast(msg, type) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

loadDashboard();
