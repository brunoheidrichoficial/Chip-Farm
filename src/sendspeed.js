const { config } = require("./config");

// Send SMS through a specific route
// Returns { success, trace_id }
async function sendSms(route, phone, text, callbackUrl) {
  const url = `${config.sendspeed.baseUrl}/api?i=${route.id}&token=${route.token}`;

  const body = {
    user_phone: phone,
    txt: text,
  };

  if (callbackUrl) body.callback_url = callbackUrl;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { success: false, error: `HTTP ${res.status}: ${errText}` };
  }

  const data = await res.json();
  return data;
}

module.exports = { sendSms };
