const express = require("express");
const { config } = require("./config");
const db = require("./db");

const app = express();
app.use(express.json());

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Receive SendSpeed delivery callbacks
app.post("/callback/sendspeed", (req, res) => {
  const callbacks = Array.isArray(req.body) ? req.body : [req.body];

  for (const cb of callbacks) {
    if (cb.messageId && cb.status) {
      console.log(`[SendSpeed Callback] traceId=${cb.messageId} status=${cb.status}`);
      db.updateSendspeedCallback(cb.messageId, cb.status);
    }
  }

  res.json({ ok: true });
});

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(config.callbackServer.port, () => {
      console.log(`[Callback Server] listening on port ${config.callbackServer.port}`);
      resolve(server);
    });
  });
}

module.exports = { startServer, app };
