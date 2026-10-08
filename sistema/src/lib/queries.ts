// Modelos de leitura compartilhados pelas telas (Radar, cliente, squad, pessoas).
import { sql } from "./db";
import type { Actor } from "./auth-core";
import { clientScope, isManager, scopeIds } from "./access";
import { computeProgress, type Progress, type ProgressTask } from "./progress";
import { addDays, businessDaysBetween, dateOfInstant, monthRange, today } from "./dates";
import { computeAlerts, healthOf, type Alert } from "./services/alerts";
import type { Severity } from "./labels";

export async function usersList() {
  return sql<{ id: string; name: string; role: string; job_title: string | null; active: boolean; is_demo: boolean }[]>`SELECT id, name, role, job_title, active, is_demo FROM users WHERE active ORDER BY name`;
}

export async function squadsList() {
  return sql<{ id: string; name: string; color: string | null; leader_id: string | null; leader_name: string | null; is_demo: boolean }[]>`
    SELECT s.id, s.name, s.color, s.leader_id, u.name AS leader_name, s.is_demo FROM squads s LEFT JOIN users u ON u.id = s.leader_id ORDER BY s.name`;
}

export async function visibleClients(actor: Actor) {
  const ids = scopeIds(await clientScope(actor));
  return sql<{ id: string; name: string; is_demo: boolean; is_internal: boolean; status: string }[]>`
    SELECT id, name, is_demo, is_internal, status FROM clients WHERE deleted_at IS NULL AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[])) ORDER BY is_internal, name`;
}

export async function templatesList() {
  return sql<{ id: string; name: string; lifecycle: string; steps: number; hours: number | null; missing: number }[]>`
    SELECT t.id, t.name, t.lifecycle, count(s.id)::int AS steps, sum(s.est_hours) AS hours, count(s.id) FILTER (WHERE s.est_hours IS NULL)::int AS missing
    FROM flow_templates t LEFT JOIN flow_template_steps s ON s.template_id = t.id WHERE t.active GROUP BY t.id ORDER BY t.name`;
}

type PT = ProgressTask & { flow_id: string | null; client_id: string | null };

/** Progresso por fluxo (instância completa, sem reset mensal). */
export async function flowProgress(flowIds: string[], ref = today()): Promise<Map<string, Progress & { actualHours: number | null }>> {
  const out = new Map<string, Progress & { actualHours: number | null }>();
  if (!flowIds.length) return out;
  const rows = await sql<PT[]>`
    SELECT flow_id, client_id, status, est_hours, in_baseline, cancel_scope_treatment, due_date FROM tasks WHERE flow_id = ANY(${flowIds}::uuid[]) AND deleted_at IS NULL`;
  const hours = await sql<{ flow_id: string; h: number }[]>`
    SELECT t.flow_id, sum(te.hours) AS h FROM time_entries te JOIN tasks t ON t.id = te.task_id WHERE t.flow_id = ANY(${flowIds}::uuid[]) GROUP BY t.flow_id`;
  const hmap = new Map(hours.map((h) => [h.flow_id, h.h]));
  for (const id of flowIds) out.set(id, { ...computeProgress(rows.filter((r) => r.flow_id === id), ref), actualHours: hmap.get(id) ?? null });
  return out;
}

/** Cumprimento do período (compromissos com prazo no mês) — medida distinta do progresso da instância (REQ-053). */
export async function monthCommitment(clientIds: string[], month: string) {
  const { start, end } = monthRange(month);
  const ref = today() < end ? today() : end;
  const rows = await sql<PT[]>`
    SELECT t.flow_id, t.client_id, t.status, t.est_hours, t.in_baseline, t.cancel_scope_treatment, t.due_date
    FROM tasks t JOIN flow_instances f ON f.id = t.flow_id
    WHERE t.client_id = ANY(${clientIds}::uuid[]) AND t.deleted_at IS NULL AND f.status NOT IN ('cancelado','arquivado')
      AND t.due_date BETWEEN ${start}::date AND ${end}::date`;
  const out = new Map<string, Progress>();
  for (const id of clientIds) out.set(id, computeProgress(rows.filter((r) => r.client_id === id), ref));
  return { map: out, all: computeProgress(rows, ref), ref };
}

export type RadarFilters = { month: string; squadId?: string | null; leaderId?: string | null; clientId?: string | null; serviceKind?: string | null; health?: string | null };

export type RadarRow = {
  id: string; name: string; status: string; is_demo: boolean; is_internal: boolean;
  squads: string; leaders: string;
  commitment: Progress;
  nextDue: { title: string; due_date: string } | null;
  idleDays: number | null; lastMove: string | null;
  alerts: Alert[];
  health: { level: Severity; reasons: string[] };
  estHours: number; actualHours: number | null;
  activeFlows: number;
  riskScore: number;
};

export async function radar(actor: Actor, f: RadarFilters) {
  const scope = scopeIds(await clientScope(actor));
  const { start, end } = monthRange(f.month);
  const ref = today();

  const clients = await sql<{ id: string; name: string; status: string; is_demo: boolean; is_internal: boolean; squads: string | null; leaders: string | null }[]>`
    SELECT c.id, c.name, c.status, c.is_demo, c.is_internal,
           (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM client_squads cs JOIN squads s ON s.id = cs.squad_id WHERE cs.client_id = c.id) AS squads,
           (SELECT string_agg(DISTINCT u.name, ', ') FROM client_squads cs JOIN squads s ON s.id = cs.squad_id JOIN users u ON u.id = s.leader_id WHERE cs.client_id = c.id) AS leaders
    FROM clients c
    WHERE c.deleted_at IS NULL AND c.status <> 'encerrado'
      AND (${scope}::uuid[] IS NULL OR c.id = ANY(${scope}::uuid[]))
      AND (${f.clientId ?? null}::uuid IS NULL OR c.id = ${f.clientId ?? null})
      AND (${f.squadId ?? null}::uuid IS NULL OR c.id IN (SELECT client_id FROM client_squads WHERE squad_id = ${f.squadId ?? null})
           OR c.id IN (SELECT t.client_id FROM tasks t JOIN squad_members sm ON sm.user_id = t.assignee_id
                       WHERE sm.squad_id = ${f.squadId ?? null} AND t.deleted_at IS NULL AND t.due_date BETWEEN ${start}::date AND ${end}::date))
      AND (${f.leaderId ?? null}::uuid IS NULL OR c.id IN (SELECT cs.client_id FROM client_squads cs JOIN squads s ON s.id = cs.squad_id WHERE s.leader_id = ${f.leaderId ?? null}))
      AND (${f.serviceKind ?? null}::text IS NULL OR c.id IN (SELECT client_id FROM services WHERE kind = ${f.serviceKind ?? null} AND status = 'ativo'))
    ORDER BY c.name`;
  const ids = clients.map((c) => c.id);
  const { map: commit, all } = await monthCommitment(ids, f.month);

  const nexts = await sql<{ client_id: string; title: string; due_date: string }[]>`
    SELECT DISTINCT ON (client_id) client_id, title, due_date FROM tasks
    WHERE client_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL AND status NOT IN ('concluida','cancelada') AND due_date >= ${ref}::date
    ORDER BY client_id, due_date, priority DESC`;
  const moves = await sql<{ client_id: string; last: Date }[]>`
    SELECT client_id, max(occurred_at) AS last FROM operational_events WHERE client_id = ANY(${ids}::uuid[]) AND is_relevant AND entity_type IN ('task','content','blocker','event','manual') GROUP BY client_id`;
  const hasData = await sql<{ client_id: string; n: number; flows: number }[]>`
    SELECT client_id, count(*)::int AS n, count(DISTINCT flow_id) FILTER (WHERE flow_id IS NOT NULL)::int AS flows FROM tasks WHERE client_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL GROUP BY client_id`;
  const activeFlows = await sql<{ client_id: string; n: number }[]>`SELECT client_id, count(*)::int AS n FROM flow_instances WHERE client_id = ANY(${ids}::uuid[]) AND status IN ('ativo','em_espera','planejado') GROUP BY client_id`;
  const hours = await sql<{ client_id: string; h: number }[]>`
    SELECT client_id, sum(hours) AS h FROM time_entries WHERE client_id = ANY(${ids}::uuid[]) AND occurred_on BETWEEN ${start}::date AND ${end}::date GROUP BY client_id`;

  const alerts = await computeAlerts(actor, { squadId: f.squadId });
  const rows: RadarRow[] = clients.map((c) => {
    const cAlerts = alerts.filter((a) => a.clientId === c.id);
    const mv = moves.find((m) => m.client_id === c.id);
    const lastMove = mv ? dateOfInstant(mv.last) : null;
    const data = hasData.find((h) => h.client_id === c.id);
    const health = healthOf(cAlerts, !!data?.n);
    const commitment = commit.get(c.id)!;
    const d = commitment.state === "ok" ? { v: commitment.weighted, e: commitment.expected } : { v: commitment.provisional, e: commitment.expectedProvisional };
    const gap = d.v != null && d.e != null ? d.e - d.v : 0;
    const sevScore = cAlerts.reduce((s, a) => s + (a.severity === "critico" ? 100 : a.severity === "atencao" ? 30 : 2), 0);
    return {
      ...c, squads: c.squads ?? "—", leaders: c.leaders ?? "—", commitment,
      nextDue: nexts.find((n) => n.client_id === c.id) ?? null,
      lastMove, idleDays: lastMove ? businessDaysBetween(lastMove, ref) : null,
      alerts: cAlerts, health,
      estHours: commitment.estHoursTotal, actualHours: hours.find((h) => h.client_id === c.id)?.h ?? null,
      activeFlows: activeFlows.find((a) => a.client_id === c.id)?.n ?? 0,
      riskScore: sevScore + Math.max(0, gap),
    };
  });
  const filtered = f.health ? rows.filter((r) => r.health.level === f.health) : rows;
  filtered.sort((a, b) => b.riskScore - a.riskScore || a.name.localeCompare(b.name));

  // Cards de síntese
  const [deliverables] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM deliverables WHERE client_id = ANY(${ids}::uuid[]) AND status = 'ativo'
      AND (start_date IS NULL OR start_date <= ${end}::date) AND (end_date IS NULL OR end_date >= ${start}::date)`;
  const [due] = await sql<{ upcoming: number; overdue: number }[]>`
    SELECT count(*) FILTER (WHERE due_date BETWEEN ${ref}::date AND ${addDays(ref, 7)}::date)::int AS upcoming,
           count(*) FILTER (WHERE due_date < ${ref}::date AND status <> 'bloqueada' AND (waiting_until IS NULL OR waiting_until < ${ref}::date))::int AS overdue
    FROM tasks WHERE client_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL AND status NOT IN ('concluida','cancelada')`;
  const visibleAlerts = alerts.filter((a) => !a.clientId || ids.includes(a.clientId));
  const flowSev = new Map<string, string>();
  for (const a of visibleAlerts) if (a.flowId && a.severity !== "info") flowSev.set(a.flowId, flowSev.get(a.flowId) === "critico" ? "critico" : a.severity);
  const blockers = visibleAlerts.filter((a) => a.rule === "bloqueio");
  const decisionsWaiting = visibleAlerts.filter((a) => a.rule === "decisao_pendente" || a.rule === "justificativa_pendente" || (a.rule === "bloqueio" && /Sem encaminhamento/.test(a.detail)));

  // Capacidade por squad (estimada × capacidade definida × apontado)
  const squads = await sql<{ id: string; name: string; color: string | null; members: number; cap: number | null; squad_cap: number | null; open_est: number | null; unestimated: number; logged: number | null; logged_n: number }[]>`
    SELECT s.id, s.name, s.color, count(DISTINCT sm.user_id)::int AS members,
           s.weekly_capacity_hours AS squad_cap,
           (SELECT sum(u2.weekly_capacity_hours) FROM squad_members m2 JOIN users u2 ON u2.id = m2.user_id WHERE m2.squad_id = s.id AND u2.active) AS cap,
           (SELECT sum(t.est_hours) FROM tasks t WHERE t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada') AND t.due_date BETWEEN ${ref}::date AND ${addDays(ref, 6)}::date
              AND t.assignee_id IN (SELECT user_id FROM squad_members WHERE squad_id = s.id)) AS open_est,
           (SELECT count(*)::int FROM tasks t WHERE t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada') AND t.est_hours IS NULL AND t.due_date BETWEEN ${ref}::date AND ${addDays(ref, 6)}::date
              AND t.assignee_id IN (SELECT user_id FROM squad_members WHERE squad_id = s.id)) AS unestimated,
           (SELECT sum(te.hours) FROM time_entries te WHERE te.occurred_on BETWEEN ${addDays(ref, -6)}::date AND ${ref}::date AND te.user_id IN (SELECT user_id FROM squad_members WHERE squad_id = s.id)) AS logged,
           (SELECT count(*)::int FROM time_entries te WHERE te.occurred_on BETWEEN ${addDays(ref, -6)}::date AND ${ref}::date AND te.user_id IN (SELECT user_id FROM squad_members WHERE squad_id = s.id)) AS logged_n
    FROM squads s LEFT JOIN squad_members sm ON sm.squad_id = s.id
    WHERE (${f.squadId ?? null}::uuid IS NULL OR s.id = ${f.squadId ?? null})
      AND (${isManager(actor) && actor.role !== "admin"} = false OR s.leader_id = ${actor.id} OR s.id IN (SELECT squad_id FROM squad_members WHERE user_id = ${actor.id}))
    GROUP BY s.id ORDER BY s.name`;

  return {
    rows: filtered,
    alerts: visibleAlerts,
    summary: {
      activeClients: clients.filter((c) => !c.is_internal && c.status !== "pausado").length,
      deliverables: deliverables.n,
      all,
      upcoming: due.upcoming,
      overdue: due.overdue,
      flowsAttention: [...flowSev.values()].filter((v) => v === "atencao").length,
      flowsCritical: [...flowSev.values()].filter((v) => v === "critico").length,
      blockers: blockers.length,
      decisionsWaiting,
    },
    squads,
  };
}

export async function clientHistory(clientId: string, limit = 60) {
  return sql<{ id: number; occurred_at: Date; recorded_at: Date; action: string; summary: string; reason: string | null; actor_name: string | null; task_id: string | null; flow_id: string | null }[]>`
    SELECT oe.id, oe.occurred_at, oe.recorded_at, oe.action, oe.summary, oe.reason, u.name AS actor_name, oe.task_id, oe.flow_id
    FROM operational_events oe LEFT JOIN users u ON u.id = oe.actor_id
    WHERE oe.client_id = ${clientId} ORDER BY oe.occurred_at DESC, oe.id DESC LIMIT ${limit}`;
}
