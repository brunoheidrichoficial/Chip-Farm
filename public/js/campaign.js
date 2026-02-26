let allRoutes = [];
let allNetworks = [];
let personalNumbers = [];
let editingId = null;
let routeMode = "qty"; // "qty" or "pct"

async function init() {
  const params = new URLSearchParams(window.location.search);
  editingId = params.get("id");

  const [routesRes, networksRes] = await Promise.all([
    fetch("/api/routes"),
    fetch("/api/networks"),
  ]);
  allRoutes = await routesRes.json();
  allNetworks = await networksRes.json();

  renderRoutes();
  renderNetworks();

  if (editingId) {
    document.getElementById("formTitle").textContent = "Editar Campanha";
    const res = await fetch(`/api/campaigns/${editingId}`);
    const campaign = await res.json();
    loadCampaign(campaign);
  }
}

function setRouteMode(mode) {
  routeMode = mode;
  document.querySelectorAll("#routeModeToggle button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  const totalRow = document.getElementById("totalTestsRow");
  totalRow.classList.toggle("visible", mode === "pct");

  // Update unit labels
  document.querySelectorAll(".route-unit-label").forEach((el) => {
    el.textContent = mode === "pct" ? "%" : "qtd";
  });

  updateRoutePctSummary();
}

function renderRoutes() {
  const grid = document.getElementById("routesGrid");
  grid.innerHTML = allRoutes
    .map(
      (r) => `
    <div class="route-row">
      <input type="checkbox" name="route" value="${r.id}" data-name="${r.name}" onchange="onRouteCheck(this)">
      <label class="route-info" onclick="this.previousElementSibling.click()">${r.name}<br><small>${r.supplier} - ${r.type}</small></label>
      <input type="number" class="route-value" data-route-id="${r.id}" min="1" value="10" disabled placeholder="0" oninput="updateRoutePctSummary()">
      <span class="unit route-unit-label">qtd</span>
    </div>`
    )
    .join("");
}

function onRouteCheck(cb) {
  const row = cb.closest(".route-row");
  const input = row.querySelector(".route-value");
  input.disabled = !cb.checked;
  if (cb.checked) input.focus();
  updateRoutePctSummary();
}

function updateRoutePctSummary() {
  if (routeMode !== "pct") {
    document.getElementById("routePctSummary").innerHTML = "";
    return;
  }
  const checked = document.querySelectorAll('input[name="route"]:checked');
  let sum = 0;
  checked.forEach((cb) => {
    const row = cb.closest(".route-row");
    const val = parseInt(row.querySelector(".route-value").value) || 0;
    sum += val;
  });
  const el = document.getElementById("routePctSummary");
  const cls = sum === 100 ? "ok" : sum > 100 ? "bad" : "warn";
  el.innerHTML = `<span class="pct-summary ${cls}">${sum}% / 100%</span>`;
}

function renderNetworks() {
  const grid = document.getElementById("networksGrid");

  // Fixed: only show the 3 main Brazilian carriers + "Outras"
  const mainCarriers = [
    { mcc: "724", mnc: "05", name: "Claro" },
    { mcc: "724", mnc: "02", name: "TIM" },
    { mcc: "724", mnc: "06", name: "Vivo" },
  ];

  const rows = mainCarriers
    .map(
      (n) => `
    <div class="network-row">
      <input type="checkbox" name="network" value="${n.mcc}-${n.mnc}" data-mcc="${n.mcc}" data-mnc="${n.mnc}" data-name="${n.name}" onchange="onNetworkCheck(this)">
      <label class="network-info" onclick="this.previousElementSibling.click()">${n.name}</label>
      <input type="number" class="network-pct" data-mcc="${n.mcc}" data-mnc="${n.mnc}" min="0" max="100" value="25" disabled placeholder="%" oninput="updateNetworkPctSummary()">
      <span class="unit">%</span>
    </div>`
    )
    .join("");

  // "Outras operadoras" = all TelQ Brazilian networks except Claro, TIM, Vivo
  const otherRow = `
    <div class="network-row other-row">
      <input type="checkbox" name="network-other" value="other" onchange="onNetworkCheck(this)">
      <label class="network-info" onclick="this.previousElementSibling.click()">Outras operadoras<br><small>Oi, Algar, Sercomtel e demais</small></label>
      <input type="number" class="network-pct" data-other="true" min="0" max="100" value="25" disabled placeholder="%" oninput="updateNetworkPctSummary()">
      <span class="unit">%</span>
    </div>`;

  grid.innerHTML = rows + otherRow;
}

function onNetworkCheck(cb) {
  const row = cb.closest(".network-row");
  const input = row.querySelector(".network-pct");
  input.disabled = !cb.checked;
  if (cb.checked) input.focus();
  updateNetworkPctSummary();
}

function updateNetworkPctSummary() {
  let sum = 0;
  // Regular networks
  document.querySelectorAll('input[name="network"]:checked').forEach((cb) => {
    const row = cb.closest(".network-row");
    const val = parseInt(row.querySelector(".network-pct").value) || 0;
    sum += val;
  });
  // Other
  const otherCb = document.querySelector('input[name="network-other"]:checked');
  if (otherCb) {
    const row = otherCb.closest(".network-row");
    const val = parseInt(row.querySelector(".network-pct").value) || 0;
    sum += val;
  }

  const el = document.getElementById("networkPctSummary");
  const cls = sum === 100 ? "ok" : sum > 100 ? "bad" : "warn";
  el.innerHTML = `<span class="pct-summary ${cls}">${sum}% / 100%</span>`;
}

function loadCampaign(c) {
  document.getElementById("name").value = c.name;

  const routesData = JSON.parse(c.routes);
  const networksData = JSON.parse(c.networks);

  // Detect new format (array of objects with id+value) vs old format (array of ids)
  const isNewRouteFormat = routesData.length > 0 && typeof routesData[0] === "object";

  if (c.route_mode) {
    setRouteMode(c.route_mode);
  }
  if (c.total_tests) {
    document.getElementById("totalTests").value = c.total_tests;
  }

  // Routes
  document.querySelectorAll('input[name="route"]').forEach((cb) => {
    if (isNewRouteFormat) {
      const match = routesData.find((r) => r.id === parseInt(cb.value));
      if (match) {
        cb.checked = true;
        const row = cb.closest(".route-row");
        const input = row.querySelector(".route-value");
        input.disabled = false;
        input.value = match.value;
      }
    } else {
      // Old format: array of IDs
      if (routesData.includes(parseInt(cb.value))) {
        cb.checked = true;
        const row = cb.closest(".route-row");
        row.querySelector(".route-value").disabled = false;
      }
    }
  });

  // Networks - detect new format (with percentage)
  const isNewNetworkFormat = networksData.length > 0 && networksData[0].percentage !== undefined;

  document.querySelectorAll('input[name="network"]').forEach((cb) => {
    const [mcc, mnc] = cb.value.split("-");
    const match = networksData.find((n) => n.mcc === mcc && n.mnc === mnc && !n.other);
    if (match) {
      cb.checked = true;
      const row = cb.closest(".network-row");
      const input = row.querySelector(".network-pct");
      input.disabled = false;
      if (isNewNetworkFormat && match.percentage != null) {
        input.value = match.percentage;
      }
    }
  });

  // Check "Outras" if present
  const otherEntry = networksData.find((n) => n.other);
  if (otherEntry) {
    const otherCb = document.querySelector('input[name="network-other"]');
    if (otherCb) {
      otherCb.checked = true;
      const row = otherCb.closest(".network-row");
      const input = row.querySelector(".network-pct");
      input.disabled = false;
      if (otherEntry.percentage != null) input.value = otherEntry.percentage;
    }
  }

  document.getElementById("cronSchedule").value = c.cron_schedule || "";

  if (c.personal_numbers) {
    personalNumbers = JSON.parse(c.personal_numbers);
    renderPhones();
  }

  updateRoutePctSummary();
  updateNetworkPctSummary();
}

function addPhone() {
  const input = document.getElementById("phoneInput");
  const phone = input.value.trim();
  if (!phone) return;
  personalNumbers.push(phone);
  input.value = "";
  renderPhones();
}

function removePhone(idx) {
  personalNumbers.splice(idx, 1);
  renderPhones();
}

function renderPhones() {
  const container = document.getElementById("phoneTags");
  container.innerHTML = personalNumbers
    .map(
      (p, i) =>
        `<span class="tag">${p} <span class="tag-remove" onclick="removePhone(${i})">x</span></span>`
    )
    .join("");
}

function getFormData() {
  const routeChecks = document.querySelectorAll('input[name="route"]:checked');
  const networkChecks = document.querySelectorAll('input[name="network"]:checked');

  const routes = Array.from(routeChecks).map((cb) => {
    const row = cb.closest(".route-row");
    const val = parseInt(row.querySelector(".route-value").value) || 0;
    return { id: parseInt(cb.value), value: val };
  });

  const networks = Array.from(networkChecks).map((cb) => {
    const row = cb.closest(".network-row");
    const pct = parseInt(row.querySelector(".network-pct").value) || 0;
    return {
      mcc: cb.dataset.mcc,
      mnc: cb.dataset.mnc,
      name: cb.dataset.name,
      percentage: pct,
    };
  });

  // Add "Outras" if checked
  const otherCb = document.querySelector('input[name="network-other"]:checked');
  if (otherCb) {
    const row = otherCb.closest(".network-row");
    const pct = parseInt(row.querySelector(".network-pct").value) || 0;
    networks.push({ other: true, percentage: pct });
  }

  const totalTests = routeMode === "pct" ? parseInt(document.getElementById("totalTests").value) || null : null;

  return {
    name: document.getElementById("name").value.trim(),
    route_mode: routeMode,
    total_tests: totalTests,
    routes,
    networks,
    personal_numbers: personalNumbers.length ? personalNumbers : null,
    cron_schedule: document.getElementById("cronSchedule").value.trim() || null,
    active: 1,
  };
}

async function saveCampaign(e) {
  if (e) e.preventDefault();
  const data = getFormData();

  if (!data.routes.length || !data.networks.length) {
    showToast("Selecione pelo menos 1 rota e 1 operadora", "error");
    return null;
  }

  // Validate network percentages sum to 100
  const netSum = data.networks.reduce((s, n) => s + (n.percentage || 0), 0);
  if (netSum !== 100) {
    showToast(`Percentual das operadoras deve somar 100% (atual: ${netSum}%)`, "error");
    return null;
  }

  // Validate route percentages if in pct mode
  if (data.route_mode === "pct") {
    const routeSum = data.routes.reduce((s, r) => s + (r.value || 0), 0);
    if (routeSum !== 100) {
      showToast(`Percentual das rotas deve somar 100% (atual: ${routeSum}%)`, "error");
      return null;
    }
    if (!data.total_tests) {
      showToast("Informe o total de disparos no modo percentual", "error");
      return null;
    }
  }

  let res;
  if (editingId) {
    res = await fetch(`/api/campaigns/${editingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } else {
    res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  const result = await res.json();
  if (result.error) {
    showToast(result.error, "error");
    return null;
  }

  showToast("Campanha salva!", "success");
  return result.id || editingId;
}

async function saveAndRun() {
  const id = await saveCampaign();
  if (!id) return;
  showToast("Disparando teste...", "success");
  await fetch(`/api/campaigns/${id}/run`, { method: "POST" });
  setTimeout(() => (window.location.href = "/"), 1500);
}

async function buildWithAI() {
  const prompt = document.getElementById("aiPrompt").value.trim();
  if (!prompt) return showToast("Escreva o que deseja", "error");

  const btn = document.getElementById("btnAi");
  const status = document.getElementById("aiStatus");
  btn.disabled = true;
  status.textContent = "Pensando...";

  try {
    const res = await fetch("/api/campaign-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (data.error) {
      showToast(data.error, "error");
      status.textContent = "";
      btn.disabled = false;
      return;
    }

    // Fill form with AI response
    if (data.name) document.getElementById("name").value = data.name;

    // Set route mode
    if (data.route_mode) setRouteMode(data.route_mode);
    if (data.total_tests) document.getElementById("totalTests").value = data.total_tests;

    // Uncheck all first
    document.querySelectorAll('input[name="route"]').forEach((cb) => {
      cb.checked = false;
      const row = cb.closest(".route-row");
      row.querySelector(".route-value").disabled = true;
    });
    document.querySelectorAll('input[name="network"]').forEach((cb) => {
      cb.checked = false;
      const row = cb.closest(".network-row");
      row.querySelector(".network-pct").disabled = true;
    });
    const otherCb = document.querySelector('input[name="network-other"]');
    if (otherCb) {
      otherCb.checked = false;
      otherCb.closest(".network-row").querySelector(".network-pct").disabled = true;
    }

    // Check routes with values
    if (data.routes) {
      for (const route of data.routes) {
        const routeId = typeof route === "object" ? route.id : route;
        const routeVal = typeof route === "object" ? route.value : 10;
        const cb = document.querySelector(`input[name="route"][value="${routeId}"]`);
        if (cb) {
          cb.checked = true;
          const row = cb.closest(".route-row");
          const input = row.querySelector(".route-value");
          input.disabled = false;
          input.value = routeVal;
        }
      }
    }

    // Check networks with percentages
    if (data.networks) {
      for (const n of data.networks) {
        if (n.other) {
          if (otherCb) {
            otherCb.checked = true;
            const row = otherCb.closest(".network-row");
            const input = row.querySelector(".network-pct");
            input.disabled = false;
            input.value = n.percentage || 25;
          }
          continue;
        }
        const cb = document.querySelector(`input[name="network"][value="${n.mcc}-${n.mnc}"]`);
        if (cb) {
          cb.checked = true;
          const row = cb.closest(".network-row");
          const input = row.querySelector(".network-pct");
          input.disabled = false;
          input.value = n.percentage || 25;
        }
      }
    }

    if (data.cron_schedule) document.getElementById("cronSchedule").value = data.cron_schedule;

    if (data.personal_numbers && data.personal_numbers.length) {
      personalNumbers = data.personal_numbers;
      renderPhones();
    }

    updateRoutePctSummary();
    updateNetworkPctSummary();

    status.textContent = "Pronto! Confira os campos abaixo.";
    showToast("Campanha montada pela IA!", "success");
  } catch (err) {
    showToast("Erro ao chamar IA", "error");
    status.textContent = "";
  }
  btn.disabled = false;
}

function showToast(msg, type) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

init();
