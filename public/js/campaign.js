let allRoutes = [];
let allNetworks = [];
let personalNumbers = [];
let editingId = null;

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

function renderRoutes() {
  const grid = document.getElementById("routesGrid");
  grid.innerHTML = allRoutes
    .map(
      (r) => `
    <label class="checkbox-item">
      <input type="checkbox" name="route" value="${r.id}" data-name="${r.name}">
      <span class="checkbox-label">${r.name}<br><small>${r.supplier} - ${r.type}</small></span>
    </label>`
    )
    .join("");
}

function renderNetworks() {
  const grid = document.getElementById("networksGrid");
  // Use unique network names only
  const unique = [];
  const seen = new Set();
  for (const n of allNetworks) {
    const key = n.mcc + "-" + n.mnc;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(n);
  }

  grid.innerHTML = unique
    .map(
      (n) => `
    <label class="checkbox-item">
      <input type="checkbox" name="network" value="${n.mcc}-${n.mnc}" data-mcc="${n.mcc}" data-mnc="${n.mnc}" data-name="${n.name || n.providerName || n.countryName || ''}">
      <span class="checkbox-label">${n.name || n.providerName || "MNC " + n.mnc}<br><small>MCC: ${n.mcc} MNC: ${n.mnc}</small></span>
    </label>`
    )
    .join("");
}

function loadCampaign(c) {
  document.getElementById("name").value = c.name;

  const routeIds = JSON.parse(c.routes);
  document.querySelectorAll('input[name="route"]').forEach((cb) => {
    if (routeIds.includes(parseInt(cb.value))) cb.checked = true;
  });

  const networks = JSON.parse(c.networks);
  document.querySelectorAll('input[name="network"]').forEach((cb) => {
    const [mcc, mnc] = cb.value.split("-");
    if (networks.some((n) => n.mcc === mcc && n.mnc === mnc)) cb.checked = true;
  });

  document.getElementById("testsPerCombo").value = c.tests_per_combo || 1;
  document.getElementById("cronSchedule").value = c.cron_schedule || "";

  if (c.personal_numbers) {
    personalNumbers = JSON.parse(c.personal_numbers);
    renderPhones();
  }
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

  const routes = Array.from(routeChecks).map((cb) => parseInt(cb.value));
  const networks = Array.from(networkChecks).map((cb) => ({
    mcc: cb.dataset.mcc,
    mnc: cb.dataset.mnc,
    name: cb.dataset.name,
  }));

  return {
    name: document.getElementById("name").value.trim(),
    routes,
    networks,
    tests_per_combo: parseInt(document.getElementById("testsPerCombo").value),
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

function showToast(msg, type) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

init();
