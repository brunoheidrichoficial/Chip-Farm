let allCampaigns = [];

async function loadDashboard() {
  try {
    const [campRes, runsRes, filterRes] = await Promise.all([
      fetch("/api/campaigns"),
      fetch("/api/dashboard"),
      fetch("/api/reports/filter-options"),
    ]);
    allCampaigns = await campRes.json();
    const dash = await runsRes.json();
    const filterOptions = await filterRes.json();

    renderCampaigns(allCampaigns);
    renderRuns(dash.recentRuns || []);
    populateFilters(allCampaigns, filterOptions);

    // Auto-load all results on first visit
    applyFilters();
  } catch (err) {
    console.error("Failed to load dashboard:", err);
  }
}

function populateFilters(campaigns, filterOptions) {
  // Campaigns
  const campSelect = document.getElementById("filterCampaigns");
  campSelect.innerHTML = campaigns
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");

  // Routes
  const routeSelect = document.getElementById("filterRoutes");
  routeSelect.innerHTML = filterOptions.routes
    .map((r) => `<option value="${r.route_id}">${r.route_name}</option>`)
    .join("");

  // Networks
  const netSelect = document.getElementById("filterNetworks");
  netSelect.innerHTML = filterOptions.networks
    .map((n) => `<option value="${n}">${n}</option>`)
    .join("");
}

function getSelectedValues(selectId) {
  const select = document.getElementById(selectId);
  return Array.from(select.selectedOptions).map((o) => o.value).filter(Boolean);
}

async function applyFilters() {
  const params = new URLSearchParams();

  const campaigns = getSelectedValues("filterCampaigns");
  if (campaigns.length) params.set("campaigns", campaigns.join(","));

  const dateFrom = document.getElementById("filterDateFrom").value;
  const dateTo = document.getElementById("filterDateTo").value;
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  const routes = getSelectedValues("filterRoutes");
  if (routes.length) params.set("routes", routes.join(","));

  const networks = getSelectedValues("filterNetworks");
  if (networks.length) params.set("networks", networks.join(","));

  try {
    const res = await fetch(`/api/reports/aggregated?${params}`);
    const data = await res.json();
    renderResults(data);
  } catch (err) {
    console.error("Failed to load results:", err);
  }
}

function clearFilters() {
  document.getElementById("filterCampaigns").selectedIndex = -1;
  document.getElementById("filterDateFrom").value = "";
  document.getElementById("filterDateTo").value = "";
  document.getElementById("filterRoutes").selectedIndex = -1;
  document.getElementById("filterNetworks").selectedIndex = -1;
  applyFilters();
}

function renderResults(data) {
  const container = document.getElementById("routeResults");
  const summaryContainer = document.getElementById("globalSummary");

  if (!data.length) {
    summaryContainer.style.display = "none";
    container.innerHTML = '<div class="no-data">Nenhum resultado encontrado para os filtros selecionados</div>';
    return;
  }

  // Global summary
  const gSent = data.reduce((s, r) => s + r.sent, 0);
  const gDelivered = data.reduce((s, r) => s + r.delivered, 0);
  const gUndelivered = data.reduce((s, r) => s + r.undelivered, 0);
  const gFakeDlrs = data.reduce((s, r) => s + r.fake_dlrs, 0);
  const gRate = gSent > 0 ? Math.round((gDelivered / gSent) * 1000) / 10 : 0;
  const latencies = data.filter((r) => r.avg_latency != null);
  const gLatency = latencies.length
    ? (latencies.reduce((s, r) => s + r.avg_latency * r.sent, 0) / latencies.reduce((s, r) => s + r.sent, 0)).toFixed(1)
    : null;

  summaryContainer.style.display = "grid";
  document.getElementById("gSent").textContent = gSent;
  document.getElementById("gDelivered").textContent = gDelivered;

  const rateEl = document.getElementById("gRate");
  rateEl.textContent = gRate + "%";
  rateEl.className = "card-value " + (gRate >= 95 ? "good" : gRate >= 80 ? "warn" : "bad");

  const fakeDlrEl = document.getElementById("gFakeDlrs");
  fakeDlrEl.textContent = gFakeDlrs;
  fakeDlrEl.className = "card-value " + (gFakeDlrs === 0 ? "good" : "bad");

  document.getElementById("gLatency").textContent = gLatency ? gLatency + "s" : "N/A";

  // Group by route
  const byRoute = {};
  for (const row of data) {
    const key = row.route_id;
    if (!byRoute[key]) {
      byRoute[key] = {
        route_id: row.route_id,
        route_name: row.route_name,
        supplier: row.supplier,
        route_type: row.route_type,
        networks: [],
        // Totals
        sent: 0,
        delivered: 0,
        undelivered: 0,
        fake_dlrs: 0,
        latencySum: 0,
        latencyCount: 0,
      };
    }
    const group = byRoute[key];
    group.networks.push(row);
    group.sent += row.sent;
    group.delivered += row.delivered;
    group.undelivered += row.undelivered;
    group.fake_dlrs += row.fake_dlrs;
    if (row.avg_latency != null) {
      group.latencySum += row.avg_latency * row.sent;
      group.latencyCount += row.sent;
    }
  }

  // Render route panels
  let html = "";
  const routeGroups = Object.values(byRoute).sort((a, b) => a.route_name.localeCompare(b.route_name));

  for (const route of routeGroups) {
    const totalRate = route.sent > 0 ? Math.round((route.delivered / route.sent) * 1000) / 10 : 0;
    const totalFakeDlrRate = route.sent > 0 ? Math.round((route.fake_dlrs / route.sent) * 1000) / 10 : 0;
    const totalLatency = route.latencyCount > 0 ? (route.latencySum / route.latencyCount).toFixed(1) : null;
    const fakeDlrRate2 = route.sent > 0 ? route.fake_dlrs / route.sent : 0;
    const latScore = totalLatency != null ? Math.max(0, 1 - parseFloat(totalLatency) / 10) : 0.5;
    const totalScore = Math.round(((route.delivered / Math.max(route.sent, 1)) * 70 + (1 - fakeDlrRate2) * 20 + latScore * 10) * 100) / 100;

    const rateClass = totalRate >= 95 ? "good" : totalRate >= 80 ? "warn" : "bad";
    const fakeDlrClass = route.fake_dlrs === 0 ? "good" : "bad";

    html += `
    <div class="route-panel">
      <div class="route-header">
        <div>
          <span class="route-name">${route.route_name}</span>
          <span class="route-supplier">${route.supplier} - ${route.route_type}</span>
        </div>
        <div class="route-summary-badges">
          <div class="stat"><div class="stat-value">${totalRate}%</div>entrega</div>
          <div class="stat"><div class="stat-value">${totalScore}</div>score</div>
        </div>
      </div>
      <div class="route-totals">
        <div class="total-cell"><div class="total-label">Enviados</div><div class="total-value">${route.sent}</div></div>
        <div class="total-cell"><div class="total-label">Entregues</div><div class="total-value ${rateClass}">${route.delivered}</div></div>
        <div class="total-cell"><div class="total-label">Nao Entregues</div><div class="total-value ${route.undelivered > 0 ? "bad" : "good"}">${route.undelivered}</div></div>
        <div class="total-cell"><div class="total-label">Taxa Entrega</div><div class="total-value ${rateClass}">${totalRate}%</div></div>
        <div class="total-cell"><div class="total-label">Fake DLR</div><div class="total-value ${fakeDlrClass}">${route.fake_dlrs} (${totalFakeDlrRate}%)</div></div>
        <div class="total-cell"><div class="total-label">Latencia</div><div class="total-value">${totalLatency ? totalLatency + "s" : "N/A"}</div></div>
        <div class="total-cell"><div class="total-label">Score</div><div class="total-value">${totalScore}</div></div>
      </div>
      <div class="route-body">
        <table>
          <thead>
            <tr>
              <th>Operadora</th>
              <th>Enviados</th>
              <th>Entregues</th>
              <th>Nao Entregues</th>
              <th>Taxa Entrega</th>
              <th>Fake DLR</th>
              <th>Latencia</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>`;

    const sortedNetworks = route.networks.sort((a, b) => b.score - a.score);
    for (const net of sortedNetworks) {
      const netRateClass = net.delivery_rate >= 95 ? "badge-green" : net.delivery_rate >= 80 ? "badge-yellow" : "badge-red";
      const netFakeBadge = net.fake_dlr_rate > 0 ? "badge-red" : "badge-green";
      const netLatency = net.avg_latency != null ? net.avg_latency + "s" : "N/A";

      html += `
            <tr>
              <td><strong>${net.network_name}</strong></td>
              <td>${net.sent}</td>
              <td>${net.delivered}</td>
              <td>${net.undelivered}</td>
              <td><span class="badge ${netRateClass}">${net.delivery_rate}%</span></td>
              <td><span class="badge ${netFakeBadge}">${net.fake_dlrs} (${net.fake_dlr_rate}%)</span></td>
              <td>${netLatency}</td>
              <td><strong>${net.score}</strong></td>
            </tr>`;
    }

    html += `
          </tbody>
        </table>
      </div>
    </div>`;
  }

  container.innerHTML = html;
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
      const routeData = JSON.parse(c.routes);
      const networks = JSON.parse(c.networks);
      const isNew = routeData.length > 0 && typeof routeData[0] === "object";

      let configText;
      if (isNew) {
        const mode = c.route_mode === "pct" ? "%" : "qtd";
        configText = `${mode}${c.total_tests ? " / " + c.total_tests + " total" : ""}`;
      } else {
        configText = `${c.tests_per_combo}/combo`;
      }

      const netNames = networks
        .map((n) => {
          if (n.other) return `Outras (${n.percentage || "?"}%)`;
          return n.name ? `${n.name}${n.percentage ? " " + n.percentage + "%" : ""}` : "?";
        })
        .join(", ");

      return `<tr>
        <td><strong>${c.name}</strong></td>
        <td>${routeData.length} rotas</td>
        <td>${netNames}</td>
        <td>${configText}</td>
        <td>${c.cron_schedule || "--"}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="runCampaign(${c.id})">Rodar</button>
          <a href="/campaign.html?id=${c.id}" class="btn btn-sm btn-secondary">Editar</a>
        </td>
      </tr>`;
    })
    .join("");
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
