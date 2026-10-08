// Central de saúde: regras determinísticas, explicáveis e configuráveis (P0).
// Cada alerta traz o FATO (o que a regra detectou) e o motivo/justificativa quando já existe.
import { sql } from "../db";
import type { Actor } from "../auth-core";
import { AppError, ForbiddenError } from "../errors";
import { assertClientAccess, assertManager, clientScope, isManager, scopeIds, loadTaskForActor } from "../access";
import { logEvent } from "../events";
import { addDays, businessDaysBetween, dateOfInstant, diffDays, today } from "../dates";
import { BLOCK_REASON, type Severity } from "../labels";

export type Alert = {
  key: string;
  rule: string;
  severity: Exclude<Severity, "normal" | "sem_dados">;
  title: string;
  detail: string;
  clientId: string | null;
  clientName: string | null;
  flowId: string | null;
  flowName: string | null;
  taskId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  since: string | null;
  href: string;
  justification?: string | null;
  acked?: { note: string | null; snooze_until: string | null } | null;
  isDemo: boolean;
};

type Rule = { key: string; enabled: boolean; threshold: number | null };

export async function loadRules() {
  const rows = await sql<Rule[]>`SELECT key, enabled, threshold FROM alert_rules`;
  return Object.fromEntries(rows.map((r) => [r.key, r])) as Record<string, Rule>;
}

export type AlertFilter = { clientId?: string | null; squadId?: string | null; userId?: string | null; includeAcked?: boolean };

export async function computeAlerts(actor: Actor, filter: AlertFilter = {}): Promise<Alert[]> {
  const rules = await loadRules();
  const ids = scopeIds(await clientScope(actor));
  const ref = today();
  const on = (k: string) => rules[k]?.enabled;
  const alerts: Alert[] = [];
  const squadClients = filter.squadId ? (await sql<{ client_id: string }[]>`SELECT client_id FROM client_squads WHERE squad_id = ${filter.squadId}`).map((r) => r.client_id) : null;
  const squadUsers = filter.squadId ? (await sql<{ user_id: string }[]>`SELECT user_id FROM squad_members WHERE squad_id = ${filter.squadId}`).map((r) => r.user_id) : null;

  // Base de tarefas abertas visíveis (com última justificativa respondida, se houver)
  const tasks = await sql<{
    id: string; title: string; status: string; due_date: string | null; start_date: string | null; waiting_until: string | null; waiting_reason: string | null;
    client_id: string | null; client_name: string | null; flow_id: string | null; flow_name: string | null; assignee_id: string | null; assignee_name: string | null; is_demo: boolean;
    justification: string | null;
  }[]>`
    SELECT t.id, t.title, t.status, t.due_date, t.start_date, t.waiting_until, t.waiting_reason, t.client_id, c.name AS client_name, t.flow_id, f.name AS flow_name,
           t.assignee_id, u.name AS assignee_name, t.is_demo,
           (SELECT coalesce(jr.reason_category, '') || '|' || coalesce(jr.answer, '') FROM justification_requests jr WHERE jr.task_id = t.id AND jr.answered_at IS NOT NULL ORDER BY jr.answered_at DESC LIMIT 1) AS justification
    FROM tasks t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN flow_instances f ON f.id = t.flow_id
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada') AND (c.id IS NULL OR c.deleted_at IS NULL)
      AND (f.id IS NULL OR f.status IN ('ativo','em_espera','planejado'))
      AND (${ids}::uuid[] IS NULL OR t.client_id IS NULL OR t.client_id = ANY(${ids}::uuid[]))
      AND (${filter.clientId ?? null}::uuid IS NULL OR t.client_id = ${filter.clientId ?? null})
      AND (${filter.userId ?? null}::uuid IS NULL OR t.assignee_id = ${filter.userId ?? null})`;

  const inSquad = (clientId: string | null, userId: string | null) =>
    !squadClients || (clientId && squadClients.includes(clientId)) || (userId && squadUsers!.includes(userId));
  const fmtJust = (j: string | null) => {
    if (!j) return null;
    const [cat, txt] = j.split("|");
    return `${BLOCK_REASON[cat] ?? "Justificativa"}${txt ? `: ${txt}` : ""}`;
  };

  // 1. Prazo vencido (não conta bloqueada — tem regra própria — nem espera planejada vigente)
  if (on("atraso")) {
    for (const t of tasks) {
      if (!t.due_date || t.due_date >= ref || t.status === "bloqueada") continue;
      if (t.waiting_until && t.waiting_until >= ref) continue;
      if (!inSquad(t.client_id, t.assignee_id)) continue;
      const late = businessDaysBetween(t.due_date, ref);
      alerts.push({
        key: `atraso:${t.id}`, rule: "atraso", severity: late >= 3 ? "critico" : "atencao",
        title: `Prazo vencido: ${t.title}`,
        detail: `Prazo ${t.due_date.split("-").reverse().join("/")} (${late} dia(s) útil(eis) de atraso)${t.status === "em_revisao" ? " — aguardando revisão" : ""}. Responsável: ${t.assignee_name ?? "sem responsável"}.`,
        clientId: t.client_id, clientName: t.client_name, flowId: t.flow_id, flowName: t.flow_name, taskId: t.id, ownerId: t.assignee_id, ownerName: t.assignee_name,
        since: t.due_date, href: `/tarefas/${t.id}`, justification: fmtJust(t.justification), isDemo: t.is_demo,
      });
    }
  }

  // 2. Bloqueios abertos
  if (on("bloqueio")) {
    const limit = Number(rules.bloqueio.threshold ?? 3);
    const blockers = await sql<{ id: string; task_id: string; title: string; reason_category: string; comment: string | null; release_owner: string | null; expected_resolution: string | null; opened_at: Date; client_id: string | null; client_name: string | null; flow_id: string | null; flow_name: string | null; assignee_id: string | null; assignee_name: string | null; is_demo: boolean; interventions: number }[]>`
      SELECT b.id, b.task_id, t.title, b.reason_category, b.comment, b.release_owner, b.expected_resolution, b.opened_at, t.client_id, c.name AS client_name,
             t.flow_id, f.name AS flow_name, t.assignee_id, u.name AS assignee_name, t.is_demo,
             (SELECT count(*)::int FROM manager_interventions mi WHERE mi.blocker_id = b.id) AS interventions
      FROM blockers b JOIN tasks t ON t.id = b.task_id LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN flow_instances f ON f.id = t.flow_id LEFT JOIN users u ON u.id = t.assignee_id
      WHERE b.resolved_at IS NULL AND t.deleted_at IS NULL
        AND (${ids}::uuid[] IS NULL OR t.client_id IS NULL OR t.client_id = ANY(${ids}::uuid[]))
        AND (${filter.clientId ?? null}::uuid IS NULL OR t.client_id = ${filter.clientId ?? null})
        AND (${filter.userId ?? null}::uuid IS NULL OR t.assignee_id = ${filter.userId ?? null})`;
    for (const b of blockers) {
      if (!inSquad(b.client_id, b.assignee_id)) continue;
      const age = diffDays(dateOfInstant(b.opened_at), ref);
      const overdueForecast = b.expected_resolution && b.expected_resolution < ref;
      alerts.push({
        key: `bloqueio:${b.id}`, rule: "bloqueio", severity: age >= limit || overdueForecast ? "critico" : "atencao",
        title: `Bloqueada: ${b.title}`,
        detail: `${BLOCK_REASON[b.reason_category]}${b.comment ? ` — ${b.comment.replace(/\.$/, "")}` : ""}. Liberação: ${b.release_owner ?? "não informado"}. Bloqueada há ${age} dia(s)${b.expected_resolution ? `; previsão ${b.expected_resolution.split("-").reverse().join("/")}${overdueForecast ? " (vencida)" : ""}` : "; sem previsão"}. ${b.interventions ? `${b.interventions} encaminhamento(s) do líder.` : "Sem encaminhamento do líder."}`,
        clientId: b.client_id, clientName: b.client_name, flowId: b.flow_id, flowName: b.flow_name, taskId: b.task_id, ownerId: b.assignee_id, ownerName: b.assignee_name,
        since: dateOfInstant(b.opened_at), href: `/tarefas/${b.task_id}`, justification: `${BLOCK_REASON[b.reason_category]}${b.comment ? `: ${b.comment}` : ""}`, isDemo: b.is_demo,
      });
    }
  }

  // 3. Inatividade relevante em fluxo ativo cuja próxima etapa já deveria estar em execução
  if (on("inatividade")) {
    const n = Number(rules.inatividade.threshold ?? 2);
    const flows = await sql<{ id: string; name: string; client_id: string | null; client_name: string | null; owner_id: string | null; owner_name: string | null; created_at: Date; last_move: Date | null; is_demo: boolean }[]>`
      SELECT f.id, f.name, f.client_id, c.name AS client_name, f.owner_id, u.name AS owner_name, f.created_at, f.is_demo,
             (SELECT max(oe.occurred_at) FROM operational_events oe WHERE oe.flow_id = f.id AND oe.is_relevant) AS last_move
      FROM flow_instances f LEFT JOIN clients c ON c.id = f.client_id LEFT JOIN users u ON u.id = f.owner_id
      WHERE f.status = 'ativo' AND (c.id IS NULL OR c.deleted_at IS NULL)
        AND (${ids}::uuid[] IS NULL OR f.client_id IS NULL OR f.client_id = ANY(${ids}::uuid[]))
        AND (${filter.clientId ?? null}::uuid IS NULL OR f.client_id = ${filter.clientId ?? null})`;
    for (const f of flows) {
      // "Deveria estar ativa": em andamento, com início já alcançado ou com prazo já vencido.
      const due = tasks.filter((t) => t.flow_id === f.id && ["a_fazer", "em_andamento"].includes(t.status)
        && !(t.waiting_until && t.waiting_until >= ref)
        && (t.status === "em_andamento" || (t.start_date && t.start_date <= ref) || (t.due_date && t.due_date < ref)));
      if (!due.length) continue; // aguardando data futura, revisão/aprovação ou bloqueio registrado → não é inatividade
      if (filter.userId && !due.some((t) => t.assignee_id === filter.userId)) continue;
      if (squadClients && !(f.client_id && squadClients.includes(f.client_id))) continue;
      const last = dateOfInstant(f.last_move ?? f.created_at);
      const idle = businessDaysBetween(last, ref);
      if (idle < n) continue;
      alerts.push({
        key: `inatividade:${f.id}`, rule: "inatividade", severity: idle >= n * 2 ? "critico" : "atencao",
        title: `Sem movimentação relevante: ${f.name}`,
        detail: `${idle} dia(s) útil(eis) sem avanço desde ${last.split("-").reverse().join("/")}. Etapas que já deveriam estar ativas: ${due.slice(0, 3).map((t) => `“${t.title}” (${t.assignee_name ?? "sem responsável"})`).join(", ")}${due.length > 3 ? "…" : ""}.`,
        clientId: f.client_id, clientName: f.client_name, flowId: f.id, flowName: f.name, taskId: due[0].id, ownerId: f.owner_id, ownerName: f.owner_name,
        since: last, href: `/fluxos/${f.id}`, justification: fmtJust(due.find((t) => t.justification)?.justification ?? null), isDemo: f.is_demo,
      });
    }
  }

  // 4. Tarefas abertas sem responsável com prazo próximo
  if (on("sem_responsavel")) {
    const horizon = addDays(ref, Number(rules.sem_responsavel.threshold ?? 7));
    for (const t of tasks) {
      if (t.assignee_id || !t.due_date || t.due_date > horizon) continue;
      if (filter.userId || !inSquad(t.client_id, null)) continue;
      alerts.push({
        key: `sem_responsavel:${t.id}`, rule: "sem_responsavel", severity: "atencao", title: `Sem responsável: ${t.title}`,
        detail: `Prazo ${t.due_date.split("-").reverse().join("/")} e ninguém atribuído.`, clientId: t.client_id, clientName: t.client_name, flowId: t.flow_id, flowName: t.flow_name,
        taskId: t.id, ownerId: null, ownerName: null, since: null, href: `/tarefas/${t.id}`, isDemo: t.is_demo,
      });
    }
  }

  // 5. Fluxos sem estimativa (configuração)
  if (on("sem_estimativa")) {
    const rows = await sql<{ id: string; name: string; client_id: string | null; client_name: string | null; missing: number; is_demo: boolean }[]>`
      SELECT f.id, f.name, f.client_id, c.name AS client_name, f.is_demo, count(t.id)::int AS missing
      FROM flow_instances f JOIN tasks t ON t.flow_id = f.id AND t.deleted_at IS NULL AND t.in_baseline AND t.est_hours IS NULL
           AND NOT (t.status = 'cancelada' AND t.cancel_scope_treatment = 'remover_da_base')
      LEFT JOIN clients c ON c.id = f.client_id
      WHERE f.status IN ('ativo','planejado','em_espera')
        AND (${ids}::uuid[] IS NULL OR f.client_id = ANY(${ids}::uuid[]))
        AND (${filter.clientId ?? null}::uuid IS NULL OR f.client_id = ${filter.clientId ?? null})
      GROUP BY f.id, c.name`;
    if (isManager(actor) && !filter.userId) {
      for (const r of rows) {
        if (squadClients && !(r.client_id && squadClients.includes(r.client_id))) continue;
        alerts.push({
          key: `sem_estimativa:${r.id}`, rule: "sem_estimativa", severity: "info", title: `Progresso ponderado indisponível: ${r.name}`,
          detail: `${r.missing} tarefa(s) da base sem horas estimadas. Defina estimativas para calcular o progresso real.`,
          clientId: r.client_id, clientName: r.client_name, flowId: r.id, flowName: r.name, taskId: null, ownerId: null, ownerName: null, since: null, href: `/fluxos/${r.id}`, isDemo: r.is_demo,
        });
      }
    }
  }

  // 6. Sobrecarga: horas estimadas abertas com prazo em 7 dias vs capacidade semanal definida
  if (on("sobrecarga") && isManager(actor)) {
    const pct = Number(rules.sobrecarga.threshold ?? 100);
    const rows = await sql<{ id: string; name: string; cap: number; load: number; unestimated: number }[]>`
      SELECT u.id, u.name, u.weekly_capacity_hours AS cap,
             coalesce(sum(t.est_hours), 0) AS load, count(t.id) FILTER (WHERE t.est_hours IS NULL)::int AS unestimated
      FROM users u JOIN tasks t ON t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada')
           AND t.due_date BETWEEN ${ref}::date AND ${addDays(ref, 6)}::date
      WHERE u.active AND u.weekly_capacity_hours IS NOT NULL
        AND (${filter.userId ?? null}::uuid IS NULL OR u.id = ${filter.userId ?? null})
        AND (${squadUsers}::uuid[] IS NULL OR u.id = ANY(${squadUsers}::uuid[]))
      GROUP BY u.id`;
    for (const r of rows) {
      if (r.load <= (r.cap * pct) / 100) continue;
      alerts.push({
        key: `sobrecarga:${r.id}:${ref}`, rule: "sobrecarga", severity: r.load > r.cap * 1.3 ? "critico" : "atencao", title: `Capacidade acima do planejado: ${r.name}`,
        detail: `${r.load}h estimadas com prazo nos próximos 7 dias para capacidade de ${r.cap}h/semana${r.unestimated ? ` (+${r.unestimated} tarefa(s) sem estimativa)` : ""}.`,
        clientId: null, clientName: null, flowId: null, flowName: null, taskId: null, ownerId: r.id, ownerName: r.name, since: null, href: `/pessoas/${r.id}`, isDemo: false,
      });
    }
  }

  // 7. Pedidos de justificativa sem resposta
  if (on("justificativa_pendente")) {
    const rows = await sql<{ id: string; task_id: string | null; title: string | null; client_id: string | null; client_name: string | null; requested_to: string; to_name: string; requested_at: Date; is_demo: boolean }[]>`
      SELECT jr.id, jr.task_id, t.title, t.client_id, c.name AS client_name, jr.requested_to, u.name AS to_name, jr.requested_at, jr.is_demo
      FROM justification_requests jr LEFT JOIN tasks t ON t.id = jr.task_id LEFT JOIN clients c ON c.id = t.client_id JOIN users u ON u.id = jr.requested_to
      WHERE jr.answered_at IS NULL
        AND (${ids}::uuid[] IS NULL OR t.client_id IS NULL OR t.client_id = ANY(${ids}::uuid[]))
        AND (${filter.clientId ?? null}::uuid IS NULL OR t.client_id = ${filter.clientId ?? null})
        AND (${filter.userId ?? null}::uuid IS NULL OR jr.requested_to = ${filter.userId ?? null})`;
    for (const r of rows) {
      if (!inSquad(r.client_id, r.requested_to)) continue;
      alerts.push({
        key: `justificativa:${r.id}`, rule: "justificativa_pendente", severity: "atencao", title: `Aguardando motivo de ${r.to_name}: ${r.title ?? "pendência"}`,
        detail: `Pedido enviado em ${dateOfInstant(r.requested_at).split("-").reverse().join("/")}.`, clientId: r.client_id, clientName: r.client_name, flowId: null, flowName: null,
        taskId: r.task_id, ownerId: r.requested_to, ownerName: r.to_name, since: dateOfInstant(r.requested_at), href: r.task_id ? `/tarefas/${r.task_id}` : "/alertas", isDemo: r.is_demo,
      });
    }
  }

  // 8. Decisões aguardando aprovação
  if (on("decisao_pendente") && isManager(actor) && !filter.userId) {
    const n = Number(rules.decisao_pendente.threshold ?? 5);
    const rows = await sql<{ id: string; proposal: string; client_id: string; client_name: string; created_at: Date; is_demo: boolean }[]>`
      SELECT d.id, d.proposal, d.client_id, c.name AS client_name, d.created_at, d.is_demo FROM decisions d JOIN clients c ON c.id = d.client_id
      WHERE d.status = 'proposta' AND (${ids}::uuid[] IS NULL OR d.client_id = ANY(${ids}::uuid[]))
        AND (${filter.clientId ?? null}::uuid IS NULL OR d.client_id = ${filter.clientId ?? null})`;
    for (const r of rows) {
      if (squadClients && !squadClients.includes(r.client_id)) continue;
      const age = diffDays(dateOfInstant(r.created_at), ref);
      alerts.push({
        key: `decisao:${r.id}`, rule: "decisao_pendente", severity: age > n ? "atencao" : "info", title: `Decisão aguardando: ${r.proposal}`,
        detail: `Proposta há ${age} dia(s). Ação só vira tarefa após aprovação.`, clientId: r.client_id, clientName: r.client_name, flowId: null, flowName: null, taskId: null,
        ownerId: null, ownerName: null, since: dateOfInstant(r.created_at), href: `/clientes/${r.client_id}?aba=relatorios`, isDemo: r.is_demo,
      });
    }
  }

  // Reconhecimentos/adiamentos (snooze) do líder
  const acks = await sql<{ alert_key: string; note: string | null; snooze_until: string | null }[]>`SELECT alert_key, note, snooze_until FROM alert_acks`;
  const ackMap = new Map(acks.map((a) => [a.alert_key, a]));
  const out = alerts
    .map((a) => ({ ...a, acked: ackMap.get(a.key) ?? null }))
    .filter((a) => filter.includeAcked || !a.acked || (a.acked.snooze_until && a.acked.snooze_until < ref));
  const order = { critico: 0, atencao: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity] || (a.since ?? "9").localeCompare(b.since ?? "9"));
}

/** Saúde explicável de um cliente a partir dos alertas (sem nota arbitrária). */
export function healthOf(alerts: Alert[], hasData: boolean): { level: Severity; reasons: string[] } {
  if (!hasData) return { level: "sem_dados", reasons: ["Sem fluxos ou tarefas cadastrados"] };
  const real = alerts.filter((a) => a.severity !== "info");
  const level: Severity = real.some((a) => a.severity === "critico") ? "critico" : real.length ? "atencao" : "normal";
  const reasons = real.slice(0, 4).map((a) => a.title);
  return { level, reasons: reasons.length ? reasons : alerts.length ? ["Apenas pendências de configuração"] : ["Nenhuma pendência detectada pelas regras"] };
}

export async function ackAlert(actor: Actor, key: string, note: string | null, snoozeUntil: string | null) {
  assertManager(actor);
  if (!note?.trim()) throw new AppError("Registre a observação/decisão ao reconhecer o alerta.");
  await sql`INSERT INTO alert_acks (alert_key, acknowledged_by, note, snooze_until) VALUES (${key}, ${actor.id}, ${note}, ${snoozeUntil})
            ON CONFLICT (alert_key) DO UPDATE SET acknowledged_by = EXCLUDED.acknowledged_by, note = EXCLUDED.note, snooze_until = EXCLUDED.snooze_until, created_at = now()`;
  await sql`INSERT INTO operational_events (actor_id, entity_type, action, summary, reason, is_relevant) VALUES (${actor.id}, 'intervention', 'reconheceu_alerta', ${`Reconheceu alerta ${key}`}, ${note}, false)`;
}

export async function unackAlert(actor: Actor, key: string) {
  assertManager(actor);
  await sql`DELETE FROM alert_acks WHERE alert_key = ${key}`;
}

/** Líder pergunta o motivo ao responsável (REQ-023). */
export async function requestJustification(actor: Actor, taskId: string, question: string | null) {
  assertManager(actor);
  const t = await loadTaskForActor(actor, taskId);
  if (!t.assignee_id) throw new AppError("A tarefa não tem responsável. Atribua alguém primeiro.");
  const [open] = await sql`SELECT 1 FROM justification_requests WHERE task_id = ${taskId} AND answered_at IS NULL`;
  if (open) throw new AppError("Já existe um pedido de motivo aguardando resposta.");
  await sql.begin(async (tx) => {
    await tx`INSERT INTO justification_requests (task_id, flow_id, requested_by, requested_to, question) VALUES (${taskId}, ${t.flow_id}, ${actor.id}, ${t.assignee_id}, ${question})`;
    await logEvent(tx, { actorId: actor.id, entityType: "justification", entityId: taskId, clientId: t.client_id, flowId: t.flow_id, taskId, action: "pediu_motivo", summary: `Pediu o motivo da pendência de “${t.title}”`, reason: question, relevant: false });
  });
}

export async function answerJustification(actor: Actor, requestId: string, input: { category: string; answer: string | null; expectedResolution: string | null; alsoBlock?: boolean; releaseOwner?: string | null }) {
  const [r] = await sql<{ id: string; task_id: string | null; requested_to: string; answered_at: Date | null }[]>`SELECT id, task_id, requested_to, answered_at FROM justification_requests WHERE id = ${requestId}`;
  if (!r) throw new AppError("Pedido não encontrado.");
  if (r.requested_to !== actor.id && actor.role !== "admin") throw new ForbiddenError("Somente o responsável responde a este pedido.");
  if (r.answered_at) throw new AppError("Pedido já respondido.");
  if (!BLOCK_REASON[input.category]) throw new AppError("Escolha a categoria do motivo.");
  const t = r.task_id ? await loadTaskForActor(actor, r.task_id) : null;
  await sql.begin(async (tx) => {
    await tx`UPDATE justification_requests SET answered_at = now(), reason_category = ${input.category}, answer = ${input.answer}, expected_resolution = ${input.expectedResolution} WHERE id = ${requestId}`;
    if (t) await logEvent(tx, { actorId: actor.id, entityType: "justification", entityId: requestId, clientId: t.client_id, flowId: t.flow_id, taskId: t.id, action: "justificou", summary: `Informou o motivo de “${t.title}”: ${BLOCK_REASON[input.category]}`, reason: input.answer, relevant: false });
  });
  if (t && input.alsoBlock && !["concluida", "cancelada", "bloqueada"].includes(t.status)) {
    const { blockTask } = await import("./tasks");
    await blockTask(actor, t.id, { category: input.category, comment: input.answer, releaseOwner: input.releaseOwner ?? null, expectedResolution: input.expectedResolution });
  }
}

/** Intervenção do líder: orientação, correção, encaminhamento, decisão ou one-on-one (REQ-024/025). */
export async function addIntervention(actor: Actor, input: { kind: string; text: string; taskId?: string | null; blockerId?: string | null; clientId?: string | null; subjectUserId?: string | null; responsibleId?: string | null; dueDate?: string | null }) {
  assertManager(actor);
  if (!input.text?.trim()) throw new AppError("Descreva a orientação/encaminhamento.");
  let clientId = input.clientId ?? null;
  let flowId: string | null = null;
  if (input.taskId) {
    const t = await loadTaskForActor(actor, input.taskId);
    clientId = t.client_id;
    flowId = t.flow_id;
  } else await assertClientAccess(actor, clientId);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO manager_interventions (author_id, kind, text, task_id, blocker_id, client_id, subject_user_id, responsible_id, due_date)
             VALUES (${actor.id}, ${input.kind}, ${input.text.trim()}, ${input.taskId ?? null}, ${input.blockerId ?? null}, ${clientId}, ${input.subjectUserId ?? null}, ${input.responsibleId ?? null}, ${input.dueDate ?? null})`;
    await logEvent(tx, { actorId: actor.id, entityType: "intervention", clientId, flowId, taskId: input.taskId ?? null, action: `intervencao:${input.kind}`, summary: `Registrou ${input.kind.replace("_", "-")} do líder`, reason: input.text.trim(), relevant: false });
  });
}

export async function resolveIntervention(actor: Actor, id: string) {
  assertManager(actor);
  await sql`UPDATE manager_interventions SET resolved_at = now() WHERE id = ${id}`;
}
