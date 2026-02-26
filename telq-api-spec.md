# TelQ API — Spec Técnica para o Projeto

## Base URL
`https://api.telqtele.com/v3`

## Auth
POST `/client/token` → body: `{ "appId": "...", "appKey": "..." }` → retorna Bearer token (24h)

## Fluxo do Teste

### 1. Listar operadoras disponíveis
GET `/client/networks?mcc=724` (724 = Brasil)
→ Retorna lista de operadoras com mcc, mnc, providerName

### 2. Criar testes (batch até 200)
POST `/client/tests`
```json
{
  "destinationNetworks": [
    { "mcc": "724", "mnc": "05" },
    { "mcc": "724", "mnc": "10" },
    { "mcc": "724", "mnc": "02" }
  ],
  "testIdTextType": "NUMERIC",
  "testIdTextLength": 6,
  "testTimeToLiveInSeconds": 600,
  "resultsCallbackUrl": "https://nosso-server/callback"
}
```
→ Retorna: phoneNumber + testIdText por destino

### 3. Enviar SMS pela SendSpeed
Para cada teste, enviar SMS:
- Destino: phoneNumber retornado pela TelQ
- Corpo: incluir testIdText no body da mensagem
- Via: rota específica da SendSpeed

### 4. Coletar resultados
GET `/client/tests/{id}`
```json
{
  "id": 120970,
  "testIdText": "fEgMxrKAEk",
  "receiptStatus": "POSITIVE",
  "smsReceivedAt": "2023-10-26T10:50:00Z",
  "receiptDelay": 12.5,
  "textDelivered": "mensagem recebida",
  "senderDelivered": "sender que chegou"
}
```

Ou batch: GET `/client/tests?from=2026-02-26T07:00:00Z&to=2026-02-26T08:00:00Z&size=1000`

## Status possíveis
- POSITIVE — entregou
- NOT_DELIVERED — expirou sem entregar
- WAIT — aguardando
- TEST_NUMBER_OFFLINE — número offline
- NETWORK_OFFLINE — rede offline
- INTERNAL_ERROR — erro interno TelQ

## MCC/MNC Brasil (724)
- 724/05 — Claro
- 724/10 — Vivo
- 724/02 — TIM
- 724/31 — Oi
- 724/04 — TIM
- 724/06 — Vivo
- 724/11 — Vivo
- 724/23 — Vivo

## Dados úteis do resultado
- receiptDelay — latência em segundos
- textDelivered — texto que chegou (validar integridade)
- senderDelivered — sender que apareceu pro destinatário
