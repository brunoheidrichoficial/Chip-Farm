#!/bin/bash
# SendSpeed Chip Farm - Start Script
# Liga o tunnel + a aplicação

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=== SendSpeed Chip Farm ==="
echo ""

# 1. Start cloudflared tunnel in background and capture the URL
echo "[1/3] Starting Cloudflare Tunnel..."
./cloudflared tunnel --url http://localhost:3700 --no-tls-verify > /tmp/cloudflared.log 2>&1 &
TUNNEL_PID=$!
echo "  Tunnel PID: $TUNNEL_PID"

# Wait for tunnel to be ready and get URL
TUNNEL_URL=""
for i in $(seq 1 30); do
  sleep 1
  TUNNEL_URL=$(grep -o 'https://[a-z0-9\-]*\.trycloudflare\.com' /tmp/cloudflared.log | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
done

if [ -z "$TUNNEL_URL" ]; then
  echo "  ERROR: Tunnel failed to start. Check /tmp/cloudflared.log"
  kill $TUNNEL_PID 2>/dev/null
  exit 1
fi

echo "  Tunnel URL: $TUNNEL_URL"
echo ""

# 2. Update .env with the tunnel URL
if grep -q "CALLBACK_PUBLIC_URL=" .env; then
  sed -i '' "s|CALLBACK_PUBLIC_URL=.*|CALLBACK_PUBLIC_URL=$TUNNEL_URL|" .env
else
  echo "CALLBACK_PUBLIC_URL=$TUNNEL_URL" >> .env
fi
echo "[2/3] .env updated with callback URL"
echo ""

# 3. Start the app with PM2
echo "[3/3] Starting Chip Farm app..."
npx pm2 delete chipfarm 2>/dev/null
npx pm2 start src/index.js --name chipfarm
npx pm2 logs chipfarm --lines 20 &
LOG_PID=$!

echo ""
echo "========================================"
echo "  Chip Farm ONLINE"
echo "  Callback: $TUNNEL_URL/callback/sendspeed"
echo "  Health:   $TUNNEL_URL/health"
echo "  PM2:      npx pm2 status"
echo "  Logs:     npx pm2 logs chipfarm"
echo "  Stop:     npx pm2 stop chipfarm"
echo "  Test now: npm run test:once"
echo "========================================"
echo ""

# Keep alive - wait for user to Ctrl+C
trap "echo 'Shutting down...'; npx pm2 stop chipfarm; kill $TUNNEL_PID 2>/dev/null; kill $LOG_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait $TUNNEL_PID
