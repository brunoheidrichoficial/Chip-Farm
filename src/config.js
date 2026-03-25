require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const config = {
  telq: {
    baseUrl: process.env.TELQ_BASE_URL || "https://api.telqtele.com/v3",
    appId: process.env.TELQ_APP_ID,
    appKey: process.env.TELQ_APP_KEY,
  },

  sendspeed: {
    baseUrl: process.env.SENDSPEED_BASE_URL || "https://api.sendspeed.com",
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },

  sheets: {
    credentials: process.env.GOOGLE_SHEETS_CREDENTIALS || null,
    spreadsheetId: process.env.GOOGLE_SHEET_ID || null,
  },

  sendspeedDb: {
    host: process.env.SENDSPEED_DB_HOST || null,
    port: parseInt(process.env.SENDSPEED_DB_PORT || "25060"),
    user: process.env.SENDSPEED_DB_USER || null,
    password: process.env.SENDSPEED_DB_PASSWORD || null,
    database: process.env.SENDSPEED_DB_DATABASE || "defaultdb",
  },

  // Server for receiving SendSpeed callbacks
  callbackServer: {
    port: parseInt(process.env.CALLBACK_PORT || "3700"),
    publicUrl: process.env.CALLBACK_PUBLIC_URL || "http://localhost:3700",
  },

  // Cron schedule (default: 7am every day)
  cronSchedule: process.env.CRON_SCHEDULE || "0 7 * * *",

  // Test config
  test: {
    ttlSeconds: 600, // 10 min wait for TelQ results
    pollIntervalMs: 15000, // Poll TelQ every 15s
    maxPollAttempts: 40, // 40 * 15s = 10 min
  },
};

// Tier definitions (ordered by quality)
const TIERS = ["DIAMOND", "PLATINUM", "GOLD", "SILVER", "OTP"];

// All 13 SendSpeed routes
const routes = [
  { id: 1897, token: "40c8ef90-2a8c-4905-bce1-b97324042262", name: "Pushfy v2 Principal", supplier: "Pushfy", type: "Principal", tier: "GOLD" },
  { id: 1898, token: "3f9bc21e-726c-45c0-ba66-b0650ccbae84", name: "Sona V2 (bet3)", supplier: "Sona", type: "BET", tier: "GOLD" },
  { id: 1899, token: "5e2a8f5a-3bec-4ddf-b9ce-9ebd5e8d0ef8", name: "Sona BET 1", supplier: "Sona", type: "BET", tier: "DIAMOND" },
  { id: 1900, token: "d7fef37c-ad0b-40ee-9ff1-bca5b66c646f", name: "Sona BET 2", supplier: "Sona", type: "BET", tier: "PLATINUM" },
  { id: 1901, token: "f72fb9f5-9b89-4201-a3fd-15fdee87f9ea", name: "Sona BET 4", supplier: "Sona", type: "BET", tier: "SILVER" },
  { id: 1902, token: "acb8fb61-54b9-423f-bdca-ded4a0981e98", name: "Sona OTP", supplier: "Sona", type: "OTP", tier: "OTP" },
  { id: 1903, token: "83375b95-a4a7-4a06-a512-0bf0dfe10bc8", name: "Pushfy Premium", supplier: "Pushfy", type: "Premium", tier: "DIAMOND" },
  { id: 1904, token: "a81c6ff6-be90-443f-99f8-ff0b4c591070", name: "PushfyOtp SMS", supplier: "Pushfy", type: "OTP", tier: "OTP" },
  { id: 1905, token: "e89a07d1-5226-443c-ac5a-70a2c685e365", name: "Infobip Massiva", supplier: "Infobip", type: "Massiva", tier: "DIAMOND" },
  { id: 1906, token: "bed34699-8ac6-488a-943b-1ffb66370c8b", name: "Infobip OTP", supplier: "Infobip", type: "OTP", tier: "OTP" },
  { id: 1909, token: "00b9d53a-4327-4e45-808f-735ff0c087c5", name: "Infobip Blend 35", supplier: "Infobip", type: "Blend", tier: "GOLD" },
  { id: 1910, token: "a64392a8-3334-4e27-98df-5b6697a90296", name: "Infobip Blend 41", supplier: "Infobip", type: "Blend", tier: "PLATINUM" },
  { id: 1912, token: "f31042a0-eb3f-4357-88e8-953c846be9da", name: "Infobip Pos Paga", supplier: "Infobip", type: "Pos Paga", tier: "GOLD" },
];

// Lookup tier by route ID
function getRouteTier(routeId) {
  const route = routes.find((r) => r.id === routeId);
  return route ? route.tier : null;
}

// Brazilian networks to test (main carriers)
const targetNetworks = [
  { mcc: "724", mnc: "05", name: "Claro" },
  { mcc: "724", mnc: "06", name: "Vivo" },
  { mcc: "724", mnc: "02", name: "TIM" },
];

module.exports = { config, routes, targetNetworks, TIERS, getRouteTier };
