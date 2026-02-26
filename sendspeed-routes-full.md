# Documentação de Rotas — app-send-speed

Este documento descreve as rotas da aplicação SendSpeed, incluindo páginas web, APIs e webhooks.

## Como funciona o roteamento

- **Nginx**: URLs em `/app/`, `/functions/`, `/api/`, `/backoffice/` são resolvidas com `try_files $uri $uri/ $uri.php?$args`
- **Exemplo**: `/app/sms-campaigns-list` → `app/sms-campaigns-list.php`
- **Autenticação**: A maioria das rotas em `/app/` exige login via `functions/check-login.php`
- **Auditoria**: Requisições principais são registradas via `AuditLogger`

---

## 1. Pontos de entrada

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/` | `index.php` | Redireciona para `/app/index` |
| `/app/` ou `/app/index` | `app/index.php` | Redireciona para `/app/sms-campaigns-list` |

---

## 2. Autenticação e usuário

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/app/login` | `app/login.php` | GET | Página de login |
| `/functions/auth.php` | `functions/auth.php` | POST | Processa login (email/senha ou código) |
| `/app/login-with-code` | `app/login-with-code.php` | GET | Login com código de acesso |
| `/functions/get-login-code.php` | `functions/get-login-code.php` | POST | Gera código de login |
| `/functions/valid-code.php` | `functions/valid-code.php` | POST | Valida código de login |
| `/app/register` | `app/register.php` | GET | Página de registro |
| `/functions/register-and-authenticate.php` | `functions/register-and-authenticate.php` | POST | Processa registro e autentica |
| `/app/logout` | `app/logout.php` | GET | Encerra sessão |
| `/app/lost-password` | `app/lost-password.php` | GET | Recuperação de senha |
| `/functions/forgot-password.php` | `functions/forgot-password.php` | POST | Processa recuperação |
| `/app/reset-password` | `app/reset-password.php` | GET | Redefinição de senha |
| `/functions/reset-password.php` | `functions/reset-password.php` | POST | Processa redefinição |
| `/app/change-password` | `app/change-password.php` | GET | Alteração de senha |
| `/functions/update-password.php` | `functions/update-password.php` | POST | Processa alteração |
| `/app/account` | `app/account.php` | GET | Perfil do usuário |
| `/functions/update-account.php` | `functions/update-account.php` | POST | Atualiza dados da conta |

---

## 3. Campanhas — criação e edição

### 3.1 SMS, VoIP e SMS+VoIP

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/app/new-campaign` | `app/new-campaign.php` | GET | Formulário de nova campanha |
| `/functions/create-campaign.php` | `functions/create-campaign.php` | POST | Cria campanha (SMS/VoIP/SMS+VoIP) |
| `/app/campaigns/create` | `app/campaigns/create.php` | GET | Formulário alternativo |
| `/app/campaigns/edit` | `app/campaigns/edit.php` | GET | Edição de campanha |
| `/functions/update-campaign.php` | `functions/update-campaign.php` | POST | Atualiza campanha |
| `/functions/activate-campaign.php` | `functions/activate-campaign.php` | POST | Ativa campanha |

### 3.2 RCS (Rich Communication Services)

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/app/new-rcs-campaign` | `app/new-rcs-campaign.php` | GET | Formulário de nova campanha RCS |
| `/functions/create-rcs-campaign.php` | `functions/create-rcs-campaign.php` | POST | Cria campanha RCS |
| `/app/edit-rcs-campaign` | `app/edit-rcs-campaign.php` | GET | Edição de campanha RCS |
| `/app/edit-rcs-campaign-template` | `app/edit-rcs-campaign-template.php` | GET | Edição de template RCS |
| `/functions/update-rcs-campaign.php` | `functions/update-rcs-campaign.php` | POST | Atualiza campanha RCS |

### 3.3 WhatsApp

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/app/whatsapp-campaigns-list` | `app/whatsapp-campaigns-list.php` | Lista de campanhas WhatsApp |

---

## 4. Campanhas — listagem

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/app/sms-campaigns-list` | `app/sms-campaigns-list.php` | Lista campanhas SMS |
| `/app/voip-campaigns-list` | `app/voip-campaigns-list.php` | Lista campanhas VoIP |
| `/app/sms-and-voip-campaigns-list` | `app/sms-and-voip-campaigns-list.php` | Lista campanhas SMS+VoIP |
| `/app/rcs-campaigns-list` | `app/rcs-campaigns-list.php` | Lista campanhas RCS |
| `/app/whatsapp-campaigns-list` | `app/whatsapp-campaigns-list.php` | Lista campanhas WhatsApp |

---

## 5. Campanhas — detalhes e estatísticas

### 5.1 Por canal (SMS, VoIP, RCS, WhatsApp)

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/app/sms/details` | `app/sms/details.php` | Detalhes de SMS |
| `/app/sms/statistics` | `app/sms/statistics.php` | Estatísticas SMS |
| `/app/sms/filters` | `app/sms/filters.php` | Filtros SMS |
| `/app/voip/details` | `app/voip/details.php` | Detalhes VoIP |
| `/app/voip/statistics` | `app/voip/statistics.php` | Estatísticas VoIP |
| `/app/voip/filters` | `app/voip/filters.php` | Filtros VoIP |
| `/app/rcs/details` | `app/rcs/details.php` | Detalhes RCS |
| `/app/rcs/statistics` | `app/rcs/statistics.php` | Estatísticas RCS |
| `/app/rcs/preview` | `app/rcs/preview.php` | Preview RCS |
| `/app/whatsapp/details` | `app/whatsapp/details.php` | Detalhes WhatsApp |
| `/app/whatsapp/statistics` | `app/whatsapp/statistics.php` | Estatísticas WhatsApp |
| `/app/whatsapp/filters` | `app/whatsapp/filters.php` | Filtros WhatsApp |

### 5.2 Detalhes gerais de campanha

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/app/campaign-details` | `app/campaign-details.php` | Detalhes gerais |
| `/app/campaigns/details` | `app/campaigns/details.php` | Detalhes alternativo |
| `/app/voip-campaign-details` | `app/voip-campaign-details.php` | Detalhes campanha VoIP |
| `/app/whatsapp-campaign-details` | `app/whatsapp-campaign-details.php` | Detalhes campanha WhatsApp |
| `/app/rcs-campaign-details` | `app/rcs-campaign-details.php` | Detalhes campanha RCS |

---

## 6. Shortlinks

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/app/shortlinks` | `app/shortlinks.php` | GET | Lista de shortlinks |
| `/app/shortlink-creator` | `app/shortlink-creator.php` | GET | Criador de shortlink |
| `/app/campaigns/shortlink` | `app/campaigns/shortlink.php` | GET | Shortlink em campanha |
| `/app/campaigns/shortlink-creator` | `app/campaigns/shortlink-creator.php` | GET | Criador (dentro de campanha) |
| `/functions/create-shortlink.php` | `functions/create-shortlink.php` | GET | Cria shortlink (API) — parâmetros: `shortlinkDestination`, `shortlinkKey`, `skip_post` |

---

## 7. Relatórios e dashboard

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/app/dashboard` | `app/dashboard.php` | Dashboard principal |
| `/app/sending-reports` | `app/sending-reports.php` | Relatórios de envio |
| `/app/campaign-report` | `app/campaign-report.php` | Relatório de campanha |
| `/app/reports/sending-reports` | `app/reports/sending-reports.php` | Relatórios alternativo |
| `/app/reports/supplier-status` | `app/reports/supplier-status.php` | Status de fornecedores |
| `/app/reports/pending-sms-campaigns` | `app/reports/pending-sms-campaigns.php` | Campanhas SMS pendentes |
| `/app/reports/filters` | `app/reports/filters.php` | Filtros de relatórios |
| `/app/statement` | `app/statement.php` | Extrato |
| `/app/credit-statement/report` | `app/credit-statement/report.php` | Relatório de crédito |
| `/app/credit-statement/filters` | `app/credit-statement/filters.php` | Filtros de crédito |

---

## 8. API — campanhas

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/api/sms-campaigns/get-campaigns.php` | `api/sms-campaigns/get-campaigns.php` | GET | Lista campanhas SMS (JSON) |
| `/api/voip-campaigns/get-campaigns.php` | `api/voip-campaigns/get-campaigns.php` | GET | Lista campanhas VoIP (JSON) |
| `/api/sms-and-voip-campaigns/get-campaigns.php` | `api/sms-and-voip-campaigns/get-campaigns.php` | GET | Lista campanhas SMS+VoIP (JSON) |
| `/api/rcs-campaigns/get-campaigns.php` | `api/rcs-campaigns/get-campaigns.php` | GET | Lista campanhas RCS (JSON) |
| `/api/whatsapp-campaigns/get-campaigns.php` | `api/whatsapp-campaigns/get-campaigns.php` | GET | Lista campanhas WhatsApp (JSON) |
| `/api/campaigns/update-status.php` | `api/campaigns/update-status.php` | POST | Atualiza status da campanha |
| `/api/rcs-campaigns/clone-campaign.php` | `api/rcs-campaigns/clone-campaign.php` | POST | Clona campanha RCS |
| `/api/rcs-campaigns/get-progress.php` | `api/rcs-campaigns/get-progress.php` | GET | Progresso de processamento CSV |
| `/api/rcs-campaigns/get-csv-processing-status.php` | `api/rcs-campaigns/get-csv-processing-status.php` | GET | Status do processamento CSV |
| `/api/whatsapp-campaigns/update-status.php` | `api/whatsapp-campaigns/update-status.php` | POST | Atualiza status WhatsApp |
| `/api/whatsapp-campaigns/export-csv.php` | `api/whatsapp-campaigns/export-csv.php` | GET | Exporta CSV WhatsApp |
| `/api/voip-campaigns/presign-audio-url.php` | `api/voip-campaigns/presign-audio-url.php` | GET | URL pré-assinada para áudio |

---

## 9. API — SMS

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/api/sms/pending.php` | `api/sms/pending.php` | GET | SMS pendentes |
| `/api/sms/pending-statistics.php` | `api/sms/pending-statistics.php` | GET | Estatísticas de pendentes |
| `/api/sms/sent.php` | `api/sms/sent.php` | GET | SMS enviados |
| `/api/sms/sent-statistics.php` | `api/sms/sent-statistics.php` | GET | Estatísticas de enviados |
| `/api/sms/received.php` | `api/sms/received.php` | GET | SMS recebidos |
| `/api/sms/received-statistics.php` | `api/sms/received-statistics.php` | GET | Estatísticas de recebidos |
| `/api/sms/undelivered.php` | `api/sms/undelivered.php` | GET | SMS não entregues |
| `/api/sms/undelivered-statistics.php` | `api/sms/undelivered-statistics.php` | GET | Estatísticas de não entregues |
| `/api/sms/refused.php` | `api/sms/refused.php` | GET | SMS recusados |
| `/api/sms/refused-statistics.php` | `api/sms/refused-statistics.php` | GET | Estatísticas de recusados |
| `/api/sms/error.php` | `api/sms/error.php` | GET | SMS com erro |
| `/api/sms/error-statistics.php` | `api/sms/error-statistics.php` | GET | Estatísticas de erros |
| `/api/sms/discarded.php` | `api/sms/discarded.php` | GET | SMS descartados |
| `/api/sms/acks.php` | `api/sms/acks.php` | GET | ACKs de SMS |
| `/api/sms/get-sms-id.php` | `api/sms/get-sms-id.php` | GET | Obtém ID do SMS |
| `/api/sms-status/trace-sms-by-id.php` | `api/sms-status/trace-sms-by-id.php` | GET | Rastreia SMS por ID |

---

## 10. API — VoIP

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/api/voip/pending.php` | `api/voip/pending.php` | GET | VoIP pendentes |
| `/api/voip/pending-statistics.php` | `api/voip/pending-statistics.php` | GET | Estatísticas de pendentes |
| `/api/voip/sent.php` | `api/voip/sent.php` | GET | VoIP enviados |
| `/api/voip/sent-statistics.php` | `api/voip/sent-statistics.php` | GET | Estatísticas de enviados |
| `/api/voip/answered.php` | `api/voip/answered.php` | GET | VoIP atendidos |
| `/api/voip/answered-statistics.php` | `api/voip/answered-statistics.php` | GET | Estatísticas de atendidos |
| `/api/voip/not-answered.php` | `api/voip/not-answered.php` | GET | VoIP não atendidos |
| `/api/voip/not-answered-statistics.php` | `api/voip/not-answered-statistics.php` | GET | Estatísticas de não atendidos |
| `/api/voip/refused.php` | `api/voip/refused.php` | GET | VoIP recusados |
| `/api/voip/refused-statistics.php` | `api/voip/refused-statistics.php` | GET | Estatísticas de recusados |
| `/api/voip/error.php` | `api/voip/error.php` | GET | VoIP com erro |
| `/api/voip/error-statistics.php` | `api/voip/error-statistics.php` | GET | Estatísticas de erros |
| `/api/voip/discarded.php` | `api/voip/discarded.php` | GET | VoIP descartados |
| `/api/voip/acks.php` | `api/voip/acks.php` | GET | ACKs de VoIP |
| `/api/voip/get-voip-id.php` | `api/voip/get-voip-id.php` | GET | Obtém ID do VoIP |
| `/api/voip-status/trace-voip-by-id.php` | `api/voip-status/trace-voip-by-id.php` | GET | Rastreia VoIP por ID |

---

## 11. API — RCS

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/api/rcs/pending.php` | `api/rcs/pending.php` | GET | RCS pendentes |
| `/api/rcs/pending-statistics.php` | `api/rcs/pending-statistics.php` | GET | Estatísticas de pendentes |
| `/api/rcs/sent.php` | `api/rcs/sent.php` | GET | RCS enviados |
| `/api/rcs/sent-statistics.php` | `api/rcs/sent-statistics.php` | GET | Estatísticas de enviados |
| `/api/rcs/delivered.php` | `api/rcs/delivered.php` | GET | RCS entregues |
| `/api/rcs/delivered-statistics.php` | `api/rcs/delivered-statistics.php` | GET | Estatísticas de entregues |
| `/api/rcs/undelivered.php` | `api/rcs/undelivered.php` | GET | RCS não entregues |
| `/api/rcs/undelivered-statistics.php` | `api/rcs/undelivered-statistics.php` | GET | Estatísticas de não entregues |
| `/api/rcs/rejected.php` | `api/rcs/rejected.php` | GET | RCS rejeitados |
| `/api/rcs/rejected-statistics.php` | `api/rcs/rejected-statistics.php` | GET | Estatísticas de rejeitados |
| `/api/rcs/error.php` | `api/rcs/error.php` | GET | RCS com erro |
| `/api/rcs/error-statistics.php` | `api/rcs/error-statistics.php` | GET | Estatísticas de erros |
| `/api/rcs/supplier-status-report.php` | `api/rcs/supplier-status-report.php` | GET | Relatório de status do fornecedor |

---

## 12. API — WhatsApp

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/api/whatsapp/pending.php` | `api/whatsapp/pending.php` | GET | WhatsApp pendentes |
| `/api/whatsapp/pending-statistics.php` | `api/whatsapp/pending-statistics.php` | GET | Estatísticas de pendentes |

---

## 13. API — envio direto (call)

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/call` ou `/api/call.php` | `api/call.php` | POST | Envia SMS/VoIP único (requer token) |
| `/api/bulk-call.php` | `api/bulk-call.php` | POST | Envio em lote (requer token) |

> **Nota**: A URL `/call` é reescrita para `/api/call.php` via Nginx.

---

## 14. API — relatórios

| URL | Arquivo | Método | Descrição |
|-----|---------|--------|-----------|
| `/api/reports/consolidated-sms.php` | `api/reports/consolidated-sms.php` | GET | SMS consolidados |
| `/api/reports/consolidated-sms-chart.php` | `api/reports/consolidated-sms-chart.php` | GET | Gráfico SMS consolidado |
| `/api/reports/consolidated-supplier-status.php` | `api/reports/consolidated-supplier-status.php` | GET | Status consolidado de fornecedores |
| `/api/reports/consolidated-queued-send-pending.php` | `api/reports/consolidated-queued-send-pending.php` | GET | Fila consolidada pendente |
| `/api/reports/daily-sms-transactions.php` | `api/reports/daily-sms-transactions.php` | GET | Transações SMS diárias |
| `/api/credit-statement/get-credit-statement.php` | `api/credit-statement/get-credit-statement.php` | GET | Extrato de crédito |
| `/api/credit-statement/get-credit-statement-chart.php` | `api/credit-statement/get-credit-statement-chart.php` | GET | Gráfico de extrato |

---

## 15. Webhooks (status de fornecedores)

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/webhook/sms/status.php` | `webhook/sms/status.php` | Webhook de status SMS |
| `/webhook/voip/status.php` | `webhook/voip/status.php` | Webhook de status VoIP |
| `/webhook/rcs/status.php` | `webhook/rcs/status.php` | Webhook de status RCS |
| `/webhook/whatsapp/facebook/status.php` | `webhook/whatsapp/facebook/status.php` | Webhook WhatsApp Facebook |
| `/webhook/whatsapp/facebook/verify.php` | `webhook/whatsapp/facebook/verify.php` | Verificação webhook Facebook |
| `/webhook/whatsapp/360dialog/status.php` | `webhook/whatsapp/360dialog/status.php` | Webhook WhatsApp 360Dialog |

---

## 16. Backoffice (admin)

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/app/backoffice-index` | `app/backoffice-index.php` | Dashboard backoffice |
| `/app/backoffice/discard-setup` | `app/backoffice/discard-setup.php` | Configuração de descarte |
| `/app/backoffice/discard/create` | `app/backoffice/discard/create.php` | Criar descarte |
| `/app/backoffice/discard/edit` | `app/backoffice/discard/edit.php` | Editar descarte |
| `/app/backoffice/discard/destroy` | `app/backoffice/discard/destroy.php` | Remover descarte |
| `/app/backoffice/trace-sms` | `app/backoffice/trace-sms.php` | Rastreamento SMS |
| `/app/backoffice/trace-voip` | `app/backoffice/trace-voip.php` | Rastreamento VoIP |
| `/app/enable-admin` | `app/enable-admin.php` | Habilitar admin |
| `/app/disable-admin` | `app/disable-admin.php` | Desabilitar admin |

---

## 17. Ferramentas e utilitários

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/app/tools-csv-sanitizer` | `app/tools-csv-sanitizer.php` | Sanitizador de CSV |
| `/app/tools/csv-sanitizer/filters` | `app/tools/csv-sanitizer/filters.php` | Filtros do sanitizador |
| `/api/tools/csv-sanitizer.php` | `api/tools/csv-sanitizer.php` | API do sanitizador |
| `/app/downloadCSV` | `app/downloadCSV.php` | Download de CSV |
| `/app/campaigns/products` | `app/campaigns/products.php` | Produtos de campanha |
| `/app/campaigns/upload-csv-mp3.php` | `app/campaigns/upload-csv-mp3.php` | Upload CSV/MP3 |
| `/app/voip-campaigns/audio-player` | `app/voip-campaigns/audio-player.php` | Player de áudio VoIP |
| `/app/diagnosis` | `app/diagnosis.php` | Diagnóstico do sistema |
| `/app/faq` | `app/faq.php` | FAQ |
| `/app/error` | `app/error.php` | Página de erro |
| `/app/campaigns/forbidden` | `app/campaigns/forbidden.php` | Acesso negado |

---

## 18. Outras rotas

| URL | Arquivo | Descrição |
|-----|---------|-----------|
| `/api/accounts/get-accounts.php` | `api/accounts/get-accounts.php` | GET | Lista contas |
| `/api/download/index.php` | `api/download/index.php` | Download de arquivos |

---

## Resumo por tipo de canal

| Canal | Criação | Listagem | Detalhes | API status |
|-------|---------|----------|----------|------------|
| **SMS** | `new-campaign` | `sms-campaigns-list` | `sms/details`, `campaign-details` | `api/sms/*` |
| **VoIP** | `new-campaign` | `voip-campaigns-list` | `voip/details`, `voip-campaign-details` | `api/voip/*` |
| **SMS+VoIP** | `new-campaign` | `sms-and-voip-campaigns-list` | `campaign-details` | — |
| **RCS** | `new-rcs-campaign` | `rcs-campaigns-list` | `rcs/details`, `rcs-campaign-details` | `api/rcs/*` |
| **WhatsApp** | — | `whatsapp-campaigns-list` | `whatsapp/details`, `whatsapp-campaign-details` | `api/whatsapp/*` |

---

*Documento gerado com base na estrutura do projeto app-send-speed.*
