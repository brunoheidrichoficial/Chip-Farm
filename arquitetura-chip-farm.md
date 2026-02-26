# Chip Farm SendSpeed — Arquitetura + Projetos

---

## ARQUITETURA GERAL

```
┌─────────────────────────────────────────────────────────────┐
│                      CAMADA FÍSICA                          │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ SIM Bank │  │ SIM Bank │  │ SIM Bank │  │ SIM Bank │   │
│  │  128 SIMs│  │  128 SIMs│  │  128 SIMs│  │  128 SIMs│   │
│  │  Claro   │  │  Vivo    │  │  TIM     │  │  Mix     │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │              │         │
│       └──────────────┴──────┬───────┴──────────────┘         │
│                             │                                │
│                        Rede Local                            │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   CAMADA DE CONEXÃO                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Gateway SMPP / HTTP API                 │    │
│  │   (traduz a comunicação dos SIM Banks pro sistema)  │    │
│  └──────────────────────┬──────────────────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                CAMADA DE GESTÃO DOS CHIPS                    │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐  │
│  │  Inventário   │  │   Rotação &   │  │  Health Check  │  │
│  │  de Chips     │  │   Cooldown    │  │  Contínuo      │  │
│  │               │  │               │  │                │  │
│  │ • Operadora   │  │ • Limites/dia │  │ • Chip vivo?   │  │
│  │ • DDD         │  │ • Descanso    │  │ • Bloqueado?   │  │
│  │ • Status      │  │ • Rodízio     │  │ • Sinal OK?    │  │
│  │ • Histórico   │  │   automático  │  │ • Saldo?       │  │
│  └───────────────┘  └───────────────┘  └────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              CAMADA DE TESTE AUTOMATIZADO                    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                CRON DIÁRIO (7h)                       │   │
│  │                                                      │   │
│  │  1. Seleciona amostra de chips por operadora/DDD     │   │
│  │  2. Define rotas a testar (todas as ativas)          │   │
│  │  3. Dispara SMS teste por cada combinação:           │   │
│  │     [Chip X] → [Rota Y] → [Número destino Z]        │   │
│  │  4. Aguarda delivery receipts (timeout 5min)         │   │
│  │  5. Registra: entregou? latência? erro? código?      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Matriz de teste:                                           │
│  ┌────────────┬─────────┬─────────┬─────────┬──────────┐   │
│  │            │ Rota A  │ Rota B  │ Rota C  │ Rota D   │   │
│  ├────────────┼─────────┼─────────┼─────────┼──────────┤   │
│  │ Claro→Claro│  ✓ 1.2s │  ✓ 0.8s│  ✗ fail │  ✓ 2.1s │   │
│  │ Claro→Vivo │  ✓ 1.5s │  ✓ 1.1s│  ✓ 0.9s│  ✗ fail │   │
│  │ Vivo→Claro │  ✓ 0.9s │  ✗ fail│  ✓ 1.3s│  ✓ 1.0s │   │
│  │ Vivo→TIM   │  ✗ fail │  ✓ 1.4s│  ✓ 1.1s│  ✓ 0.7s │   │
│  │ TIM→Claro  │  ✓ 1.1s │  ✓ 0.6s│  ✓ 1.5s│  ✓ 1.2s │   │
│  │ ...        │  ...    │  ...   │  ...   │  ...    │   │
│  └────────────┴─────────┴─────────┴─────────┴──────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   CAMADA DE DADOS                            │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   Banco de Dados                      │   │
│  │                                                      │   │
│  │  • Resultado de cada teste (histórico completo)      │   │
│  │  • Score de cada rota por combinação operadora       │   │
│  │  • Tendências (rota piorando? melhorando?)           │   │
│  │  • Status de cada chip (ativo, bloqueado, cooldown)  │   │
│  │  • Custo por rota                                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                CAMADA DE INTELIGÊNCIA                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Motor de Análise (Claude API)            │   │
│  │                                                      │   │
│  │  Recebe os dados do dia e responde:                  │   │
│  │                                                      │   │
│  │  • Ranking de rotas (qual a melhor hoje?)            │   │
│  │  • Alertas (rota X caiu 30% vs ontem)                │   │
│  │  • Padrões (Claro→Vivo sempre falha na Rota C)       │   │
│  │  • Recomendação (usar Rota B como primária hoje)     │   │
│  │  • Chips com problema (12 chips bloqueados)          │   │
│  │  • Custo-benefício (Rota A entrega mais mas custa 2x)│   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 CAMADA DE ENTREGA                            │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
│  │  Slack   │  │  Email   │  │ WhatsApp  │  │Dashboard │  │
│  │  diário  │  │  diário  │  │  resumo   │  │  web     │  │
│  └──────────┘  └──────────┘  └───────────┘  └──────────┘  │
│                                                             │
│  Exemplo de relatório:                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  📊 RELATÓRIO DIÁRIO — 26/02/2026                    │   │
│  │                                                      │   │
│  │  Chips ativos: 487/500 (13 em cooldown)              │   │
│  │  Testes realizados: 2.340                            │   │
│  │  Taxa de entrega geral: 94.2%                        │   │
│  │                                                      │   │
│  │  RANKING DE ROTAS:                                   │   │
│  │  1. Rota B — 97.8% entrega — latência 0.9s — R$0.03 │   │
│  │  2. Rota D — 96.1% entrega — latência 1.1s — R$0.02 │   │
│  │  3. Rota A — 93.4% entrega — latência 1.4s — R$0.04 │   │
│  │  4. Rota C — 78.2% entrega — latência 2.3s — R$0.02 │   │
│  │                                                      │   │
│  │  ALERTAS:                                            │   │
│  │  ⚠ Rota C caiu 15% vs ontem (investigar)            │   │
│  │  ⚠ 8 chips Claro DDD 11 bloqueados                  │   │
│  │                                                      │   │
│  │  RECOMENDAÇÃO:                                       │   │
│  │  → Priorizar Rota B para Claro/Vivo                  │   │
│  │  → Usar Rota D como fallback                         │   │
│  │  → Pausar Rota C até normalizar                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## PROJETOS (VISÃO NÃO-TÉCNICA)

O épico "Chip Farm SendSpeed" se divide em **6 projetos**, em ordem de execução:

---

### PROJETO 1 — Compra e Montagem da Fazenda de Chips
**O que é:** Comprar os equipamentos que seguram os chips e os próprios chips.

**O que precisa ser feito:**
- Definir quantos chips por operadora (ex: 150 Claro, 150 Vivo, 100 TIM, 100 Oi)
- Comprar os aparelhos que seguram os chips (SIM Banks) — são tipo "gavetas" que comportam 128 chips cada
- Comprar ~500 chips pré-pagos ou fechar contrato corporativo com operadoras
- Montar fisicamente: colocar chips nos aparelhos, ligar na rede, ligar na internet

**Resultado esperado:** 500 chips ligados, conectados à internet, prontos pra enviar SMS.

**Quem faz:** Bruno (decisão de compra) + alguém de infra/TI (montagem física)

**Estimativa:** 2-4 semanas (gargalo é entrega de equipamento e chips)

---

### PROJETO 2 — Sistema de Controle dos Chips
**O que é:** Software que sabe o estado de cada chip: tá vivo? tá bloqueado? quantos SMS mandou hoje? precisa descansar?

**O que precisa ser feito:**
- Cadastrar cada chip no sistema (operadora, DDD, número, slot)
- Criar regras de uso: máximo de SMS por chip por dia, tempo de descanso entre usos
- Criar checagem automática: o sistema verifica sozinho se o chip ainda funciona
- Alerta quando chip for bloqueado pela operadora

**Resultado esperado:** Painel onde você vê os 500 chips, status de cada um em tempo real, sem precisar checar manualmente.

**Quem faz:** Pedro / dev backend

**Estimativa:** 1-2 semanas

---

### PROJETO 3 — Conexão com as Rotas da SendSpeed
**O que é:** Ligar a fazenda de chips com as rotas de SMS que a SendSpeed já usa no dia a dia.

**O que precisa ser feito:**
- Mapear todas as rotas ativas (fornecedores de SMS)
- Criar a integração: o sistema consegue escolher "manda esse SMS pela Rota A" ou "pela Rota B"
- Garantir que o teste usa as mesmas rotas que a operação real usa

**Resultado esperado:** O sistema da chip farm consegue enviar SMS por qualquer rota da SendSpeed de forma controlada.

**Quem faz:** Pedro / dev backend + quem cuida das integrações de rota

**Estimativa:** 1 semana

---

### PROJETO 4 — Robô de Teste Diário
**O que é:** O "cérebro" que todo dia de manhã, sozinho, testa todas as combinações de rota + operadora e registra os resultados.

**O que precisa ser feito:**
- Criar o robô que roda todo dia às 7h automaticamente
- Ele pega uma amostra de chips de cada operadora
- Manda SMS de teste por cada rota disponível
- Espera a confirmação de entrega
- Anota tudo: entregou ou não, quanto tempo demorou, qual erro deu
- Grava num banco de dados

**Resultado esperado:** Todo dia às 7h30 você tem os dados frescos de performance de cada rota, sem ninguém fazer nada manualmente.

**Quem faz:** Dev backend

**Estimativa:** 1-2 semanas

---

### PROJETO 5 — Inteligência e Análise Automática
**O que é:** Uma camada de IA que pega os dados do teste e transforma em decisão — ao invés de você ler planilha, recebe um resumo com recomendações.

**O que precisa ser feito:**
- Conectar os dados de teste com a API do Claude (IA)
- Criar as perguntas certas: "qual rota tá melhor?", "alguma piorou?", "o que mudou vs ontem?"
- A IA gera o relatório com ranking, alertas e recomendações
- Comparação com histórico (tendências de dias/semanas)

**Resultado esperado:** Relatório diário inteligente, não só números — mas com análise e recomendação de ação.

**Quem faz:** Dev backend + eu (Claude) ajudo a construir os prompts e lógica de análise

**Estimativa:** 1 semana

---

### PROJETO 6 — Entrega do Relatório
**O que é:** Fazer o relatório chegar em você automaticamente, no canal que preferir.

**O que precisa ser feito:**
- Definir onde quer receber (Slack, Email, WhatsApp, ou tudo)
- Formatar o relatório pra ser fácil de ler no celular
- Opcionalmente: montar um dashboard web pra consultar histórico e tendências

**Resultado esperado:** Toda manhã você acorda, abre o celular, e já sabe qual rota tá boa, qual tá ruim, e o que fazer.

**Quem faz:** Dev frontend (se dashboard) + dev backend (automação de envio)

**Estimativa:** 3-5 dias

---

## RESUMO EXECUTIVO

| # | Projeto | Depende de | Tempo |
|---|---------|-----------|-------|
| 1 | Compra e montagem da farm | — | 2-4 semanas |
| 2 | Sistema de controle dos chips | Projeto 1 | 1-2 semanas |
| 3 | Conexão com rotas SendSpeed | Projeto 1 | 1 semana |
| 4 | Robô de teste diário | Projetos 2 e 3 | 1-2 semanas |
| 5 | Inteligência e análise (IA) | Projeto 4 | 1 semana |
| 6 | Entrega do relatório | Projeto 5 | 3-5 dias |

**Projetos 2 e 3 podem rodar em paralelo.**

**Tempo total estimado: 5-8 semanas** (considerando que procurement de hardware é o gargalo).

**Investimento estimado em hardware:**
- 4x SIM Banks 128 portas: ~R$8.000-15.000 (depende do fabricante)
- 500 chips pré-pagos: ~R$2.500-5.000 (depende da operadora e do modelo de compra)
- Servidor local ou cloud pra rodar o sistema: ~R$200-500/mês

---

## PRÓXIMA AÇÃO

Qual projeto você quer detalhar primeiro? Ou quer que eu já comece a especificar o Projeto 4 (robô de teste) que é o que vai precisar de mais desenvolvimento?
