const { config } = require("./config");

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(`${config.telq.baseUrl}/client/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId: config.telq.appId, appKey: config.telq.appKey }),
  });

  if (!res.ok) throw new Error(`TelQ auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.value;
  tokenExpiresAt = Date.now() + (data.ttl - 300) * 1000; // refresh 5min before expiry
  return cachedToken;
}

async function apiGet(path) {
  const token = await getToken();
  const res = await fetch(`${config.telq.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`TelQ GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body) {
  const token = await getToken();
  const res = await fetch(`${config.telq.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TelQ POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// List available Brazilian networks
async function getNetworks() {
  return apiGet("/client/networks?mcc=724");
}

// Request test numbers for given networks
// Returns array of { id, phoneNumber, testIdText, destinationNetwork }
async function createTests(destinationNetworks) {
  return apiPost("/client/tests", {
    destinationNetworks,
    testIdTextType: "NUMERIC",
    testIdTextLength: 6,
    testTimeToLiveInSeconds: config.test.ttlSeconds,
  });
}

// Get result for a single test
async function getTestResult(testId) {
  return apiGet(`/client/tests/${testId}`);
}

// Get results in batch (by time range)
async function getTestResults(from, to) {
  const fromStr = encodeURIComponent(from);
  const toStr = encodeURIComponent(to);
  return apiGet(`/client/tests?from=${fromStr}&to=${toStr}&size=1000&order=asc`);
}

module.exports = { getNetworks, createTests, getTestResult, getTestResults };
