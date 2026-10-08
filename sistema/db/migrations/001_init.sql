-- Sistema Eleven — esquema inicial (MVP P0)
-- Convenções: ids uuid; created_at/updated_at; is_demo marca dados de demonstração;
-- datas de calendário (prazo, início) como DATE; instantes como TIMESTAMPTZ.
-- Escopo exclusivamente profissional: nenhuma tabela de vida pessoal.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── Organização, pessoas e acesso ─────────────
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','lider','colaborador')),
  job_title text,
  weekly_capacity_hours numeric(6,2),          -- capacidade planejada; NULL = não definida
  active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE squads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text,
  leader_id uuid REFERENCES users(id),
  weekly_capacity_hours numeric(7,2),          -- opcional; se NULL usa soma dos membros
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Colaborador pode participar de vários squads (alocação cruzada)
CREATE TABLE squad_members (
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allocation_pct numeric(5,2),
  PRIMARY KEY (squad_id, user_id)
);

-- ───────────── Clientes e escopo comercial ─────────────
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('onboarding','ativo','pausado','encerrado')),
  segment text,
  contact_name text,
  contact_email text,
  account_owner_id uuid REFERENCES users(id),
  internal_notes text,                         -- nunca vai para relatório de cliente
  is_internal boolean NOT NULL DEFAULT false,  -- "Agência Eleven" (rotinas internas)
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE client_squads (
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, squad_id)
);

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'vigente' CHECK (status IN ('rascunho','vigente','encerrado')),
  start_date date,
  end_date date,
  version int NOT NULL DEFAULT 1,
  owner_id uuid REFERENCES users(id),
  handoff_notes text,                          -- passagem de bastão comercial → operação
  handoff_accepted_by uuid REFERENCES users(id),
  handoff_accepted_at timestamptz,
  monthly_value numeric(12,2),                 -- dado financeiro: apenas admin
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'outro' CHECK (kind IN ('conteudo','trafego','audiovisual','estrategia','crm','onboarding','outro')),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pausado','encerrado')),
  start_date date,
  end_date date,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL,
  name text NOT NULL,
  quantity numeric(8,2),
  unit text,
  periodicity text NOT NULL DEFAULT 'mensal' CHECK (periodicity IN ('unico','semanal','quinzenal','mensal','trimestral','sob_demanda')),
  acceptance_criteria text,
  reference_hours numeric(7,2),
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pausado','concluido','encerrado')),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Estratégia: Bússola, KPIs, oportunidades, trimestre ─────────────
CREATE TABLE strategic_compasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'vigente' CHECK (status IN ('rascunho','vigente','substituida')),
  diagnosis text,
  audience text,
  positioning text,
  guidelines text,
  hypotheses text,
  created_by uuid REFERENCES users(id),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, version)
);

CREATE TABLE strategic_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compass_id uuid NOT NULL REFERENCES strategic_compasses(id) ON DELETE CASCADE,
  code text,
  title text NOT NULL,
  description text,
  position int NOT NULL DEFAULT 0
);

CREATE TABLE strategic_fronts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES strategic_objectives(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  position int NOT NULL DEFAULT 0
);

CREATE TABLE kpi_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  objective_id uuid REFERENCES strategic_objectives(id) ON DELETE SET NULL,
  name text NOT NULL,
  unit text,
  baseline numeric(14,2),                      -- NULL = "a definir"
  target numeric(14,2),
  deadline date,
  source text,
  reliability text,
  is_fictitious boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE strategic_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  objective_id uuid REFERENCES strategic_objectives(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta','avaliando','aprovada','recusada','arquivada')),
  scope_check text CHECK (scope_check IN ('dentro_do_escopo','avaliar_escopo','escopo_adicional_aprovado')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  converted_flow_id uuid,                      -- FK adicionada após flow_instances
  origin text,                                 -- bússola, relatório, resultado de projeto...
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quarterly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  compass_id uuid REFERENCES strategic_compasses(id) ON DELETE SET NULL,
  label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'em_planejamento' CHECK (status IN ('em_planejamento','vigente','encerrado')),
  month1_focus text,
  month2_focus text,
  month3_focus text,
  closing_notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Motor de fluxos ─────────────
CREATE TABLE flow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('ciclico','implantacao','continuo','projeto')),
  description text,
  active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE flow_template_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES flow_templates(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  stage text,                                  -- etapa (agrupador)
  name text NOT NULL,
  role_hint text,                              -- função responsável sugerida
  est_hours numeric(6,2),                      -- peso; NULL = sem estimativa
  offset_days int,                             -- prazo relativo à data de referência do fluxo
  done_criteria text
);

CREATE TABLE flow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  template_id uuid REFERENCES flow_templates(id) ON DELETE SET NULL,
  quarterly_plan_id uuid REFERENCES quarterly_plans(id) ON DELETE SET NULL,
  parent_flow_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL, -- ex.: acompanhamento derivado da implantação
  name text NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('ciclico','implantacao','continuo','projeto','extra')),
  cycle_label text,
  reference_date date,                         -- ex.: data da captação do ciclo
  start_date date,
  due_date date,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('planejado','ativo','em_espera','concluido','cancelado','arquivado')),
  wait_reason text,
  wait_until date,
  baseline_version int NOT NULL DEFAULT 1,
  owner_id uuid REFERENCES users(id),
  objective text,
  acceptance_note text,
  completed_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE strategic_opportunities
  ADD CONSTRAINT strategic_opportunities_flow_fk FOREIGN KEY (converted_flow_id) REFERENCES flow_instances(id) ON DELETE SET NULL;

-- Um fluxo pode executar mais de um entregável (N:N)
CREATE TABLE flow_deliverables (
  flow_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  deliverable_id uuid NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  PRIMARY KEY (flow_id, deliverable_id)
);

CREATE TABLE initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES quarterly_plans(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'iniciativa' CHECK (kind IN ('iniciativa','campanha','projeto','sazonal','marco')),
  month_index int CHECK (month_index BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta','aprovada','em_execucao','concluida','descartada')),
  scope_check text CHECK (scope_check IN ('dentro_do_escopo','avaliar_escopo','escopo_adicional_aprovado')),
  conditional_note text,
  opportunity_id uuid REFERENCES strategic_opportunities(id) ON DELETE SET NULL,
  flow_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Iniciativa contribui para vários objetivos (N:N)
CREATE TABLE initiative_objectives (
  initiative_id uuid NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  objective_id uuid NOT NULL REFERENCES strategic_objectives(id) ON DELETE CASCADE,
  PRIMARY KEY (initiative_id, objective_id)
);

-- Conteúdo individual (vídeo/card) — estado editorial separado do status de tarefas
CREATE TABLE content_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  flow_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  deliverable_id uuid REFERENCES deliverables(id) ON DELETE SET NULL,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'video' CHECK (kind IN ('video','card','carrossel','stories','outro')),
  script text,
  editorial_state text NOT NULL DEFAULT 'roteiro' CHECK (editorial_state IN ('roteiro','producao','edicao','aprovacao','agendada','postada','descartada')),
  approval_state text NOT NULL DEFAULT 'pendente' CHECK (approval_state IN ('pendente','aprovado','ajustes')),
  edited_at timestamptz,
  approved_at timestamptz,
  scheduled_for timestamptz,
  published_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  flow_id uuid REFERENCES flow_instances(id) ON DELETE CASCADE,
  parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  content_id uuid REFERENCES content_assets(id) ON DELETE SET NULL,
  template_step_id uuid REFERENCES flow_template_steps(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  stage text,
  position int NOT NULL DEFAULT 0,
  assignee_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'a_fazer' CHECK (status IN ('a_fazer','em_andamento','bloqueada','em_revisao','concluida','cancelada')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta','urgente')),
  start_date date,
  due_date date,
  est_hours numeric(6,2),                      -- peso do progresso; NULL = sem estimativa (sem peso inventado)
  in_baseline boolean NOT NULL DEFAULT true,   -- faz parte da base planejada (denominador)
  is_extra boolean NOT NULL DEFAULT false,     -- demanda não planejada
  scope_class text CHECK (scope_class IN ('dentro_do_escopo','avaliar_escopo','escopo_adicional_aprovado')),
  waiting_until date,                          -- espera planejada (não gera alerta de inatividade)
  waiting_reason text,
  done_criteria text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamptz,                    -- quando ocorreu a conclusão
  completed_recorded_at timestamptz,           -- quando a conclusão foi registrada
  cancel_reason text,
  cancel_scope_treatment text CHECK (cancel_scope_treatment IN ('remover_da_base','manter_na_base')),
  reopened_count int NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','modelo','meu_dia','importacao','decisao','reuniao')),
  external_source text,
  external_id text,
  imported_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE task_dependencies (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

CREATE TABLE task_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url text,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Horas reais: separadas do progresso (horas gastas ≠ % concluído)
CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  hours numeric(6,2) NOT NULL CHECK (hours > 0),
  occurred_on date NOT NULL,
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Agenda ─────────────
CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('producao','reuniao','entrega','indisponibilidade','feriado','outro')),
  title text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  flow_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  squad_id uuid REFERENCES squads(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  status text NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','realizado','cancelado')),
  cancel_reason text,
  reschedule_count int NOT NULL DEFAULT 0,
  meeting_notes text,                          -- ata (reuniões)
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_participants (
  event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance text NOT NULL DEFAULT 'previsto' CHECK (attendance IN ('previsto','confirmado','ausente')),
  PRIMARY KEY (event_id, user_id)
);

-- Encaminhamentos de reunião: decisão/solicitação NÃO vira tarefa automaticamente
CREATE TABLE meeting_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'decisao' CHECK (kind IN ('decisao','encaminhamento','duvida')),
  text text NOT NULL,
  owner_id uuid REFERENCES users(id),
  due_date date,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Eventos operacionais (trilha de auditoria + base do daily) ─────────────
CREATE TABLE operational_events (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),   -- quando foi registrado
  occurred_at timestamptz NOT NULL DEFAULT now(),   -- quando ocorreu (retrospectivo)
  entity_type text NOT NULL,
  entity_id uuid,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  flow_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  action text NOT NULL,
  summary text NOT NULL,
  reason text,
  before jsonb,
  after jsonb,
  is_relevant boolean NOT NULL DEFAULT true,        -- conta como "movimentação relevante"
  is_demo boolean NOT NULL DEFAULT false
);

-- Complementos manuais do daily (não duplicam tarefas existentes)
CREATE TABLE manual_activity_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  occurred_on date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'complemento' CHECK (kind IN ('complemento','demanda_extra','observacao','plano')),
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  flow_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  description text NOT NULL,
  hours numeric(6,2),
  link text,
  is_demo boolean NOT NULL DEFAULT false
);

CREATE TABLE daily_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  day date NOT NULL,
  summary text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

-- ───────────── Saúde: bloqueios, justificativas, intervenções, alertas ─────────────
CREATE TABLE blockers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  flow_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  reason_category text NOT NULL CHECK (reason_category IN ('aguardando_cliente','aguardando_terceiro','mudanca_prioridade','falta_capacidade','dificuldade_tecnica','falta_informacao','outro')),
  comment text,
  release_owner text,                          -- quem precisa liberar (pessoa/cliente/terceiro)
  expected_resolution date,
  link text,
  opened_by uuid REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  resolution text,
  is_demo boolean NOT NULL DEFAULT false
);

-- "Perguntar o motivo ao responsável"
CREATE TABLE justification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  flow_id uuid REFERENCES flow_instances(id) ON DELETE CASCADE,
  alert_key text,
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_to uuid NOT NULL REFERENCES users(id),
  question text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  reason_category text CHECK (reason_category IN ('aguardando_cliente','aguardando_terceiro','mudanca_prioridade','falta_capacidade','dificuldade_tecnica','falta_informacao','outro')),
  answer text,
  expected_resolution date,
  is_demo boolean NOT NULL DEFAULT false
);

CREATE TABLE manager_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('orientacao','correcao','encaminhamento','decisao','one_on_one')),
  text text NOT NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  blocker_id uuid REFERENCES blockers(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  subject_user_id uuid REFERENCES users(id),   -- one-on-one / correção com colaborador
  responsible_id uuid REFERENCES users(id),
  due_date date,
  resolved_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  threshold numeric(8,2)
);

CREATE TABLE alert_acks (
  alert_key text PRIMARY KEY,
  acknowledged_by uuid REFERENCES users(id),
  note text,
  snooze_until date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Relatórios, decisões e resultados ─────────────
CREATE TABLE client_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('semanal','mensal_trafego')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','revisado','compartilhado')),
  summary text,
  completed_items jsonb NOT NULL DEFAULT '[]'::jsonb,  -- itens selecionados (snapshot revisável)
  results_text text,
  diagnosis text,
  next_steps text,
  internal_notes text,                         -- nunca impresso
  created_by uuid REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  shared_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kpi_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id uuid NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
  report_id uuid REFERENCES client_reports(id) ON DELETE SET NULL,
  observed_on date NOT NULL,
  value numeric(14,2) NOT NULL,
  source text,
  note text,
  is_fictitious boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Diagnóstico → decisão → ação aprovada → resultado posterior
CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  report_id uuid REFERENCES client_reports(id) ON DELETE SET NULL,
  kpi_id uuid REFERENCES kpi_definitions(id) ON DELETE SET NULL,
  diagnosis text,
  proposal text NOT NULL,
  status text NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta','aprovada','recusada')),
  owner_id uuid REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  flow_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  result_note text,
  result_recorded_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

-- ───────────── Índices ─────────────
CREATE INDEX tasks_flow_idx ON tasks(flow_id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_client_idx ON tasks(client_id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_assignee_idx ON tasks(assignee_id, status) WHERE deleted_at IS NULL;
CREATE INDEX tasks_due_idx ON tasks(due_date) WHERE deleted_at IS NULL;
CREATE INDEX flows_client_idx ON flow_instances(client_id);
CREATE INDEX events_starts_idx ON calendar_events(starts_at);
CREATE INDEX opev_actor_idx ON operational_events(actor_id, occurred_at);
CREATE INDEX opev_client_idx ON operational_events(client_id, occurred_at);
CREATE INDEX opev_flow_idx ON operational_events(flow_id, occurred_at);
CREATE INDEX opev_task_idx ON operational_events(task_id, occurred_at);
CREATE INDEX blockers_open_idx ON blockers(task_id) WHERE resolved_at IS NULL;
CREATE INDEX manual_user_day_idx ON manual_activity_entries(user_id, occurred_on);
CREATE INDEX time_entries_user_idx ON time_entries(user_id, occurred_on);

-- ───────────── Dados de configuração iniciais (não são dados de demonstração) ─────────────
INSERT INTO alert_rules (key, name, description, enabled, threshold) VALUES
 ('atraso', 'Prazo vencido', 'Tarefa com prazo expirado, não concluída, sem espera planejada nem bloqueio registrado.', true, 0),
 ('inatividade', 'Fluxo sem movimentação relevante', 'Fluxo ativo com etapa que já deveria estar em execução e sem movimentação relevante há N dias úteis. Ignora espera planejada, bloqueio registrado e prazos futuros.', true, 2),
 ('bloqueio', 'Bloqueio aberto', 'Tarefa bloqueada com motivo registrado. Fica crítico após N dias corridos ou quando a previsão de solução vence.', true, 3),
 ('sobrecarga', 'Capacidade acima do planejado', 'Horas estimadas de tarefas abertas com prazo nos próximos 7 dias acima de N% da capacidade semanal definida.', true, 100),
 ('sem_estimativa', 'Fluxo sem estimativas', 'Tarefas da base planejada sem horas estimadas: progresso ponderado indisponível.', true, NULL),
 ('sem_responsavel', 'Tarefa sem responsável', 'Tarefa aberta com prazo nos próximos N dias e sem responsável.', true, 7),
 ('justificativa_pendente', 'Pedido de justificativa sem resposta', 'Pedido de motivo enviado ao responsável e ainda não respondido.', true, NULL),
 ('decisao_pendente', 'Decisão aguardando', 'Decisão proposta (relatório/oportunidade) aguardando aprovação há mais de N dias.', true, 5);

INSERT INTO settings (key, value) VALUES ('workspace', '{"name":"Agência Eleven"}');
