# Chip Farm SendSpeed v2 — Arquitetura com TelQ

---

## VISÃO GERAL

Ao invés de comprar hardware (SIM Banks) e gerenciar chips físicos,
a SendSpeed contrata a TelQ como provedora de números de teste.

A TelQ já possui chips de múltiplas operadoras em múltiplos DDDs.
Nós só precisamos consumir a API dela, construir a automação e a inteligência.

**Antes:** 6 projetos, 5-8 semanas, R$15-20k de investimento
**Agora:** 3 projetos, ~2 semanas, custo operacional mensal

---

## ARQUITETURA

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                        SENDSPEED                                │
│                   (suas rotas de SMS)                            │
│                                                                 │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │  Rota A  │  │  Rota B  │  │  Rota C  │  │  Rota D  │      │
│   │(Fornec.1)│  │(Fornec.2)│  │(Fornec.3)│  │(Fornec.4)│      │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│        │              │              │              │            │
└────────┼──────────────┼──────────────┼──────────────┼────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
   ┌─────────────────────────────────────────────────────────┐
   │                                                         │
   │              SMS viaja pela rede das operadoras          │
   │                                                         │
   └─────────────────────────┬───────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                          TELQ                                  │
│                  (provedora de teste)                           │
│                                                                │
│   A TelQ tem chips reais de todas as operadoras brasileiras.   │
│   Quando o SMS de teste chega no chip dela, ela registra:      │
│                                                                │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│   │  Chips   │  │  Chips   │  │  Chips   │  │  Chips   │     │
│   │  Claro   │  │  Vivo    │  │  TIM     │  │  Oi      │     │
│   │ DDD 11,  │  │ DDD 11,  │  │ DDD 11,  │  │ DDD 11,  │     │
│   │ 21, 31.. │  │ 21, 31.. │  │ 21, 31.. │  │ 21, 31.. │     │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
│                                                                │
│   Dados retornados via API:                                    │
│   • Entregou? (sim/não)                                        │
│   • Em quanto tempo? (latência)                                │
│   • Conteúdo chegou correto? (integridade)                     │
│   • Qual operadora recebeu?                                    │
│   • Timestamp de envio e recebimento                           │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         │ API (webhook / polling)
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│                    ROBÔ DE TESTE DIÁRIO                        │
│                  (roda todo dia às 7h)                          │
│                                                                │
│   ETAPA 1 — PREPARAÇÃO                                         │
│   ┌────────────────────────────────────────────────────────┐   │
│   │  • Consulta TelQ: quais números de teste disponíveis?  │   │
│   │  • Consulta SendSpeed: quais rotas estão ativas?       │   │
│   │  • Monta a matriz de teste do dia:                     │   │
│   │                                                        │   │
│   │    Rota A → Claro DDD11, Claro DDD21, Vivo DDD11...   │   │
│   │    Rota B → Claro DDD11, Claro DDD21, Vivo DDD11...   │   │
│   │    Rota C → Claro DDD11, Claro DDD21, Vivo DDD11...   │   │
│   │    ...                                                 │   │
│   └────────────────────────────────────────────────────────┘   │
│                                                                │
│   ETAPA 2 — DISPARO                                            │
│   ┌────────────────────────────────────────────────────────┐   │
│   │  Para cada combinação [Rota x Operadora x DDD]:        │   │
│   │                                                        │   │
│   │  1. Pede número de teste à TelQ (API)                  │   │
│   │  2. Envia SMS pela rota da SendSpeed pro número TelQ   │   │
│   │  3. TelQ recebe o SMS no chip real                     │   │
│   │  4. TelQ retorna resultado via API                     │   │
│   │                                                        │   │
│   │  Repete 3x por combinação (confiabilidade estatística) │   │
│   └────────────────────────────────────────────────────────┘   │
│                                                                │
│   ETAPA 3 — COLETA                                             │
│   ┌────────────────────────────────────────────────────────┐   │
│   │  Aguarda janela de 5-10 min pra delivery receipts      │   │
│   │  Coleta todos os resultados da TelQ                    │   │
│   │  Grava tudo no banco de dados                          │   │
│   └────────────────────────────────────────────────────────┘   │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│                     BANCO DE DADOS                              │
│                                                                │
│   Tabela: test_results                                         │
│   ┌──────┬───────┬──────────┬─────┬─────────┬────────┬──────┐ │
│   │ Data │ Rota  │Operadora │ DDD │Entregou?│Latência│Custo │ │
│   ├──────┼───────┼──────────┼─────┼─────────┼────────┼──────┤ │
│   │ 26/02│Rota A │ Claro    │ 11  │ Sim     │ 1.2s   │R$0.04│ │
│   │ 26/02│Rota A │ Vivo     │ 11  │ Sim     │ 1.5s   │R$0.04│ │
│   │ 26/02│Rota B │ Claro    │ 11  │ Sim     │ 0.8s   │R$0.03│ │
│   │ 26/02│Rota B │ TIM      │ 21  │ Não     │ —      │R$0.03│ │
│   │ ...  │ ...   │ ...      │ ... │ ...     │ ...    │ ...  │ │
│   └──────┴───────┴──────────┴─────┴─────────┴────────┴──────┘ │
│                                                                │
│   Tabela: route_scores (calculada diariamente)                 │
│   ┌───────┬──────────┬─────┬──────────┬─────────┬───────────┐ │
│   │ Rota  │Operadora │ DDD │ % Entrega│ Latência│ Score     │ │
│   │       │          │     │ (7 dias) │  média  │ (0-100)   │ │
│   ├───────┼──────────┼─────┼──────────┼─────────┼───────────┤ │
│   │Rota B │ Claro    │ 11  │  98.2%   │  0.8s   │  97       │ │
│   │Rota A │ Claro    │ 11  │  95.1%   │  1.2s   │  91       │ │
│   │Rota D │ Vivo     │ 21  │  93.8%   │  1.1s   │  88       │ │
│   │ ...   │ ...      │ ... │  ...     │  ...    │  ...      │ │
│   └───────┴──────────┴─────┴──────────┴─────────┴───────────┘ │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│               MOTOR DE INTELIGÊNCIA (Claude API)               │
│                                                                │
│   Recebe:                                                      │
│   • Dados do teste de hoje                                     │
│   • Dados dos últimos 7 dias (comparação)                      │
│   • Custo por rota                                             │
│   • Matriz completa de resultados                              │
│                                                                │
│   Analisa e gera:                                              │
│   ┌────────────────────────────────────────────────────────┐   │
│   │                                                        │   │
│   │  RANKING — Qual rota usar hoje por operadora/DDD       │   │
│   │  ALERTAS — O que piorou, o que caiu, o que mudou       │   │
│   │  TENDÊNCIAS — Rota X vem caindo há 3 dias seguidos     │   │
│   │  CUSTO-BENEFÍCIO — Rota cara mas boa vs barata e ruim  │   │
│   │  RECOMENDAÇÃO — Ação clara do que fazer agora           │   │
│   │  ANOMALIAS — DDD 85 não entrega em nenhuma rota (novo) │   │
│   │                                                        │   │
│   └────────────────────────────────────────────────────────┘   │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│                    ENTREGA DO RELATÓRIO                         │
│                                                                │
│   ┌───────────────────────────────────────────────────────┐    │
│   │                                                       │    │
│   │  RELATÓRIO DIÁRIO — 26/02/2026 — 07:35               │    │
│   │                                                       │    │
│   │  RESUMO                                               │    │
│   │  Testes: 540 | Entrega geral: 94.2% | Rotas: 5       │    │
│   │                                                       │    │
│   │  MELHOR ROTA POR OPERADORA                            │    │
│   │  ┌──────────┬────────────┬──────────┬──────────┐      │    │
│   │  │Operadora │ Melhor Rota│ Entrega  │ Latência │      │    │
│   │  ├──────────┼────────────┼──────────┼──────────┤      │    │
│   │  │ Claro    │ Rota B     │ 98.2%    │ 0.8s     │      │    │
│   │  │ Vivo     │ Rota B     │ 97.1%    │ 0.9s     │      │    │
│   │  │ TIM      │ Rota D     │ 96.5%    │ 0.7s     │      │    │
│   │  │ Oi       │ Rota A     │ 91.3%    │ 1.4s     │      │    │
│   │  └──────────┴────────────┴──────────┴──────────┘      │    │
│   │                                                       │    │
│   │  ALERTAS                                              │    │
│   │  • Rota C: entrega caiu de 93% pra 78% (3 dias)      │    │
│   │  • Rota A: latência subiu 40% pra Vivo DDD 21        │    │
│   │                                                       │    │
│   │  RECOMENDAÇÃO                                         │    │
│   │  → Rota B como primária (Claro + Vivo)                │    │
│   │  → Rota D como primária (TIM)                         │    │
│   │  → Rota A como fallback geral                         │    │
│   │  → Pausar Rota C — investigar com fornecedor          │    │
│   │                                                       │    │
│   └───────────────────────────────────────────────────────┘    │
│                                                                │
│   Entrega via:                                                 │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│   │  Slack   │  │  Email   │  │ WhatsApp │                    │
│   └──────────┘  └──────────┘  └──────────┘                    │
│                                                                │
│   Opcional:                                                    │
│   ┌─────────────────────────────────────────────────────┐      │
│   │  Dashboard Web — histórico, tendências, filtros     │      │
│   └─────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────┘
```

---

## FLUXO SIMPLIFICADO (RESUMO)

```
  07:00  CRON dispara
           │
           ▼
  07:01  Robô consulta rotas ativas (SendSpeed) + números teste (TelQ)
           │
           ▼
  07:02  Robô manda SMS de teste:
         [SendSpeed Rota X] ──SMS──▶ [Número TelQ operadora Y, DDD Z]
           │
           ▼
  07:12  TelQ retorna resultados de todos os testes
           │
           ▼
  07:13  Dados salvos no banco + scores calculados
           │
           ▼
  07:14  Claude API analisa dados + histórico → gera relatório
           │
           ▼
  07:15  Relatório enviado (Slack / Email / WhatsApp)
           │
           ▼
  07:15  Bruno abre o celular e sabe exatamente o que fazer
```

---

## PROJETOS

### PROJETO 1 — Contratar TelQ + Configurar Conta
**O que é:** Criar conta na TelQ, configurar os números de teste
que representam as operadoras e DDDs que você quer monitorar.

**O que precisa ser feito:**
- Criar conta na TelQ
- Escolher cobertura Brasil: quais operadoras (Claro, Vivo, TIM, Oi)
- Escolher DDDs prioritários (11, 21, 31, 41, 51, 61, 71, 81, 85...)
- Gerar API key
- Testar manualmente: enviar 1 SMS pela SendSpeed → número TelQ → ver se a TelQ registra

**Resultado esperado:** Conta ativa, API funcionando, teste manual validado.

**Quem faz:** Bruno

**Estimativa:** 1-2 dias

---

### PROJETO 2 — Robô de Teste Diário
**O que é:** O sistema que todo dia de manhã, sozinho, faz os testes
e guarda os resultados.

**O que precisa ser feito:**
- Criar script que roda automaticamente todo dia às 7h
- O script faz:
  1. Pergunta pra TelQ: "me dá números de teste pra Claro DDD 11, Vivo DDD 21, etc."
  2. Pra cada número, manda SMS por cada rota da SendSpeed
  3. Espera 5-10 minutos
  4. Pergunta pra TelQ: "quais SMS chegaram? quanto tempo demorou?"
  5. Salva tudo no banco de dados
  6. Calcula um score pra cada rota (nota de 0 a 100)

**Resultado esperado:** Banco de dados alimentado diariamente com a performance
real de cada rota, por operadora e DDD.

**Quem faz:** Dev backend (Pedro ou outro dev)

**Estimativa:** 1 semana

---

### PROJETO 3 — Inteligência + Relatório Diário
**O que é:** Pegar os dados do teste, analisar com IA e entregar
um relatório claro com decisões prontas.

**O que precisa ser feito:**
- Após o robô terminar os testes, enviar os dados pra Claude API
- Claude analisa: ranking de rotas, alertas, tendências, custo-benefício
- Formatar o relatório de forma simples e visual
- Enviar automaticamente pro canal escolhido (Slack, Email ou WhatsApp)
- Opcional: dashboard web pra consultar histórico

**Resultado esperado:** Todo dia pela manhã, Bruno recebe no celular
um relatório dizendo: "use Rota B pra Claro, Rota D pra TIM,
Rota C tá com problema, investigar."

**Quem faz:** Dev backend + configuração de prompts

**Estimativa:** 1 semana

---

## RESUMO EXECUTIVO

| # | Projeto | Depende de | Tempo | Custo |
|---|---------|-----------|-------|-------|
| 1 | Contratar TelQ | — | 1-2 dias | Plano TelQ (~€200-500/mês) |
| 2 | Robô de teste diário | Projeto 1 | 1 semana | Dev time |
| 3 | Inteligência + Relatório | Projeto 2 | 1 semana | Claude API (~$50-100/mês) |

**Tempo total: ~2-3 semanas**
**Custo mensal estimado: R$2.000-5.000/mês** (TelQ + Claude API + infra)

---

## COMPARATIVO: ANTES vs AGORA

| | Chip Farm Física (v1) | TelQ (v2) |
|---|---|---|
| **Projetos** | 6 | 3 |
| **Tempo total** | 5-8 semanas | 2-3 semanas |
| **Investimento inicial** | R$10.000-20.000 | R$0 |
| **Custo mensal** | ~R$500 (infra) | ~R$2.000-5.000 (TelQ + API) |
| **Operação manual** | Alta (chips, bloqueios, recargas) | Zero |
| **Cobertura** | Só o que você comprou | Todas operadoras + DDDs |
| **Escala** | Limitada ao hardware | Sob demanda |
| **Risco** | Chip bloqueia, queima, operadora corta | Nenhum (é da TelQ) |
| **Tempo pra valor** | 5-8 semanas | 2-3 semanas |

---

## PRÓXIMA AÇÃO

1. Bruno cria conta na TelQ e valida cobertura Brasil
2. Pedro recebe spec do Projeto 2 pra começar desenvolvimento
3. Em paralelo, definir canal de entrega do relatório (Slack? Email? WhatsApp?)
