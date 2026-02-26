# SendSpeed API — Spec para o Projeto

## Como funciona

**Endpoint único:** `POST https://api.sendspeed.com/api?i={route_id}&token={route_token}`

**Header:** `Content-Type: application/json`

**Body:**
```json
{
  "user_phone": "5547999999999",
  "txt": "texto da mensagem",
  "callback_url": "https://nosso-server.com/callback/sendspeed"
}
```

**Response:**
```json
{
  "success": true,
  "trace_id": "string"
}
```

## Callback da SendSpeed

Quando o SMS muda de status, a SendSpeed faz POST pra callback_url:

```
POST https://nosso-server.com/callback/sendspeed
Content-Type: application/json

[
  {
    "messageId": "trace_id_retornado",
    "status": "delivered"
  }
]
```

**Status possíveis:**
- `delivered` — entregou
- `sent` — enviado (aguardando confirmação)
- `invalid` — número inválido
- `failed` — falhou
- `undelivered` — não entregue

## Rotas mapeadas

Cada rota = um par (i, token). Mesmo endpoint, muda só o i e o token.

### Todas as 12 rotas (completas)

| # | Rota | Fornecedor | Tipo | ID (i) | Token |
|---|---|---|---|---|---|
| 1 | Pushfy v2 Principal | Pushfy | Principal | 1897 | 40c8ef90-2a8c-4905-bce1-b97324042262 |
| 2 | Sona V2 Principal (bet3) | Sona | BET | 1898 | 3f9bc21e-726c-45c0-ba66-b0650ccbae84 |
| 3 | Sona BET 1 | Sona | BET | 1899 | 5e2a8f5a-3bec-4ddf-b9ce-9ebd5e8d0ef8 |
| 4 | Sona BET 2 | Sona | BET | 1900 | d7fef37c-ad0b-40ee-9ff1-bca5b66c646f |
| 5 | Sona BET 4 | Sona | BET | 1901 | f72fb9f5-9b89-4201-a3fd-15fdee87f9ea |
| 6 | Sona OTP | Sona | OTP | 1902 | acb8fb61-54b9-423f-bdca-ded4a0981e98 |
| 7 | Pushfy Premium | Pushfy | Premium | 1903 | 83375b95-a4a7-4a06-a512-0bf0dfe10bc8 |
| 8 | PushfyOtp SMS | Pushfy | OTP | 1904 | a81c6ff6-be90-443f-99f8-ff0b4c591070 |
| 9 | Infobip Massiva | Infobip | Massiva | 1905 | e89a07d1-5226-443c-ac5a-70a2c685e365 |
| 10 | Infobip OTP | Infobip | OTP | 1906 | bed34699-8ac6-488a-943b-1ffb66370c8b |
| 11 | Infobip Blend 35 | Infobip | Blend | 1909 | 00b9d53a-4327-4e45-808f-735ff0c087c5 |
| 12 | Infobip Blend 41 | Infobip | Blend | 1910 | a64392a8-3334-4e27-98df-5b6697a90296 |
