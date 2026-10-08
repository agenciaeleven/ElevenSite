# Sistema Eleven — MVP P0

Software de gestão operacional da Agência Eleven: **Radar da agência**, painéis de cliente com as lentes **Execução / Evolução / Saúde**, fluxos e tarefas interligados, **Meu Dia** (daily inteligente), agenda única, central de alertas, squads e relatórios. Interface em português, persistência real em PostgreSQL, perfis com permissões aplicadas no servidor.

> Este diretório é um app independente do site institucional (raiz do repositório). Nada aqui altera o site.

## Sumário
1. [Rodar localmente](#1-rodar-localmente)
2. [Acesso e perfis](#2-acesso-e-perfis)
3. [Como testar (roteiro de 15 minutos)](#3-como-testar-roteiro-de-15-minutos)
4. [Começar com um cliente real](#4-começar-com-um-cliente-real)
5. [Publicar (deploy)](#5-publicar-deploy)
6. [Arquitetura e banco](#6-arquitetura-e-banco)
7. [Regras de cálculo](#7-regras-de-cálculo)
8. [O que funciona, o que é demo, o que falta](#8-o-que-funciona-o-que-é-demo-o-que-falta)
9. [Backup, exportação e segurança](#9-backup-exportação-e-segurança)

---

## 1. Rodar localmente

Pré-requisitos: Node 20+ e PostgreSQL 14+.

```bash
cd sistema
cp .env.example .env            # ajuste DATABASE_URL
npm install
npm run db:migrate              # cria as tabelas
npm run db:seed-demo            # (opcional) dados de DEMONSTRAÇÃO
npm run db:create-admin -- "Seu Nome" voce@agenciaeleven.com.br "senha-forte-aqui"
npm run dev                     # http://localhost:3100
```

Comandos úteis:

| Comando | Para quê |
|---|---|
| `npm test` | 24 testes (unitários de progresso + aceitação contra banco real em `DATABASE_URL_TEST`, recriado a cada execução) |
| `npm run typecheck` | Verificação de tipos |
| `npm run build && npm start` | Build e servidor de produção |
| `npm run db:seed-demo -- --reset` | Recria os dados de demonstração |
| `npm run docs:requisitos` | Regera `REQUISITOS_ELEVEN.md` a partir de `src/lib/requirements.ts` |

## 2. Acesso e perfis

| Perfil | Vê | Pode |
|---|---|---|
| **Direção / Admin** | Toda a agência, valores de contrato | Tudo: clientes, escopo vendido, usuários, squads, regras de alerta, remover demo |
| **Líder de squad** | Clientes dos squads que lidera/integra + onde tem tarefas | Estruturar fluxos, base planejada, prazos, responsáveis, Bússola/trimestre, decisões, relatórios, intervenções |
| **Colaborador** | Clientes dos seus squads + onde tem tarefas | Atualizar status, bloquear com motivo, registrar extras, apontar horas, Meu Dia. **Não** altera contrato, metas, prazos ou responsáveis de tarefas planejadas |

As permissões estão em `src/lib/access.ts` e são verificadas em **todo serviço** (`src/lib/services/*`). Acessar por URL um cliente fora do escopo devolve 404.

**Usuários de demonstração** (senha `eleven-demo`): `direcao@eleven.demo` (admin), `victoria@eleven.demo` (líder Fox), `pedro@eleven.demo` (líder Hornets), `diego@eleven.demo` (líder Panth), `tarcisio@`, `william@`, `lucas@`, `itala@eleven.demo` (colaboradores). Os nomes vêm do levantamento e são **exemplos editáveis**.

Criar usuários reais: **Pessoas → Novo usuário** (admin). A pessoa troca a senha em **Minha conta**.

## 3. Como testar (roteiro de 15 minutos)

Com a demo carregada (data de referência do cenário: 08/10/2026):

1. **Direção** (`direcao@eleven.demo`) → **Radar**: clientes ordenados por risco, compromissos do mês (realizado × esperado), fluxos em risco com o motivo, capacidade por squad. Filtre por squad/líder/serviço/saúde e troque o mês.
2. Abra **JCont** → lentes **Execução / Evolução / Saúde**; aba **Bússola** (objetivos A/B reais, meta de 10 mil seguidores com linha de base “a definir”, oportunidades); **Trimestre** (Mês 1/2/3); **Escopo contratado**.
3. Note “Linha editorial…”: **progresso ponderado indisponível** (sem horas) → barra hachurada “provisório”. Abra o fluxo, defina horas nas tarefas e veja virar ponderado.
4. **Colaborador** (`tarcisio@eleven.demo`) → **Meu Dia**: 5 tarefas previstas (4 do dia + 1 atrasada). Conclua 3 (botão ou select), registre 1 demanda não planejada, abra a última e **Bloquear** com “Aguardando cliente”. Teste também “Dia anterior” → “Feito em …” (registro retrospectivo).
5. **Líder** (`victoria@eleven.demo`) → **Saúde e alertas**: o bloqueio aparece com causa, responsável pela liberação e idade. Use **Perguntar motivo** / **Reconhecer** / orientação. Volte ao Radar: Ótica Santana atualizada.
6. **Ótica Santana** → ciclos 22/09, 09/10 e 19/10 independentes. No ciclo 22/09, conteúdos mostram **editado ≠ publicado**.
7. **Agenda** → abra “Captação … ciclo 19/10” → **Remarcar** (motivo obrigatório): muda na agenda geral, do squad, no fluxo e no prazo da tarefa “Captação”. **Cancelar** exige motivo e preserva histórico.
8. **Miro Móveis** → implantação set→out (não zera). Conclua as tarefas, **Concluir com aceite** e crie o acompanhamento contínuo.
9. **JCont → Relatórios e KPIs**: aprove a decisão proposta → vira tarefa vinculada; depois registre o resultado.
10. **Relatórios** → gere o semanal da Ótica (05/10–11/10), revise, marque revisado, **Copiar texto** ou **Versão para imprimir/PDF** (notas internas nunca saem).

## 4. Começar com um cliente real

1. Crie seu admin real e os usuários do squad piloto (**Pessoas**), squads (**Squads**) e capacidades semanais.
2. **Configurações → Dados de demonstração → Remover** (digite REMOVER). Usuários demo são desativados.
3. **Configurações → Biblioteca de fluxos**: revise os modelos (etapas, horas estimadas = pesos, prazos relativos à data de referência).
4. **Clientes → Cadastrar cliente** → aba **Escopo contratado**: contrato, serviços, entregáveis (quantidade, periodicidade, critério de aceite). Líder clica **Aceitar passagem**.
5. **Fluxos e projetos → Novo fluxo** a partir de um modelo (ex.: ciclo de captação com a data da captação). “Iniciar execução agora” fixa a base planejada.
6. No fluxo: atribua responsáveis inline, agende a produção (vinculando a tarefa “Captação”), crie conteúdos (EDIÇÃO/PUBLICAÇÃO).
7. Equipe passa a atualizar **apenas aqui** as tarefas do piloto (regra de transição: o app é a fonte de verdade desses fluxos; ClickUp segue para o restante até a migração).

## 5. Publicar (deploy)

Recomendado: **Vercel + Postgres gerenciado (Neon, Supabase ou RDS)**.

1. Crie o banco e copie a connection string (com `sslmode=require`).
2. Rode as migrações apontando para ele: `DATABASE_URL="postgres://…" npx tsx scripts/migrate.ts` e crie o admin com `scripts/create-admin.ts` da mesma forma.
3. Na Vercel: **New Project** → este repositório → **Root Directory = `sistema`** (projeto separado do site). Variáveis: `DATABASE_URL`, `APP_TIMEZONE=America/Sao_Paulo`. Build padrão (`next build`).
4. Para serverless, use a URL com *pooling* do provedor (ex.: Neon “pooled”) e, se precisar, `DB_POOL_MAX=1`.

Alternativa: qualquer host Node (`npm run build && npm start`, porta 3100) com PostgreSQL.

## 6. Arquitetura e banco

- **Stack**: Next.js 15 (App Router, Server Components + Server Actions), TypeScript, PostgreSQL via `postgres` (SQL explícito, sem ORM), sessões em banco com cookie httpOnly, senhas bcrypt. Sem microserviços nem filas.
- **Camadas**: `src/lib/services/*` (regras de negócio + permissões + auditoria) → `src/app/actions.ts` (leitura de formulário) → páginas em `src/app/(app)`. Cálculos puros e testados em `src/lib/progress.ts`; regras de saúde em `src/lib/services/alerts.ts`.
- **Migrações**: `db/migrations/*.sql`, aplicadas em ordem por `npm run db:migrate` (tabela `schema_migrations`). Para evoluir, crie `002_…sql`.

Entidades principais (`db/migrations/001_init.sql`):

| Domínio | Tabelas |
|---|---|
| Acesso | `workspaces`, `users` (perfil), `sessions`, `squads`, `squad_members` (N:N, alocação) |
| Cliente e escopo | `clients`, `client_squads`, `contracts` (versão, handoff), `services`, `deliverables` |
| Estratégia | `strategic_compasses` (versões), `strategic_objectives`, `strategic_fronts`, `kpi_definitions`, `kpi_observations`, `strategic_opportunities`, `quarterly_plans`, `initiatives`, `initiative_objectives` (N:N) |
| Execução | `flow_templates`, `flow_template_steps`, `flow_instances` (tipo, status, base versionada, `parent_flow_id`), `flow_deliverables` (N:N), `tasks` (hierarquia, base, extra, espera, cancelamento com tratamento), `task_dependencies`, `task_evidence`, `time_entries`, `content_assets` (estado editorial separado) |
| Agenda | `calendar_events`, `event_participants`, `meeting_items` |
| Fatos e saúde | `operational_events` (auditoria: quem, `recorded_at`, `occurred_at`, antes/depois, motivo), `manual_activity_entries`, `daily_closings`, `blockers`, `justification_requests`, `manager_interventions`, `alert_rules`, `alert_acks` |
| Resultados | `client_reports`, `decisions` (diagnóstico → aprovação → tarefa → resultado) |

Todo dado de demonstração tem `is_demo = true` e selo **Demo** na interface.

## 7. Regras de cálculo

- **Progresso ponderado** = Σ(horas estimadas das tarefas concluídas) ÷ Σ(horas estimadas da base planejada). Conclusão binária no P0.
- Tarefa sem estimativa **não recebe peso inventado**: o fluxo mostra “progresso ponderado indisponível” e uma barra **hachurada “provisório por contagem”** + alerta de configuração.
- **Base planejada**: tarefas com `in_baseline`. Incluir/retirar de fluxo em execução exige motivo e gera nova versão. Extras contam esforço, não o % vendido. Cancelamento exige motivo e decisão (remover da base / manter como não entregue).
- **Esperado para a data** = soma dos pesos das tarefas com prazo até hoje (simplificação por marcos — não “dias corridos”).
- **Compromissos do mês** (Radar) = mesma régua aplicada às tarefas com prazo no mês: medida distinta do progresso da instância (projetos cruzam meses sem zerar).
- **Horas reais** (apontamentos) aparecem separadas e nunca alteram o %. Sem apontamento = “sem apontamento”, nunca 0h.
- **Alertas** (configuráveis em Configurações): prazo vencido; bloqueio (crítico após N dias ou previsão vencida); inatividade (N dias úteis sem movimentação relevante com etapa que já deveria estar ativa — ignora espera planejada, bloqueio registrado, revisão e prazos futuros); sobrecarga (horas estimadas em 7 dias × capacidade); sem responsável; sem estimativa; motivo pendente; decisão aguardando. Saúde do cliente/fluxo = pior alerta, sempre com as razões.

## 8. O que funciona, o que é demo, o que falta

**Funciona de verdade (persistido e testado):** login e perfis; CRUD de clientes, contrato/serviços/entregáveis, modelos de fluxo, fluxos, tarefas/subtarefas, conteúdos, eventos, Bússola/objetivos/frentes/KPIs/oportunidades, trimestres/iniciativas, relatórios e decisões; Radar e as três lentes calculados do banco; Meu Dia com feed automático, registro retrospectivo, complementos, extras, fechamento e resumo copiável; bloqueios, pedidos de motivo, intervenções e reconhecimento de alertas; agenda semana/mês/lista com conflitos, remarcação e cancelamento auditados; relatório semanal revisável, copiável e imprimível.

**Simulado/demonstrativo:** apenas os dados da demo (status, horas, quantidades, KPI de CPL) — rotulados. Não há envio automático de relatórios nem IA.

**Limites conhecidos do P0:** alertas calculados na leitura (sem agendador/notificação); feriados não entram no cálculo de dias úteis; sem upload de arquivos (evidência = link); sem importação CSV do ClickUp; sem portal do cliente. Ver o backlog completo em **[REQUISITOS_ELEVEN.md](REQUISITOS_ELEVEN.md)** (também na tela **Backlog**).

**Próximas etapas sugeridas (P1):** importação CSV do ClickUp com fila de saneamento; motor de alertas agendado com notificações; painel de gargalos; capacidade com férias/feriados; relatório mensal de tráfego completo; experiência visual de Bússola/trimestre; IA assistiva com evidências quando houver API.

## 9. Backup, exportação e segurança

- **Backup**: `pg_dump "$DATABASE_URL" > backup-$(date +%F).sql` (ou backups automáticos do provedor). Restauração: `psql "$DATABASE_URL" < backup.sql`.
- **Exportação**: relatórios via “Copiar texto” e impressão/PDF; dados completos via `pg_dump` ou `\copy` por tabela.
- **Segurança**: troque todas as senhas de demonstração ou remova a demo antes do piloto; use HTTPS (padrão na Vercel); valores de contrato só aparecem para admin; notas internas e justificativas nunca vão para relatórios de cliente; nenhum dado de vida pessoal é modelado.
