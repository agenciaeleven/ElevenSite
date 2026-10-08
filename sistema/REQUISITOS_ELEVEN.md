# REQUISITOS_ELEVEN — Registro rastreável REQ-001 a REQ-060

Gerado por `npm run docs:requisitos` a partir de `src/lib/requirements.ts` (também exibido na tela **Backlog** do sistema).
Nenhum requisito foi removido ao condensar o MVP. Estados: **Feito e testado** (com teste automatizado em `tests/`), **Feito**, **Parcial** (base P0 entregue, evolução pendente), **Planejado**.

Resumo: 25 feitos e testados · 17 feitos · 16 parciais · 2 planejados.

| ID | Requisito | Prior. | Estado | Telas / entidades | Testes | Pendências |
|---|---|---|---|---|---|---|
| REQ-001 | Visão de Execução por agência, cliente, fluxo, squad e colaborador. | P0 | Feito | Radar; Cliente › lente Execução; Fluxo; Squad; Pessoa; Meu Dia | — | — |
| REQ-002 | Visão de Evolução com progresso planejado/real, histórico e horas. | P0 | Feito e testado | Cliente › lente Evolução; Fluxo › Evolução da instância | AT-02, AT-11 | Curva diária com snapshots históricos (P1). |
| REQ-003 | Visão de Saúde com bloqueios, riscos, atrasos e decisões. | P0 | Feito e testado | Cliente › lente Saúde; Central de saúde; Radar | AT-06 | — |
| REQ-004 | Escopo comercial/entregáveis contratados com critérios e vigência. | P0 | Feito e testado | Cliente › Escopo contratado (contracts, services, deliverables) | AT-01, AT-14 | — |
| REQ-005 | Bússola estratégica de cada cliente. | P0 | Parcial (base P0) | Cliente › Bússola (strategic_compasses, objectives, fronts) | — | Experiência visual avançada (P1). |
| REQ-006 | Planejamento Trimestral com prioridades, iniciativas e metas. | P0 | Parcial (base P0) | Cliente › Trimestre (quarterly_plans, initiatives) | — | Metas intermediárias por mês e painel avançado (P1). |
| REQ-007 | Rastreabilidade entre objetivos, iniciativas, entregáveis e fluxos. | P0 | Parcial (base P0) | initiative_objectives (N:N), initiatives.flow_id, flow_deliverables (N:N) | — | Mapa visual de rastreabilidade (P1). |
| REQ-008 | Versionamento de Bússola, planejamento e escopo. | P1 | Parcial (base P0) | Bússola com versões; contrato com versão + histórico; base planejada do fluxo versionada | — | Versionamento do planejamento trimestral e comparação entre versões. |
| REQ-009 | Passagem de bastão comercial → operação. | P0 | Feito | Escopo contratado › notas de handoff + aceite da operação | — | — |
| REQ-010 | Fluxo estruturado de onboarding. | P0 | Feito | Modelo “Onboarding de cliente” na biblioteca | — | — |
| REQ-011 | Implantação inicial, geralmente única. | P0 | Feito e testado | Tipo de execução Implantação + conclusão com aceite | AT-08 | — |
| REQ-012 | Suporte a tipos de execução recorrente, projeto, contínua e extra. | P0 | Feito | flow_instances.lifecycle; agrupamento no painel do cliente | — | — |
| REQ-013 | Biblioteca de fluxos reutilizáveis. | P0 | Feito e testado | Configurações › Biblioteca de fluxos (etapas, horas, prazos relativos) | AT-01 | — |
| REQ-014 | Instâncias de execução/ciclos com histórico próprio. | P0 | Feito e testado | flow_instances + operational_events por fluxo | AT-04 | — |
| REQ-015 | Gestão de tarefas, atribuições, revisão, conclusão e reabertura. | P0 | Feito e testado | Tarefa; status inline; reabertura com motivo | AT-02, AT-18 | — |
| REQ-016 | Gestão de conteúdos individuais por produção/roteiro/edição/publicação. | P0 | Parcial (base P0) | content_assets com estado editorial separado; tarefas EDIÇÃO/PUBLICAÇÃO | AT-05 | Roteirização e aprovação de ativos avançadas (P1). |
| REQ-017 | Agenda operacional compartilhada e sem duplicações. | P0 | Feito e testado | Agenda (semana/mês/lista), evento único em agenda/squad/fluxo | AT-03, AT-16 | — |
| REQ-018 | Histórico de eventos auditável. | P0 | Feito e testado | operational_events (quem, registrado_em, ocorrido_em, antes/depois, motivo) | AT-17, AT-18 | — |
| REQ-019 | Central individual Meu Dia. | P0 | Feito e testado | Meu Dia | AT-02, AT-07 | — |
| REQ-020 | Formas flexíveis de registro do daily por colaborador. | P0 | Feito | Meu Dia: planejar, marcar durante, registrar retroativo, complementos | — | — |
| REQ-021 | Histórico automático de ações confirmadas. | P0 | Feito e testado | Linha do tempo do dia (eventos reais; agendado ≠ realizado) | AT-02 | — |
| REQ-022 | Registro de demandas extraordinárias. | P0 | Feito e testado | Meu Dia › Registrar atividade (demanda não planejada) | AT-07 | — |
| REQ-023 | Justificativas estruturadas para pendências e bloqueios. | P0 | Feito e testado | Bloqueio com categoria; pedido de motivo ao responsável | AT-06 | — |
| REQ-024 | Acompanhamento de líderes e pendências. | P0 | Feito | Central de saúde; Radar › aguardando decisão | — | — |
| REQ-025 | One-on-one, correções, encaminhamentos e auditoria. | P1 | Parcial (base P0) | manager_interventions (registro e resolução) | — | Histórico de one-on-one por pessoa e feedbacks estruturados (P1). |
| REQ-026 | Progresso ponderado por pesos/horas planejadas. | P0 | Feito e testado | src/lib/progress.ts | AT-11, AT-12 | — |
| REQ-027 | Horas planejadas e reais separadas da conclusão. | P0 | Feito e testado | tasks.est_hours × time_entries | AT-11 | — |
| REQ-028 | Capacidade de squads e colaboradores. | P0 | Parcial (base P0) | Radar › capacidade por squad; Squad; alerta de sobrecarga | — | Capacidade avançada, férias/feriados no cálculo (P1). |
| REQ-029 | Evolução temporal prevista x realizada. | P1 | Parcial (base P0) | Esperado por marcos (prazos) + meses + conclusões por semana | — | Curva temporal com snapshots e linha de base por data (P1). |
| REQ-030 | Indicadores de resultado do cliente vinculados à Bússola. | P0 | Parcial (base P0) | kpi_definitions.objective_id + kpi_observations (manual) | — | Integração com fontes (Meta Ads etc.) — P2. |
| REQ-031 | Regras de monitoramento de saúde. | P0 | Feito e testado | alert_rules configuráveis; src/lib/services/alerts.ts | AT-06 | Motor agendado com notificações (P1). |
| REQ-032 | Consolidação de gargalos operacionais. | P1 | Planejado | Base pronta: categorias de bloqueio/justificativa | — | Painel de gargalos por categoria/squad/período. |
| REQ-033 | Assistência IA com evidências e supervisão. | P1 | Planejado | Ponto de extensão reservado (sem simulação de IA) | — | Depende de API de IA; sempre com evidências e aprovação humana. |
| REQ-034 | Relatórios semanais para clientes. | P0 | Feito e testado | Relatórios › semanal (revisão, cópia, impressão/PDF) | AT-15 | — |
| REQ-035 | Aprovação humana e permissões em mudanças críticas. | P0 | Feito e testado | Perfis no servidor (src/lib/access.ts); motivos obrigatórios | AT-14 | — |
| REQ-036 | Objetivos, metas, frentes, iniciativas e tarefas como entidades distintas. | P0 | Feito | Tabelas separadas: objectives, fronts, kpi_definitions, initiatives, tasks | — | — |
| REQ-037 | KPI com baseline, meta, prazo e fonte. | P0 | Feito | Bússola › Indicadores (baseline vazio = “a definir”) | — | — |
| REQ-038 | Banco de oportunidades estratégicas com estados de avaliação. | P0 | Feito | Bússola › Banco de oportunidades | — | — |
| REQ-039 | Relacionamentos rastreáveis entre Bússola, trimestre, contrato e execução. | P0 | Parcial (base P0) | compass_id no trimestre, plan_id no fluxo, entregáveis no fluxo | — | Visão consolidada de rastreabilidade (P1). |
| REQ-040 | Criar trimestre reaproveitando Bússola sem duplicá-la. | P0 | Feito | quarterly_plans.compass_id (referência, não cópia) | — | — |
| REQ-041 | Oportunidades não aprovadas não geram execução. | P0 | Feito e testado | convertOpportunity exige status aprovada | AT-09b | — |
| REQ-042 | Planejamento Trimestral por três meses. | P0 | Feito | Trimestre › Mês 1 / Mês 2 / Mês 3 | — | — |
| REQ-043 | Calendário de oportunidades, sazonalidades e datas relevantes. | P1 | Parcial (base P0) | Iniciativa do tipo “data sazonal” com nota condicional | — | Calendário sazonal dedicado e sugestões contextualizadas. |
| REQ-044 | Conversão aprovada de ação em projeto ou fluxo existente. | P0 | Parcial (base P0) | Iniciativa/oportunidade aprovada → novo fluxo | — | UI para vincular a fluxo existente (serviço já suporta). |
| REQ-045 | Verificação de compatibilidade com escopo contratado. | P1 | Parcial (base P0) | Classificação manual dentro/avaliar/adicional aprovado | — | Checagem assistida contra entregáveis e saldo contratado. |
| REQ-046 | Revisão trimestral e histórico para próximo período. | P1 | Parcial (base P0) | Conclusões do trimestre (closing_notes) | — | Fluxo de encerramento trimestral com evidências e indicadores. |
| REQ-047 | Ciclos de vida distintos para fluxo, implantação, operação e projeto. | P0 | Feito | lifecycle + status do fluxo | — | — |
| REQ-048 | Encerrar implantação sem encerrar seu acompanhamento posterior. | P0 | Feito e testado | Concluir com aceite + criar acompanhamento derivado | AT-08 | — |
| REQ-049 | Resultados podem originar novas oportunidades/iniciativas. | P1 | Parcial (base P0) | Oportunidade com origem registrada | — | Atalho “gerar oportunidade” a partir de relatório/projeto encerrado. |
| REQ-050 | Conclusão de projeto ≠ saúde de operação contínua. | P0 | Feito | Saúde calculada por fluxo; projetos e operações separados | — | — |
| REQ-051 | Projetos atravessam meses/trimestres sem reset. | P0 | Feito e testado | Progresso da instância independente do mês | AT-08 | — |
| REQ-052 | Transições auditáveis implantação → operação → otimização → encerramento. | P0 | Feito e testado | parent_flow_id + eventos auditáveis | AT-08 | — |
| REQ-053 | Progresso da instância e cumprimento por período como medidas distintas. | P0 | Feito | Fluxo (instância) × Radar/Evolução (compromissos do mês) | — | — |
| REQ-054 | Serviço contratado com tipos diferentes de execução vinculados. | P0 | Feito | flow_instances.service_id com qualquer lifecycle | — | — |
| REQ-055 | Compromissos recorrentes separados de campanhas, testes e projetos pontuais. | P0 | Feito | Painel do cliente agrupado por tipo | — | — |
| REQ-056 | Relatórios periódicos ligados a KPIs, diagnóstico e decisões. | P1 | Parcial (base P0) | Relatório mensal de tráfego + decisões vinculadas | AT-09 | Modelo completo do relatório mensal e comparativos (P1). |
| REQ-057 | Oportunidade aprovada vira execução rastreável. | P0 | Feito e testado | Oportunidade → fluxo (converted_flow_id) | AT-09b | — |
| REQ-058 | Diagnóstico → ação → resultado posterior com histórico. | P0 | Feito e testado | decisions (diagnóstico, aprovação, tarefa, resultado) | AT-09 | — |
| REQ-059 | Indicadores separados de contrato, operação, capacidade e resultado. | P0 | Feito | Entregáveis × progresso × horas/capacidade × KPIs — exibidos separadamente | — | — |
| REQ-060 | Replanejamento justificado com histórico original preservado. | P0 | Feito e testado | Motivo obrigatório para prazo/base/estimativa; antes/depois no histórico | AT-10b | — |

## Referência dos testes de aceitação (tests/acceptance.test.ts)

AT-01 cadastro→escopo→fluxo→Radar · AT-02 conclusão atualiza histórico/Meu Dia/progresso/saúde · AT-03 produção única e remarcação · AT-04 ciclos independentes · AT-05 editado ≠ publicado · AT-06 bloqueio/justificativa/inatividade sem falso culpado · AT-07 demanda extra sem inflar escopo · AT-08 implantação cruzando meses + acompanhamento · AT-09 KPI→decisão→tarefa→resultado · AT-09b oportunidade só executa após aprovação · AT-10/10b encerramento e replanejamento com motivo · AT-11/12 progresso ponderado e ausência de estimativa · AT-13 filtro por squad com atuação cruzada · AT-14 permissões no servidor · AT-15 relatório semanal sem dados internos · AT-16 cancelar exige motivo · AT-17 registro retrospectivo · AT-18 reabertura auditada · AT-19 dado real não herda demo. AT-20 (recarregar sem perder dados; voltar ao cliente pela tarefa) verificado manualmente no navegador.
