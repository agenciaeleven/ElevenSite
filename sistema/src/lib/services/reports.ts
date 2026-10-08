// Relatórios para clientes: gerados a partir de fatos (tarefas concluídas, evidências, conteúdos postados),
// revisados por humano antes de compartilhar. Nunca incluem notas internas, capacidade ou justificativas sensíveis.
import { sql } from "../db";
import type { Actor } from "../auth-core";
import { AppError } from "../errors";
import { assertClientAccess, assertManager } from "../access";
import { logEvent } from "../events";
import { addDays, dateOfInstant, localToInstant } from "../dates";
import { createTask } from "./tasks";

export type ReportItem = { taskId?: string; contentId?: string; text: string; date: string; evidence?: string[]; include: boolean; group: string };

export async function buildWeeklyItems(clientId: string, start: string, end: string): Promise<{ done: ReportItem[]; next: string[] }> {
  const from = localToInstant(start, "00:00");
  const to = localToInstant(addDays(end, 1), "00:00");
  const tasks = await sql<{ id: string; title: string; completed_at: Date; flow_name: string | null; evidence: string[] | null }[]>`
    SELECT t.id, t.title, t.completed_at, f.name AS flow_name,
           (SELECT array_agg(coalesce(e.url, e.note)) FROM task_evidence e WHERE e.task_id = t.id) AS evidence
    FROM tasks t LEFT JOIN flow_instances f ON f.id = t.flow_id
    WHERE t.client_id = ${clientId} AND t.deleted_at IS NULL AND t.status = 'concluida' AND t.completed_at >= ${from} AND t.completed_at < ${to}
    ORDER BY t.completed_at`;
  const contents = await sql<{ id: string; title: string; published_at: Date }[]>`
    SELECT id, title, published_at FROM content_assets WHERE client_id = ${clientId} AND published_at >= ${from} AND published_at < ${to} ORDER BY published_at`;
  const next = await sql<{ title: string; due_date: string }[]>`
    SELECT t.title, t.due_date FROM tasks t WHERE t.client_id = ${clientId} AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada')
      AND t.due_date BETWEEN ${addDays(end, 1)}::date AND ${addDays(end, 7)}::date AND t.parent_task_id IS NULL ORDER BY t.due_date LIMIT 12`;
  const iso = (d: Date) => dateOfInstant(d);
  return {
    done: [
      ...tasks.map((t) => ({ taskId: t.id, text: t.title, date: iso(t.completed_at), evidence: (t.evidence ?? []).filter(Boolean), include: true, group: t.flow_name ?? "Demandas avulsas" })),
      ...contents.map((c) => ({ contentId: c.id, text: `Publicado: ${c.title}`, date: iso(c.published_at), include: true, group: "Conteúdos publicados" })),
    ],
    next: next.map((n) => `${n.title} (${n.due_date.split("-").reverse().join("/")})`),
  };
}

export async function createReport(actor: Actor, input: { clientId: string; kind: "semanal" | "mensal_trafego"; start: string; end: string }) {
  assertManager(actor, "Relatórios são preparados por líderes ou direção.");
  await assertClientAccess(actor, input.clientId);
  if (!input.start || !input.end || input.end < input.start) throw new AppError("Período inválido.");
  const [c] = await sql<{ name: string; is_demo: boolean }[]>`SELECT name, is_demo FROM clients WHERE id = ${input.clientId}`;
  const items = await buildWeeklyItems(input.clientId, input.start, input.end);
  const title = `${input.kind === "semanal" ? "Relatório semanal de execução" : "Relatório mensal de tráfego"} — ${c.name} — ${input.start.split("-").reverse().join("/")} a ${input.end.split("-").reverse().join("/")}`;
  const [r] = await sql<{ id: string }[]>`
    INSERT INTO client_reports (client_id, kind, period_start, period_end, title, completed_items, next_steps, created_by, is_demo)
    VALUES (${input.clientId}, ${input.kind}, ${input.start}, ${input.end}, ${title}, ${sql.json(items.done)}, ${items.next.map((n) => `• ${n}`).join("\n") || null}, ${actor.id}, ${c.is_demo})
    RETURNING id`;
  await logEvent(sql, { actorId: actor.id, entityType: "report", entityId: r.id, clientId: input.clientId, action: "gerou_relatorio", summary: `Gerou rascunho: ${title}`, relevant: false });
  return r.id;
}

async function loadReport(actor: Actor, id: string) {
  const [r] = await sql<{ id: string; client_id: string; status: string; completed_items: ReportItem[]; title: string }[]>`SELECT id, client_id, status, completed_items, title FROM client_reports WHERE id = ${id}`;
  if (!r) throw new AppError("Relatório não encontrado.");
  assertManager(actor);
  await assertClientAccess(actor, r.client_id);
  return r;
}

export async function updateReport(actor: Actor, id: string, input: { summary: string | null; resultsText: string | null; diagnosis: string | null; nextSteps: string | null; internalNotes: string | null; includeIdx: number[] }) {
  const r = await loadReport(actor, id);
  const items = (r.completed_items ?? []).map((it, i) => ({ ...it, include: input.includeIdx.includes(i) }));
  await sql`UPDATE client_reports SET summary = ${input.summary}, results_text = ${input.resultsText}, diagnosis = ${input.diagnosis}, next_steps = ${input.nextSteps},
            internal_notes = ${input.internalNotes}, completed_items = ${sql.json(items)}, status = CASE WHEN status = 'compartilhado' THEN status ELSE 'rascunho' END, updated_at = now() WHERE id = ${id}`;
}

export async function refreshReportItems(actor: Actor, id: string) {
  const r = await loadReport(actor, id);
  const [p] = await sql<{ period_start: string; period_end: string }[]>`SELECT period_start, period_end FROM client_reports WHERE id = ${id}`;
  const items = await buildWeeklyItems(r.client_id, p.period_start, p.period_end);
  await sql`UPDATE client_reports SET completed_items = ${sql.json(items.done)}, status = 'rascunho', updated_at = now() WHERE id = ${id}`;
}

export async function setReportStatus(actor: Actor, id: string, status: "revisado" | "compartilhado") {
  const r = await loadReport(actor, id);
  if (status === "compartilhado" && r.status === "rascunho") throw new AppError("Revise o relatório antes de marcá-lo como compartilhado.");
  await sql`UPDATE client_reports SET status = ${status},
            reviewed_by = CASE WHEN ${status} = 'revisado' THEN ${actor.id}::uuid ELSE reviewed_by END, reviewed_at = CASE WHEN ${status} = 'revisado' THEN now() ELSE reviewed_at END,
            shared_at = CASE WHEN ${status} = 'compartilhado' THEN now() ELSE shared_at END, updated_at = now() WHERE id = ${id}`;
  await logEvent(sql, { actorId: actor.id, entityType: "report", entityId: id, clientId: r.client_id, action: `relatorio_${status}`, summary: `${status === "revisado" ? "Revisou" : "Marcou como compartilhado"}: ${r.title}`, relevant: false });
}

// ───────────── KPIs e cadeia diagnóstico → decisão → ação → resultado ─────────────

export async function saveKpi(actor: Actor, input: { id?: string | null; clientId: string; objectiveId?: string | null; name: string; unit?: string | null; baseline?: number | null; target?: number | null; deadline?: string | null; source?: string | null; reliability?: string | null; isFictitious?: boolean }) {
  assertManager(actor);
  await assertClientAccess(actor, input.clientId);
  if (!input.name?.trim()) throw new AppError("Informe o nome do indicador.");
  if (input.id) {
    await sql`UPDATE kpi_definitions SET name = ${input.name.trim()}, unit = ${input.unit ?? null}, baseline = ${input.baseline ?? null}, target = ${input.target ?? null}, deadline = ${input.deadline ?? null},
              source = ${input.source ?? null}, reliability = ${input.reliability ?? null}, objective_id = ${input.objectiveId ?? null}, is_fictitious = ${!!input.isFictitious} WHERE id = ${input.id}`;
    return input.id;
  }
  const [k] = await sql<{ id: string }[]>`
    INSERT INTO kpi_definitions (client_id, objective_id, name, unit, baseline, target, deadline, source, reliability, is_fictitious)
    VALUES (${input.clientId}, ${input.objectiveId ?? null}, ${input.name.trim()}, ${input.unit ?? null}, ${input.baseline ?? null}, ${input.target ?? null}, ${input.deadline ?? null}, ${input.source ?? null}, ${input.reliability ?? null}, ${!!input.isFictitious}) RETURNING id`;
  return k.id;
}

export async function addKpiObservation(actor: Actor, input: { kpiId: string; reportId?: string | null; observedOn: string; value: number; source?: string | null; note?: string | null }) {
  assertManager(actor);
  const [k] = await sql<{ client_id: string; is_fictitious: boolean }[]>`SELECT client_id, is_fictitious FROM kpi_definitions WHERE id = ${input.kpiId}`;
  if (!k) throw new AppError("Indicador não encontrado.");
  await assertClientAccess(actor, k.client_id);
  if (!Number.isFinite(input.value)) throw new AppError("Valor inválido.");
  await sql`INSERT INTO kpi_observations (kpi_id, report_id, observed_on, value, source, note, is_fictitious) VALUES (${input.kpiId}, ${input.reportId ?? null}, ${input.observedOn}, ${input.value}, ${input.source ?? null}, ${input.note ?? null}, ${k.is_fictitious})`;
}

export async function proposeDecision(actor: Actor, input: { clientId: string; reportId?: string | null; kpiId?: string | null; diagnosis?: string | null; proposal: string; ownerId?: string | null }) {
  assertManager(actor);
  await assertClientAccess(actor, input.clientId);
  if (!input.proposal?.trim()) throw new AppError("Descreva a ação proposta.");
  const [d] = await sql<{ id: string }[]>`
    INSERT INTO decisions (client_id, report_id, kpi_id, diagnosis, proposal, owner_id) VALUES (${input.clientId}, ${input.reportId ?? null}, ${input.kpiId ?? null}, ${input.diagnosis ?? null}, ${input.proposal.trim()}, ${input.ownerId ?? null}) RETURNING id`;
  await logEvent(sql, { actorId: actor.id, entityType: "decision", entityId: d.id, clientId: input.clientId, action: "propôs_decisao", summary: `Propôs: ${input.proposal.trim()}`, reason: input.diagnosis, relevant: false });
  return d.id;
}

/** Só após aprovação a ação vira tarefa (intervenção finita), vinculada à decisão de origem. */
export async function decide(actor: Actor, decisionId: string, approve: boolean, input: { note?: string | null; dueDate?: string | null; estHours?: number | null; flowId?: string | null }) {
  assertManager(actor);
  const [d] = await sql<{ id: string; client_id: string; proposal: string; status: string; owner_id: string | null; diagnosis: string | null }[]>`SELECT * FROM decisions WHERE id = ${decisionId}`;
  if (!d) throw new AppError("Decisão não encontrada.");
  await assertClientAccess(actor, d.client_id);
  if (d.status !== "proposta") throw new AppError("Decisão já tomada.");
  let taskId: string | null = null;
  if (approve) {
    taskId = await createTask(actor, {
      clientId: d.client_id, flowId: input.flowId ?? null, title: d.proposal, description: d.diagnosis ? `Diagnóstico de origem: ${d.diagnosis}` : null,
      assigneeId: d.owner_id, dueDate: input.dueDate ?? null, estHours: input.estHours ?? null, origin: "decisao", isExtra: !input.flowId, scopeClass: "dentro_do_escopo",
    });
  }
  await sql`UPDATE decisions SET status = ${approve ? "aprovada" : "recusada"}, decided_by = ${actor.id}, decided_at = now(), task_id = ${taskId}, flow_id = ${input.flowId ?? null} WHERE id = ${decisionId}`;
  await logEvent(sql, { actorId: actor.id, entityType: "decision", entityId: decisionId, clientId: d.client_id, taskId, action: approve ? "aprovou_decisao" : "recusou_decisao", summary: `${approve ? "Aprovou" : "Recusou"}: ${d.proposal}`, reason: input.note ?? null });
  return taskId;
}

export async function recordDecisionResult(actor: Actor, decisionId: string, resultNote: string) {
  assertManager(actor);
  if (!resultNote?.trim()) throw new AppError("Descreva o resultado observado (com métrica/fonte quando houver).");
  const [d] = await sql<{ client_id: string; proposal: string }[]>`SELECT client_id, proposal FROM decisions WHERE id = ${decisionId}`;
  if (!d) throw new AppError("Decisão não encontrada.");
  await assertClientAccess(actor, d.client_id);
  await sql`UPDATE decisions SET result_note = ${resultNote.trim()}, result_recorded_at = now() WHERE id = ${decisionId}`;
  await logEvent(sql, { actorId: actor.id, entityType: "decision", entityId: decisionId, clientId: d.client_id, action: "resultado_decisao", summary: `Registrou resultado de: ${d.proposal}`, reason: resultNote.trim(), relevant: false });
}
