// Dados de DEMONSTRAÇÃO (is_demo = true em tudo). Cenários A–D da especificação.
// Nada aqui representa situação real da agência: status, horas, quantidades e KPIs são fictícios e rotulados.
// Uso: npm run db:seed-demo            (cria se ainda não existir)
//      npm run db:seed-demo -- --reset  (remove a demo anterior e recria)
import { sql } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth-core";
import { localToInstant, addDays } from "../src/lib/dates";
import { migrate } from "./migrate";
import { removeDemoData } from "../src/lib/services/demo";
export { removeDemoData };

export const DEMO_PASSWORD = "eleven-demo";

type Ctx = { users: Record<string, string>; ws: string };

async function ensureWorkspace() {
  const [w] = await sql<{ id: string }[]>`SELECT id FROM workspaces ORDER BY created_at LIMIT 1`;
  if (w) return w.id;
  const [n] = await sql<{ id: string }[]>`INSERT INTO workspaces (name) VALUES ('Agência Eleven') RETURNING id`;
  return n.id;
}

const at = (date: string, time = "10:00") => localToInstant(date, time);

export async function seedDemo({ reset = false } = {}) {
  await migrate(false);
  const [exists] = await sql`SELECT 1 FROM clients WHERE is_demo LIMIT 1`;
  if (exists && !reset) {
    console.log("Dados de demonstração já existem. Use --reset para recriar.");
    return;
  }
  if (reset) await removeDemoData();
  const ws = await ensureWorkspace();
  const pw = await hashPassword(DEMO_PASSWORD);

  // ───────── Pessoas (nomes do levantamento usados como EXEMPLO editável) ─────────
  const people: [string, string, string, string, number | null][] = [
    ["direcao", "Direção (demo)", "admin", "Diretor(a)", null],
    ["diego", "Diego (demo)", "lider", "Líder Panth", 30],
    ["itala", "Ítala (demo)", "colaborador", "Social media", 40],
    ["pedro", "Pedro (demo)", "lider", "Líder Hornets", 30],
    ["william", "William (demo)", "colaborador", "Tráfego", 40],
    ["victoria", "Victória (demo)", "lider", "Líder Fox", 30],
    ["tarcisio", "Tarcísio (demo)", "colaborador", "Produção / social media", 40],
    ["lucas", "Lucas (demo)", "colaborador", "Editor de vídeo", 40],
  ];
  const ctx: Ctx = { users: {}, ws };
  for (const [key, name, role, title, cap] of people) {
    const email = `${key}@eleven.demo`;
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (workspace_id, name, email, password_hash, role, job_title, weekly_capacity_hours, is_demo, active)
      VALUES (${ws}, ${name}, ${email}, ${pw}, ${role}, ${title}, ${cap}, true, true)
      ON CONFLICT (email) DO UPDATE SET active = true, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, name = EXCLUDED.name, weekly_capacity_hours = EXCLUDED.weekly_capacity_hours
      RETURNING id`;
    ctx.users[key] = u.id;
  }
  const U = ctx.users;

  // ───────── Squads (alocação cruzada: Lucas em Panth e Fox) ─────────
  const squad = async (name: string, color: string, leader: string | null, members: string[]) => {
    const [s] = await sql<{ id: string }[]>`INSERT INTO squads (name, color, leader_id, is_demo) VALUES (${name}, ${color}, ${leader ? U[leader] : null}, true) RETURNING id`;
    for (const m of members) await sql`INSERT INTO squad_members (squad_id, user_id) VALUES (${s.id}, ${U[m]})`;
    return s.id;
  };
  const panth = await squad("Panth", "#7c3aed", "diego", ["diego", "itala", "lucas"]);
  const hornets = await squad("Hornets", "#d97706", "pedro", ["pedro", "william"]);
  const fox = await squad("Fox", "#ea580c", "victoria", ["victoria", "tarcisio", "lucas"]);
  await squad("LK", "#0891b2", null, []);

  // ───────── Helpers ─────────
  const ev = async (e: { actor: string | null; at: Date; type: string; entity?: string | null; client?: string | null; flow?: string | null; task?: string | null; action: string; summary: string; reason?: string | null; relevant?: boolean }) =>
    sql`INSERT INTO operational_events (actor_id, recorded_at, occurred_at, entity_type, entity_id, client_id, flow_id, task_id, action, summary, reason, is_relevant, is_demo)
        VALUES (${e.actor ? U[e.actor] : null}, ${e.at}, ${e.at}, ${e.type}, ${e.entity ?? null}, ${e.client ?? null}, ${e.flow ?? null}, ${e.task ?? null}, ${e.action}, ${e.summary}, ${e.reason ?? null}, ${e.relevant ?? true}, true)`;

  const client = async (name: string, segment: string, squads: string[], opts: { internal?: boolean; status?: string; notes?: string } = {}) => {
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO clients (name, status, segment, is_internal, is_demo, internal_notes, created_at) VALUES (${name}, ${opts.status ?? "ativo"}, ${segment}, ${!!opts.internal}, true, ${opts.notes ?? null}, ${at("2026-09-01")}) RETURNING id`;
    for (const s of squads) await sql`INSERT INTO client_squads (client_id, squad_id) VALUES (${c.id}, ${s})`;
    await ev({ actor: "direcao", at: at("2026-09-01", "09:00"), type: "client", entity: c.id, client: c.id, action: "criou", summary: `Cadastrou o cliente “${name}” (demonstração)`, relevant: false });
    return c.id;
  };

  const flow = async (f: { client: string; name: string; lifecycle: string; status?: string; owner: string; start: string; due?: string | null; ref?: string | null; cycle?: string | null; service?: string | null; template?: string | null; plan?: string | null; parent?: string | null; objective?: string | null; created?: string }) => {
    const [r] = await sql<{ id: string }[]>`
      INSERT INTO flow_instances (client_id, service_id, template_id, quarterly_plan_id, parent_flow_id, name, lifecycle, cycle_label, reference_date, start_date, due_date, status, owner_id, objective, is_demo, created_by, created_at)
      VALUES (${f.client}, ${f.service ?? null}, ${f.template ?? null}, ${f.plan ?? null}, ${f.parent ?? null}, ${f.name}, ${f.lifecycle}, ${f.cycle ?? null}, ${f.ref ?? null}, ${f.start}, ${f.due ?? null},
              ${f.status ?? "ativo"}, ${U[f.owner]}, ${f.objective ?? null}, true, ${U[f.owner]}, ${at(f.created ?? f.start, "09:00")}) RETURNING id`;
    await ev({ actor: f.owner, at: at(f.created ?? f.start, "09:00"), type: "flow", entity: r.id, client: f.client, flow: r.id, action: "criou", summary: `Criou “${f.name}” (demonstração)` });
    return r.id;
  };

  type T = { flow?: string | null; client: string | null; title: string; stage?: string; who?: string | null; due?: string | null; start?: string | null; est?: number | null; status?: string; doneOn?: string; extra?: boolean; baseline?: boolean; content?: string | null; parent?: string | null; priority?: string; waitingUntil?: string; waitingReason?: string; createdOn?: string };
  let pos = 0;
  const task = async (t: T) => {
    pos++;
    const done = t.status === "concluida";
    const [r] = await sql<{ id: string }[]>`
      INSERT INTO tasks (client_id, flow_id, parent_task_id, content_id, title, stage, position, assignee_id, status, priority, start_date, due_date, est_hours, in_baseline, is_extra,
                         scope_class, waiting_until, waiting_reason, completed_at, completed_recorded_at, origin, is_demo, created_by, created_at, last_activity_at)
      VALUES (${t.client}, ${t.flow ?? null}, ${t.parent ?? null}, ${t.content ?? null}, ${t.title}, ${t.stage ?? null}, ${pos}, ${t.who ? U[t.who] : null}, ${t.status ?? "a_fazer"}, ${t.priority ?? "normal"},
              ${t.start ?? null}, ${t.due ?? null}, ${t.est ?? null}, ${t.baseline ?? !t.extra}, ${!!t.extra}, ${t.extra ? "avaliar_escopo" : null}, ${t.waitingUntil ?? null}, ${t.waitingReason ?? null},
              ${done ? at(t.doneOn!, "16:00") : null}, ${done ? at(t.doneOn!, "16:05") : null}, ${t.flow ? "modelo" : "manual"}, true, ${t.who ? U[t.who] : U.direcao},
              ${at(t.createdOn ?? "2026-09-25", "09:00")}, ${at(t.doneOn ?? t.createdOn ?? "2026-09-25", "16:00")})
      RETURNING id`;
    if (t.status === "em_andamento" || done) await ev({ actor: t.who ?? "direcao", at: at(t.start ?? t.doneOn ?? "2026-10-01", "10:00"), type: "task", entity: r.id, client: t.client, flow: t.flow, task: r.id, action: "status:em_andamento", summary: `Começou “${t.title}”` });
    if (done) await ev({ actor: t.who ?? "direcao", at: at(t.doneOn!, "16:00"), type: "task", entity: r.id, client: t.client, flow: t.flow, task: r.id, action: "status:concluida", summary: `Concluiu “${t.title}”` });
    return r.id;
  };

  // ───────── Biblioteca de fluxos (modelos editáveis; horas = estimativas de EXEMPLO) ─────────
  const template = async (name: string, lifecycle: string, description: string, steps: [string, string, number | null, number | null][]) => {
    const [t] = await sql<{ id: string }[]>`INSERT INTO flow_templates (name, lifecycle, description, is_demo) VALUES (${name}, ${lifecycle}, ${description}, true) RETURNING id`;
    let i = 0;
    for (const [stage, step, hours, offset] of steps) {
      await sql`INSERT INTO flow_template_steps (template_id, position, stage, name, est_hours, offset_days) VALUES (${t.id}, ${++i}, ${stage}, ${step}, ${hours}, ${offset})`;
    }
    return t.id;
  };
  const tplCiclo = await template("Ciclo de captação de conteúdo", "ciclico", "Do agendamento da produção ao envio do calendário. Prazos relativos à data da captação (dia 0). Horas de exemplo.", [
    ["Planejamento", "Marcação de produção", 0.5, -11],
    ["Roteiro", "Criação de roteiro", 3, -8],
    ["Roteiro", "Confirmação da produção com o cliente", 0.5, -7],
    ["Roteiro", "Envio de roteiro ao cliente", 0.5, -5],
    ["Pré-produção", "Solicitação de capa", 0.5, -3],
    ["Produção", "Captação", 4, 0],
    ["Pós-produção", "Planilha, formulário e repasse do material", 1, 0],
    ["Pós-produção", "Montagem do calendário", 1, 0],
    ["Pós-produção", "Envio do calendário ao cliente", 0.5, 1],
  ]);
  const tplFunil = await template("Implantação de funil de aquisição", "implantacao", "Implantação finita: termina quando os critérios de aceite são cumpridos; depois segue acompanhamento.", [
    ["Estratégia", "Mapa da estratégia do funil", 4, 0],
    ["Estratégia", "Perguntas de qualificação", 2, 3],
    ["Criação", "Criativos do funil", 6, 10],
    ["Configuração", "Configuração da campanha e do canal", 4, 20],
    ["Validação", "Revisão com o cliente", 1, 30],
    ["Validação", "Go-live e checagem de rastreamento", 2, 38],
  ]);
  await template("Relatório mensal de tráfego", "continuo", "Marco mensal: dados → diagnóstico → decisão → ação aprovada.", [
    ["Análise", "Coleta de dados e KPIs do mês", 2, 0],
    ["Análise", "Diagnóstico e recomendações", 2, 2],
    ["Entrega", "Reunião de resultados com o cliente", 1, 5],
  ]);
  await template("Onboarding de cliente", "implantacao", "Acessos, briefing, arquivos e reuniões iniciais (feito uma única vez).", [
    ["Acessos", "Coletar acessos (redes, gerenciador de anúncios, Google)", 1, 0],
    ["Briefing", "Reunião de briefing", 1.5, 2],
    ["Briefing", "Organizar arquivos e identidade visual", 1, 4],
    ["Bússola", "Diagnóstico e Bússola estratégica", 6, 10],
    ["Aceite", "Apresentação e aceite da Bússola", 1, 14],
  ]);

  // ═════════ CENÁRIO A — JCont (Bússola real fornecida; operação fictícia) ═════════
  const jcont = await client("JCont Contabilidade", "Contabilidade", [hornets], { notes: "Nota interna de exemplo — não aparece em relatórios de cliente." });
  const [ctrJ] = await sql<{ id: string }[]>`
    INSERT INTO contracts (client_id, title, status, start_date, owner_id, handoff_notes, handoff_accepted_by, handoff_accepted_at, is_demo)
    VALUES (${jcont}, 'Contrato demonstrativo (fictício)', 'vigente', '2026-09-01', ${U.direcao}, 'Escopo FICTÍCIO para demonstração: conteúdo + tráfego.', ${U.pedro}, ${at("2026-09-02")}, true) RETURNING id`;
  const [svJConteudo] = await sql<{ id: string }[]>`INSERT INTO services (client_id, contract_id, name, kind, start_date, is_demo) VALUES (${jcont}, ${ctrJ.id}, 'Conteúdo e social media', 'conteudo', '2026-09-01', true) RETURNING id`;
  const [svJTrafego] = await sql<{ id: string }[]>`INSERT INTO services (client_id, contract_id, name, kind, start_date, is_demo) VALUES (${jcont}, ${ctrJ.id}, 'Gestão de tráfego pago', 'trafego', '2026-09-01', true) RETURNING id`;
  const [dlJVideos] = await sql<{ id: string }[]>`INSERT INTO deliverables (client_id, service_id, contract_id, name, quantity, unit, periodicity, acceptance_criteria, start_date, is_demo) VALUES (${jcont}, ${svJConteudo.id}, ${ctrJ.id}, 'Vídeos curtos (quantidade fictícia)', 8, 'vídeos', 'mensal', 'Vídeo aprovado pelo cliente e publicado', '2026-09-01', true) RETURNING id`;
  const [dlJRel] = await sql<{ id: string }[]>`INSERT INTO deliverables (client_id, service_id, contract_id, name, quantity, unit, periodicity, acceptance_criteria, start_date, is_demo) VALUES (${jcont}, ${svJTrafego.id}, ${ctrJ.id}, 'Relatório mensal de tráfego', 1, 'relatório', 'mensal', 'KPIs + diagnóstico + decisões apresentados ao cliente', '2026-09-01', true) RETURNING id`;
  const [dlJFunil] = await sql<{ id: string }[]>`INSERT INTO deliverables (client_id, service_id, contract_id, name, quantity, unit, periodicity, acceptance_criteria, start_date, is_demo) VALUES (${jcont}, ${svJTrafego.id}, ${ctrJ.id}, 'Implantação de funil de aquisição B2B', 1, 'funil', 'unico', 'Funil publicado, rastreamento validado e aceite do cliente', '2026-10-01', true) RETURNING id`;

  const [cmp] = await sql<{ id: string }[]>`
    INSERT INTO strategic_compasses (client_id, version, status, diagnosis, audience, positioning, guidelines, hypotheses, created_by, is_demo)
    VALUES (${jcont}, 1, 'vigente',
      'Referência estratégica fornecida pela Eleven. Situação operacional e números deste cliente na demonstração são fictícios.',
      'Empresários e gestores que buscam contabilidade estratégica; possível vertical de supermercados (hipótese).',
      'Referência em contabilidade estratégica, moderna e acessível; João Paulo como contador de excelência.',
      'Linguagem simples, segurança, proximidade, conteúdos para empresários; evitar viralização irrelevante.',
      'Vertical “JCont para Supermercados” é hipótese a validar — não é projeto aprovado.',
      ${U.pedro}, true) RETURNING id`;
  const obj = async (code: string, title: string, desc: string, fronts: string[]) => {
    const [o] = await sql<{ id: string }[]>`INSERT INTO strategic_objectives (compass_id, code, title, description, position) VALUES (${cmp.id}, ${code}, ${title}, ${desc}, ${code === "A" ? 1 : 2}) RETURNING id`;
    let i = 0;
    for (const f of fronts) await sql`INSERT INTO strategic_fronts (objective_id, title, position) VALUES (${o.id}, ${f}, ${++i})`;
    return o.id;
  };
  const objA = await obj("A", "Posicionamento e autoridade", "Posicionar a JCont como referência em contabilidade estratégica, moderna e acessível, fortalecendo autoridade, confiança na estrutura e a imagem de João Paulo.", [
    "Comunicação clara e didática de João Paulo",
    "Mostrar estrutura, equipe, processos, tecnologia e atendimento",
    "Construir audiência de 10 mil seguidores qualificados (prazo e linha de base a definir)",
  ]);
  const objB = await obj("B", "Aquisição B2B", "Captar empresas para a base, incluindo oportunidade de vertical de supermercados.", [
    "Caminho 1: WhatsApp direto (conversa imediata)",
    "Caminho 2: Formulário nativo com qualificação (filtragem de perfil)",
    "Caminho 3: Site com formulário (contexto institucional e conversão)",
  ]);
  await sql`INSERT INTO kpi_definitions (client_id, objective_id, name, unit, baseline, target, deadline, source, reliability, is_fictitious) VALUES
    (${jcont}, ${objA}, 'Seguidores qualificados', 'seguidores', NULL, 10000, NULL, 'Instagram (a definir critério de “qualificado”)', 'a definir', false)`;
  const [kpiCpl] = await sql<{ id: string }[]>`INSERT INTO kpi_definitions (client_id, objective_id, name, unit, baseline, target, deadline, source, reliability, is_fictitious) VALUES
    (${jcont}, ${objB}, 'CPL — custo por lead (FICTÍCIO)', 'R$', 48, 35, '2026-12-31', 'Gerenciador de anúncios (exemplo)', 'demonstração', true) RETURNING id`;
  for (const [title, status, objective] of [
    ["Lives com João Paulo", "proposta", objA], ["Podcast", "avaliando", objA], ["UGC por setor", "proposta", objA],
    ["Criativos orgânicos validados para tráfego", "proposta", objB], ["Vertical “JCont para Supermercados”", "avaliando", objB], ["Relatório bimestral como possibilidade do plano", "proposta", objA],
  ] as const) {
    await sql`INSERT INTO strategic_opportunities (client_id, objective_id, title, status, origin, is_demo) VALUES (${jcont}, ${objective}, ${title}, ${status}, 'Bússola', true)`;
  }
  const [planJ] = await sql<{ id: string }[]>`
    INSERT INTO quarterly_plans (client_id, compass_id, label, start_date, end_date, status, month1_focus, month2_focus, month3_focus, is_demo)
    VALUES (${jcont}, ${cmp.id}, '4º trimestre 2026 (exemplo)', '2026-10-01', '2026-12-31', 'vigente',
      'Estruturar funil WhatsApp direto e linha editorial de autoridade.', 'Validar funil e testar formulário nativo com qualificação.', 'Consolidar aprendizados e preparar o próximo trimestre.', true) RETURNING id`;
  const initiative = async (title: string, kind: string, month: number, status: string, scope: string | null, objs: string[], note?: string) => {
    const [i] = await sql<{ id: string }[]>`INSERT INTO initiatives (plan_id, client_id, title, kind, month_index, status, scope_check, conditional_note, is_demo) VALUES (${planJ.id}, ${jcont}, ${title}, ${kind}, ${month}, ${status}, ${scope}, ${note ?? null}, true) RETURNING id`;
    for (const o of objs) await sql`INSERT INTO initiative_objectives (initiative_id, objective_id) VALUES (${i.id}, ${o})`;
    return i.id;
  };
  const iniWhats = await initiative("Implantar funil WhatsApp direto", "projeto", 1, "em_execucao", "dentro_do_escopo", [objB]);
  await initiative("Formulário nativo com qualificação", "projeto", 2, "proposta", null, [objB]);
  await initiative("Site com formulário", "projeto", 3, "proposta", "avaliar_escopo", [objB, objA]);
  await initiative("Ação temática em data relevante da contabilidade", "sazonal", 2, "proposta", null, [objA], "Condicional: confirmar data e pertinência antes de aprovar (não há data informada).");

  // Implantação que atravessa outubro → novembro (Cenário D também usa a ideia de não zerar)
  const fFunil = await flow({ client: jcont, name: "Implantação — Funil WhatsApp direto", lifecycle: "implantacao", owner: "pedro", start: "2026-10-01", due: "2026-11-13", service: svJTrafego.id, template: tplFunil, plan: planJ.id, objective: "Caminho 1 do objetivo B (aquisição B2B)", created: "2026-10-01" });
  await sql`UPDATE initiatives SET flow_id = ${fFunil} WHERE id = ${iniWhats}`;
  await sql`INSERT INTO flow_deliverables (flow_id, deliverable_id) VALUES (${fFunil}, ${dlJFunil.id})`;
  await task({ flow: fFunil, client: jcont, title: "Mapa da estratégia do funil", stage: "Estratégia", who: "pedro", due: "2026-10-01", est: 4, status: "concluida", doneOn: "2026-10-01", createdOn: "2026-10-01" });
  await task({ flow: fFunil, client: jcont, title: "Perguntas de qualificação", stage: "Estratégia", who: "william", due: "2026-10-05", est: 2, status: "concluida", doneOn: "2026-10-05", createdOn: "2026-10-01" });
  const tCriativos = await task({ flow: fFunil, client: jcont, title: "Criativos do funil", stage: "Criação", who: "william", start: "2026-10-05", due: "2026-10-12", est: 6, status: "em_andamento", createdOn: "2026-10-01" });
  const tAprov = await task({ flow: fFunil, client: jcont, title: "Aprovação dos criativos pelo cliente", stage: "Criação", who: "william", due: "2026-10-07", est: 1, status: "bloqueada", createdOn: "2026-10-01" });
  await task({ flow: fFunil, client: jcont, title: "Configuração da campanha e do canal", stage: "Configuração", who: "william", due: "2026-10-21", est: 4, createdOn: "2026-10-01" });
  await task({ flow: fFunil, client: jcont, title: "Revisão com o cliente", stage: "Validação", who: "pedro", due: "2026-10-31", est: 1, createdOn: "2026-10-01" });
  await task({ flow: fFunil, client: jcont, title: "Go-live e checagem de rastreamento", stage: "Validação", who: "william", due: "2026-11-09", est: 2, createdOn: "2026-10-01" });
  const [blk] = await sql<{ id: string }[]>`
    INSERT INTO blockers (task_id, client_id, flow_id, reason_category, comment, release_owner, expected_resolution, opened_by, opened_at, is_demo)
    VALUES (${tAprov}, ${jcont}, ${fFunil}, 'aguardando_cliente', 'Cliente ainda não aprovou as peças enviadas em 05/10 (exemplo).', 'Cliente (João Paulo)', '2026-10-09', ${U.william}, ${at("2026-10-05", "17:00")}, true) RETURNING id`;
  await ev({ actor: "william", at: at("2026-10-05", "17:00"), type: "task", entity: tAprov, client: jcont, flow: fFunil, task: tAprov, action: "bloqueou", summary: "Bloqueou “Aprovação dos criativos pelo cliente” — Aguardando cliente", reason: "Cliente ainda não aprovou as peças enviadas em 05/10 (exemplo)." });
  await ev({ actor: "william", at: at("2026-10-06", "15:00"), type: "task", entity: tCriativos, client: jcont, flow: fFunil, task: tCriativos, action: "evidencia", summary: "Anexou evidência em “Criativos do funil”" });
  void blk;
  await sql`INSERT INTO time_entries (user_id, task_id, client_id, hours, occurred_on, note, is_demo) SELECT ${U.pedro}, id, ${jcont}, 5, '2026-10-01', 'Apontamento fictício', true FROM tasks WHERE flow_id = ${fFunil} AND title = 'Mapa da estratégia do funil'`;
  await sql`INSERT INTO time_entries (user_id, task_id, client_id, hours, occurred_on, note, is_demo) VALUES (${U.william}, ${tCriativos}, ${jcont}, 3.5, '2026-10-06', 'Apontamento fictício', true)`;

  // Linha editorial SEM estimativas → progresso ponderado indisponível; e sem movimentação → alerta de inatividade
  const fEditorial = await flow({ client: jcont, name: "Linha editorial e roteiros — outubro/2026", lifecycle: "ciclico", cycle: "Outubro/2026", owner: "pedro", start: "2026-10-01", due: "2026-10-31", service: svJConteudo.id, created: "2026-10-01" });
  await sql`INSERT INTO flow_deliverables (flow_id, deliverable_id) VALUES (${fEditorial}, ${dlJVideos.id})`;
  await task({ flow: fEditorial, client: jcont, title: "Pesquisa de referências (mitos/verdades, dúvidas)", stage: "Pesquisa", who: "william", start: "2026-10-02", due: "2026-10-06", createdOn: "2026-10-01" });
  await task({ flow: fEditorial, client: jcont, title: "Roteiros: fala direta de João Paulo (lote 1)", stage: "Roteiro", who: "pedro", due: "2026-10-14", createdOn: "2026-10-01" });
  await task({ flow: fEditorial, client: jcont, title: "Roteiros: bastidores da estrutura e equipe", stage: "Roteiro", who: "pedro", due: "2026-10-21", createdOn: "2026-10-01" });

  // Acompanhamento de tráfego (operação contínua) + relatório mensal ligado a KPI e decisão
  const fTraf = await flow({ client: jcont, name: "Gestão de tráfego — acompanhamento outubro/2026", lifecycle: "continuo", cycle: "Outubro/2026", owner: "william", start: "2026-10-01", due: "2026-11-05", service: svJTrafego.id, created: "2026-10-01" });
  await sql`INSERT INTO flow_deliverables (flow_id, deliverable_id) VALUES (${fTraf}, ${dlJRel.id})`;
  await task({ flow: fTraf, client: jcont, title: "Análise semanal de campanhas (semana 1)", stage: "Monitoramento", who: "william", due: "2026-10-02", est: 1, status: "concluida", doneOn: "2026-10-02", createdOn: "2026-10-01" });
  await task({ flow: fTraf, client: jcont, title: "Análise semanal de campanhas (semana 2)", stage: "Monitoramento", who: "william", due: "2026-10-09", est: 1, createdOn: "2026-10-01" });
  await task({ flow: fTraf, client: jcont, title: "Relatório mensal de tráfego — outubro", stage: "Relatório", who: "william", due: "2026-11-05", est: 3, createdOn: "2026-10-01" });
  const [rep] = await sql<{ id: string }[]>`
    INSERT INTO client_reports (client_id, kind, period_start, period_end, title, status, summary, diagnosis, created_by, is_demo)
    VALUES (${jcont}, 'mensal_trafego', '2026-09-01', '2026-09-30', 'Relatório mensal de tráfego — JCont — setembro/2026 (DEMONSTRAÇÃO)', 'revisado',
      'Exemplo de relatório mensal com KPI fictício.', 'CPL acima da meta fictícia; criativos institucionais com baixa taxa de clique (exemplo).', ${U.william}, true) RETURNING id`;
  await sql`INSERT INTO kpi_observations (kpi_id, report_id, observed_on, value, source, note, is_fictitious) VALUES (${kpiCpl.id}, ${rep.id}, '2026-09-30', 52.4, 'Exemplo', 'Valor fictício', true)`;
  await sql`INSERT INTO decisions (client_id, report_id, kpi_id, diagnosis, proposal, status, owner_id, is_demo, created_at)
            VALUES (${jcont}, ${rep.id}, ${kpiCpl.id}, 'Criativos institucionais com baixa taxa de clique (exemplo).', 'Testar criativo no formato “dúvidas frequentes” contra o institucional', 'proposta', ${U.william}, true, ${at("2026-10-02")})`;

  // ═════════ CENÁRIO B — Ótica Santana (dois ciclos independentes em outubro/2026) ═════════
  const otica = await client("Ótica Santana", "Varejo óptico", [fox]);
  const [ctrO] = await sql<{ id: string }[]>`INSERT INTO contracts (client_id, title, status, start_date, owner_id, is_demo) VALUES (${otica}, 'Contrato demonstrativo (fictício)', 'vigente', '2026-08-01', ${U.direcao}, true) RETURNING id`;
  const [svO] = await sql<{ id: string }[]>`INSERT INTO services (client_id, contract_id, name, kind, start_date, is_demo) VALUES (${otica}, ${ctrO.id}, 'Produção de conteúdo audiovisual', 'audiovisual', '2026-08-01', true) RETURNING id`;
  const [dlCiclos] = await sql<{ id: string }[]>`INSERT INTO deliverables (client_id, service_id, contract_id, name, quantity, unit, periodicity, acceptance_criteria, start_date, is_demo) VALUES (${otica}, ${svO.id}, ${ctrO.id}, 'Ciclos de captação (quantidade fictícia)', 2, 'ciclos', 'mensal', 'Captação realizada e calendário enviado ao cliente', '2026-08-01', true) RETURNING id`;
  const [dlVideosO] = await sql<{ id: string }[]>`INSERT INTO deliverables (client_id, service_id, contract_id, name, quantity, unit, periodicity, acceptance_criteria, start_date, is_demo) VALUES (${otica}, ${svO.id}, ${ctrO.id}, 'Vídeos editados e publicados (quantidade fictícia)', 8, 'vídeos', 'mensal', 'Publicado no perfil após aprovação', '2026-08-01', true) RETURNING id`;

  const steps = await sql<{ id: string; stage: string; name: string; est_hours: number; offset_days: number }[]>`SELECT id, stage, name, est_hours, offset_days FROM flow_template_steps WHERE template_id = ${tplCiclo} ORDER BY position`;
  const owners: Record<string, string> = {
    "Marcação de produção": "tarcisio", "Criação de roteiro": "victoria", "Confirmação da produção com o cliente": "tarcisio", "Envio de roteiro ao cliente": "tarcisio",
    "Solicitação de capa": "tarcisio", Captação: "victoria", "Planilha, formulário e repasse do material": "tarcisio", "Montagem do calendário": "tarcisio", "Envio do calendário ao cliente": "tarcisio",
  };
  const cycle = async (refDate: string, label: string, opts: { doneBefore?: string; status?: string; created: string }) => {
    const id = await flow({ client: otica, name: `Ciclo de captação — ${label}`, lifecycle: "ciclico", cycle: label, ref: refDate, owner: "victoria", start: addDays(refDate, -11), due: addDays(refDate, 1), service: svO.id, template: tplCiclo, status: opts.status, created: opts.created });
    await sql`INSERT INTO flow_deliverables (flow_id, deliverable_id) VALUES (${id}, ${dlCiclos.id}), (${id}, ${dlVideosO.id})`;
    const ids: Record<string, string> = {};
    for (const s of steps) {
      const due = addDays(refDate, s.offset_days);
      const done = opts.doneBefore && due < opts.doneBefore;
      ids[s.name] = await task({ flow: id, client: otica, title: s.name, stage: s.stage, who: owners[s.name], due, est: s.est_hours, status: done ? "concluida" : "a_fazer", doneOn: done ? due : undefined, createdOn: opts.created });
      await sql`UPDATE tasks SET template_step_id = ${s.id} WHERE id = ${ids[s.name]}`;
    }
    return { id, ids };
  };

    // Ciclo de setembro: captação e calendário feitos; pós-produção (edição/publicação) ainda em curso
  const cSet = await cycle("2026-09-22", "22/09/2026", { doneBefore: "2026-09-30", created: "2026-09-10" });
  const content = async (flowId: string, title: string, state: string, opts: { edited?: string; published?: string; editDone?: string; pubDone?: string; editDue?: string; pubDue?: string; inBaseline?: boolean } = {}) => {
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO content_assets (client_id, flow_id, deliverable_id, title, kind, editorial_state, approval_state, edited_at, approved_at, published_at, is_demo)
      VALUES (${otica}, ${flowId}, ${dlVideosO.id}, ${title}, 'video', ${state}, ${state === "postada" ? "aprovado" : "pendente"}, ${opts.edited ? at(opts.edited, "15:00") : null},
              ${opts.published ? at(opts.published, "10:00") : null}, ${opts.published ? at(opts.published, "11:00") : null}, true) RETURNING id`;
    const edit = await task({ flow: flowId, client: otica, title: `EDIÇÃO — ${title}`, stage: "Edição", who: "lucas", due: opts.editDue ?? opts.editDone ?? null, est: 2, status: opts.editDone ? "concluida" : "a_fazer", doneOn: opts.editDone, content: c.id, baseline: opts.inBaseline ?? true, createdOn: "2026-09-23" });
    await task({ flow: flowId, client: otica, title: `PUBLICAÇÃO — ${title}`, stage: "Publicação", who: "tarcisio", due: opts.pubDue ?? opts.pubDone ?? null, est: 0.5, status: opts.pubDone ? "concluida" : "a_fazer", doneOn: opts.pubDone, content: c.id, parent: edit, baseline: opts.inBaseline ?? true, createdOn: "2026-09-23" });
    return c.id;
  };
  await content(cSet.id, "Como escolher a armação ideal", "postada", { edited: "2026-09-26", published: "2026-09-30", editDone: "2026-09-26", pubDone: "2026-09-30" });
  await content(cSet.id, "Lentes multifocais: mitos e verdades", "aprovacao", { edited: "2026-10-02", editDone: "2026-10-02", pubDue: "2026-10-09" });
  await content(cSet.id, "Bastidores da ótica", "edicao", { editDue: "2026-10-09", pubDue: "2026-10-13" });

  // Ciclo 09/10 — em andamento (captação amanhã; produção marcada na agenda)
  const c09 = await cycle("2026-10-09", "09/10/2026", { doneBefore: "2026-10-07", created: "2026-09-26" });
  // Solicitação de capa (06/10) ainda pendente → atraso real demonstrativo
  await sql`UPDATE tasks SET status = 'a_fazer', completed_at = NULL, completed_recorded_at = NULL WHERE id = ${c09.ids["Solicitação de capa"]}`;
  await sql`DELETE FROM operational_events WHERE task_id = ${c09.ids["Solicitação de capa"]} AND action IN ('status:concluida','status:em_andamento')`;

  // Ciclo 19/10 — recém-criado (marcação de produção vence hoje 08/10)
  const c19 = await cycle("2026-10-19", "19/10/2026", { created: "2026-10-06" });
  await sql`UPDATE flow_instances SET status = 'ativo' WHERE id = ${c19.id}`;

  const prod = async (title: string, date: string, time: string, end: string, flowId: string, taskId: string, participants: string[]) => {
    const [e] = await sql<{ id: string }[]>`
      INSERT INTO calendar_events (kind, title, client_id, flow_id, task_id, squad_id, starts_at, ends_at, location, is_demo, created_by)
      VALUES ('producao', ${title}, ${otica}, ${flowId}, ${taskId}, ${fox}, ${at(date, time)}, ${at(date, end)}, 'Loja (exemplo)', true, ${U.victoria}) RETURNING id`;
    for (const p of participants) await sql`INSERT INTO event_participants (event_id, user_id) VALUES (${e.id}, ${U[p]})`;
  };
  await prod("Captação Ótica Santana — ciclo 09/10", "2026-10-09", "14:00", "17:00", c09.id, c09.ids["Captação"], ["victoria", "tarcisio", "lucas"]);
  await prod("Captação Ótica Santana — ciclo 19/10", "2026-10-19", "14:30", "17:30", c19.id, c19.ids["Captação"], ["victoria", "tarcisio"]);

  // ═════════ CENÁRIO D — Miro Móveis (implantação que cruza setembro → outubro) ═════════
  const miro = await client("Miro Móveis", "Móveis planejados", [panth]);
  const [svM] = await sql<{ id: string }[]>`INSERT INTO services (client_id, name, kind, start_date, is_demo) VALUES (${miro}, 'Estruturação e gestão de perfil', 'conteudo', '2026-09-15', true) RETURNING id`;
  const [dlM] = await sql<{ id: string }[]>`INSERT INTO deliverables (client_id, service_id, name, quantity, unit, periodicity, acceptance_criteria, start_date, is_demo) VALUES (${miro}, ${svM.id}, 'Reestruturação inicial do perfil', 1, 'implantação', 'unico', 'Perfil reestruturado e aprovado pelo cliente', '2026-09-15', true) RETURNING id`;
  const fMiro = await flow({ client: miro, name: "Fluxo 1 — Estruturação da base", lifecycle: "implantacao", owner: "diego", start: "2026-09-15", due: "2026-10-16", service: svM.id, created: "2026-09-15" });
  await sql`INSERT INTO flow_deliverables (flow_id, deliverable_id) VALUES (${fMiro}, ${dlM.id})`;
  await task({ flow: fMiro, client: miro, title: "1.1 Reestruturação do perfil", stage: "Perfil", who: "itala", due: "2026-09-19", est: 3, status: "concluida", doneOn: "2026-09-19", createdOn: "2026-09-15" });
  await task({ flow: fMiro, client: miro, title: "1.2 Destaques e capas", stage: "Perfil", who: "itala", due: "2026-09-26", est: 2, status: "concluida", doneOn: "2026-09-25", createdOn: "2026-09-15" });
  await task({ flow: fMiro, client: miro, title: "1.3 Bio, links e Google Maps", stage: "Canais", who: "itala", due: "2026-10-02", est: 1.5, status: "concluida", doneOn: "2026-10-02", createdOn: "2026-09-15" });
  await task({ flow: fMiro, client: miro, title: "1.4 Grade visual dos primeiros posts", stage: "Conteúdo", who: "itala", due: "2026-10-09", est: 3, status: "em_revisao", start: "2026-10-05", createdOn: "2026-09-15" });
  await task({ flow: fMiro, client: miro, title: "1.5 Aceite da estruturação com o cliente", stage: "Aceite", who: "diego", due: "2026-10-16", est: 0.5, createdOn: "2026-09-15" });

  // ═════════ CENÁRIO C — dia de um colaborador (Tarcísio) com 5 tarefas previstas para hoje ═════════
  const eleven = await client("Agência Eleven (interno)", "Rotinas internas", [panth, hornets, fox], { internal: true });
  await task({ client: eleven, title: "Backup semanal dos materiais brutos", who: "tarcisio", due: "2026-10-08", est: 0.5, createdOn: "2026-10-06" });
  await task({ client: eleven, title: "Organizar pasta de entregas de outubro", who: "tarcisio", due: "2026-10-08", est: 1, createdOn: "2026-10-06" });
  await task({ client: otica, title: "Responder briefing de campanha de fim de ano (avulsa)", who: "tarcisio", due: "2026-10-08", est: 1, createdOn: "2026-10-06" });
  // (as tarefas “Marcação de produção” do ciclo 19/10 e a capa atrasada do 09/10 também caem no dia dele)

  // Agenda: feriado nacional, reunião e indisponibilidade de exemplo
  await sql`INSERT INTO calendar_events (kind, title, starts_at, ends_at, all_day, is_demo, created_by) VALUES ('feriado', 'Feriado nacional — Nossa Senhora Aparecida', ${at("2026-10-12", "00:00")}, ${at("2026-10-12", "23:59")}, true, true, ${U.direcao})`;
  const [mt] = await sql<{ id: string }[]>`INSERT INTO calendar_events (kind, title, client_id, squad_id, starts_at, ends_at, is_demo, created_by) VALUES ('reuniao', 'Reunião de alinhamento JCont (exemplo)', ${jcont}, ${hornets}, ${at("2026-10-13", "10:00")}, ${at("2026-10-13", "11:00")}, true, ${U.pedro}) RETURNING id`;
  await sql`INSERT INTO event_participants (event_id, user_id) VALUES (${mt.id}, ${U.pedro}), (${mt.id}, ${U.william})`;
  const [ind] = await sql<{ id: string }[]>`INSERT INTO calendar_events (kind, title, starts_at, ends_at, all_day, is_demo, created_by) VALUES ('indisponibilidade', 'Indisponível (exemplo)', ${at("2026-10-15", "00:00")}, ${at("2026-10-15", "23:59")}, true, true, ${U.pedro}) RETURNING id`;
  await sql`INSERT INTO event_participants (event_id, user_id) VALUES (${ind.id}, ${U.pedro})`;

  // Daily de exemplo (ontem): estilos diferentes de registro
  await sql`INSERT INTO manual_activity_entries (user_id, occurred_on, recorded_at, kind, client_id, description, hours, is_demo) VALUES
    (${U.lucas}, '2026-10-07', ${at("2026-10-07", "18:30")}, 'observacao', ${otica}, 'Revisei marcações dos brutos do ciclo de setembro (estilo “lista de edições”).', NULL, true),
    (${U.pedro}, '2026-10-07', ${at("2026-10-08", "09:10")}, 'demanda_extra', ${jcont}, 'Ligação não planejada com cliente sobre acesso ao gerenciador (registrado retroativamente).', 0.5, true)`;
  await sql`INSERT INTO time_entries (user_id, client_id, hours, occurred_on, note, is_demo) VALUES (${U.pedro}, ${jcont}, 0.5, '2026-10-07', 'Meu Dia: ligação não planejada (fictício)', true)`;

  console.log("✔ Dados de demonstração criados.");
  console.log(`  Logins (senha: ${DEMO_PASSWORD}): direcao@eleven.demo (admin), victoria@eleven.demo / pedro@eleven.demo / diego@eleven.demo (líderes),`);
  console.log("  tarcisio@eleven.demo / william@eleven.demo / lucas@eleven.demo / itala@eleven.demo (colaboradores)");
}

if (require.main === module) {
  seedDemo({ reset: process.argv.includes("--reset") })
    .then(() => sql.end())
    .catch(async (e) => {
      console.error(e);
      await sql.end();
      process.exit(1);
    });
}
