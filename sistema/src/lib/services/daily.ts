// Meu Dia / Daily Inteligente: PROJEÇÃO dos eventos reais + complementos manuais.
// Não é um segundo cadastro de tarefas. Agendado ≠ realizado. Texto livre ≠ prova de conclusão.
import { sql } from "../db";
import type { Actor } from "../auth-core";
import { AppError, ForbiddenError } from "../errors";
import { assertClientAccess, isManager, loadTaskForActor } from "../access";
import { logEvent } from "../events";
import { addDays, localToInstant, today } from "../dates";
import { MANUAL_KIND, TASK_STATUS, fmtBlocker } from "../labels";
import { createTask, occurredInstant } from "./tasks";

export type DayTask = {
  id: string; title: string; status: string; priority: string; due_date: string | null; start_date: string | null; est_hours: number | null;
  client_id: string | null; client_name: string | null; flow_id: string | null; flow_name: string | null; is_extra: boolean; waiting_until: string | null;
  completed_at: Date | null; completed_recorded_at: Date | null; blocker: string | null;
};

export async function assertCanSeeDay(actor: Actor, userId: string) {
  if (userId === actor.id) return;
  if (actor.role === "admin") return;
  if (actor.role === "lider") {
    const [ok] = await sql`SELECT 1 FROM squad_members sm JOIN squads s ON s.id = sm.squad_id WHERE sm.user_id = ${userId} AND (s.leader_id = ${actor.id} OR EXISTS (SELECT 1 FROM squad_members m2 WHERE m2.squad_id = s.id AND m2.user_id = ${actor.id}))`;
    if (ok) return;
  }
  throw new ForbiddenError("Você só pode ver o dia de pessoas dos seus squads.");
}

export async function getDay(actor: Actor, userId: string, day: string) {
  await assertCanSeeDay(actor, userId);
  const from = localToInstant(day, "00:00");
  const to = localToInstant(addDays(day, 1), "00:00");
  const isToday = day === today();

  const tasks = await sql<DayTask[]>`
    SELECT t.id, t.title, t.status, t.priority, t.due_date, t.start_date, t.est_hours, t.client_id, c.name AS client_name, t.flow_id, f.name AS flow_name,
           t.is_extra, t.waiting_until, t.completed_at, t.completed_recorded_at,
           (SELECT b.reason_category || coalesce(': ' || b.comment, '') FROM blockers b WHERE b.task_id = t.id AND b.resolved_at IS NULL LIMIT 1) AS blocker
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN flow_instances f ON f.id = t.flow_id
    WHERE t.assignee_id = ${userId} AND t.deleted_at IS NULL AND (f.id IS NULL OR f.status NOT IN ('cancelado','arquivado'))
      AND (t.status NOT IN ('concluida','cancelada') OR (t.completed_at >= ${from} AND t.completed_at < ${to}))
    ORDER BY t.due_date NULLS LAST, t.priority DESC, t.position`;

  const open = tasks.filter((t) => !["concluida", "cancelada"].includes(t.status));
  const planned = open.filter((t) => t.status !== "bloqueada" && ((t.due_date && t.due_date === day) || (t.status === "em_andamento" && (!t.due_date || t.due_date >= day)) || (t.start_date && t.start_date <= day && (!t.due_date || t.due_date >= day))));
  const overdue = open.filter((t) => t.status !== "bloqueada" && t.due_date && t.due_date < day && !(t.waiting_until && t.waiting_until >= day));
  const blocked = open.filter((t) => t.status === "bloqueada");
  const upcoming = open.filter((t) => t.due_date && t.due_date > day && t.due_date <= addDays(day, 7) && !planned.includes(t));
  const completed = tasks.filter((t) => t.status === "concluida");

  const events = await sql<{ id: string; kind: string; title: string; starts_at: Date; ends_at: Date | null; status: string; attendance: string; client_name: string | null; all_day: boolean }[]>`
    SELECT e.id, e.kind, e.title, e.starts_at, e.ends_at, e.status, p.attendance, c.name AS client_name, e.all_day
    FROM calendar_events e JOIN event_participants p ON p.event_id = e.id AND p.user_id = ${userId} LEFT JOIN clients c ON c.id = e.client_id
    WHERE e.starts_at < ${to} AND coalesce(e.ends_at, e.starts_at) >= ${from} AND e.status <> 'cancelado' ORDER BY e.starts_at`;

  // Feed cronológico: apenas ações confirmadas ocorridas no dia (inclui registros retrospectivos)
  const feed = await sql<{ id: number; occurred_at: Date; recorded_at: Date; action: string; summary: string; reason: string | null; client_name: string | null; task_id: string | null; flow_id: string | null }[]>`
    SELECT oe.id, oe.occurred_at, oe.recorded_at, oe.action, oe.summary, oe.reason, c.name AS client_name, oe.task_id, oe.flow_id
    FROM operational_events oe LEFT JOIN clients c ON c.id = oe.client_id
    WHERE oe.actor_id = ${userId} AND oe.occurred_at >= ${from} AND oe.occurred_at < ${to}
      AND oe.entity_type IN ('task','event','content','blocker','justification','manual','flow')
    ORDER BY oe.occurred_at`;

  const manual = await sql<{ id: string; kind: string; description: string; hours: number | null; link: string | null; recorded_at: Date; client_name: string | null; task_id: string | null; task_title: string | null }[]>`
    SELECT m.id, m.kind, m.description, m.hours, m.link, m.recorded_at, c.name AS client_name, m.task_id, t.title AS task_title
    FROM manual_activity_entries m LEFT JOIN clients c ON c.id = m.client_id LEFT JOIN tasks t ON t.id = m.task_id
    WHERE m.user_id = ${userId} AND m.occurred_on = ${day} ORDER BY m.recorded_at`;

  const [hours] = await sql<{ total: number | null; n: number }[]>`SELECT sum(hours) AS total, count(*)::int AS n FROM time_entries WHERE user_id = ${userId} AND occurred_on = ${day}`;
  const [closing] = await sql<{ summary: string | null; recorded_at: Date }[]>`SELECT summary, recorded_at FROM daily_closings WHERE user_id = ${userId} AND day = ${day}`;
  const requests = await sql<{ id: string; task_id: string | null; title: string | null; question: string | null; requested_at: Date; by_name: string }[]>`
    SELECT jr.id, jr.task_id, t.title, jr.question, jr.requested_at, u.name AS by_name FROM justification_requests jr LEFT JOIN tasks t ON t.id = jr.task_id JOIN users u ON u.id = jr.requested_by
    WHERE jr.requested_to = ${userId} AND jr.answered_at IS NULL ORDER BY jr.requested_at`;
  const [person] = await sql<{ id: string; name: string; weekly_capacity_hours: number | null }[]>`SELECT id, name, weekly_capacity_hours FROM users WHERE id = ${userId}`;

  // Divergências para o fechamento: previsto hoje e não concluído; eventos passados ainda "agendados"
  const divergences = isToday || day < today()
    ? [
        ...planned.filter((t) => t.due_date === day).map((t) => ({ type: "tarefa" as const, id: t.id, text: `“${t.title}” estava prevista para o dia e está ${TASK_STATUS[t.status].toLowerCase()}` })),
        ...events.filter((e) => e.status === "agendado" && e.starts_at < new Date()).map((e) => ({ type: "evento" as const, id: e.id, text: `“${e.title}” segue como agendado — confirmar se aconteceu` })),
      ]
    : [];

  return { person, day, isToday, planned, overdue, blocked, upcoming, completed, events, feed, manual, hours: { total: hours.total, entries: hours.n }, closing: closing ?? null, requests, divergences };
}

export type ManualEntryInput = {
  day: string;
  kind: string;
  description: string;
  clientId?: string | null;
  taskId?: string | null;
  hours?: number | null;
  link?: string | null;
  createAsTask?: boolean;
};

/** Complemento manual. Vinculado a tarefa existente = complemento (não duplica). Demanda extra pode virar tarefa extra (não altera escopo vendido). */
export async function addManualEntry(actor: Actor, input: ManualEntryInput) {
  if (!MANUAL_KIND[input.kind]) throw new AppError("Tipo de registro inválido.");
  if (!input.description?.trim()) throw new AppError("Descreva a atividade.");
  if (input.day > today() && input.kind !== "plano") throw new AppError("Registros de atividade realizada não podem ser no futuro.");
  if (input.hours != null && (input.hours <= 0 || input.hours > 24)) throw new AppError("Horas entre 0 e 24.");
  let clientId = input.clientId ?? null;
  let flowId: string | null = null;
  if (input.taskId) {
    const t = await loadTaskForActor(actor, input.taskId);
    clientId = t.client_id;
    flowId = t.flow_id;
  } else await assertClientAccess(actor, clientId);

  let taskId = input.taskId ?? null;
  if (!taskId && input.createAsTask && input.kind === "demanda_extra") {
    taskId = await createTask(actor, { clientId, title: input.description.trim(), assigneeId: actor.id, isExtra: true, scopeClass: "avaliar_escopo", origin: "meu_dia", estHours: input.hours ?? null, dueDate: input.day });
    await sql`UPDATE tasks SET status = 'concluida', completed_at = ${occurredInstant(input.day)}, completed_recorded_at = now() WHERE id = ${taskId}`;
    await logEvent(sql, { actorId: actor.id, entityType: "task", entityId: taskId, clientId, taskId, action: "status:concluida", summary: `Concluiu demanda não planejada “${input.description.trim()}”`, occurredAt: occurredInstant(input.day) });
  }

  await sql.begin(async (tx) => {
    await tx`INSERT INTO manual_activity_entries (user_id, occurred_on, kind, client_id, flow_id, task_id, description, hours, link)
             VALUES (${actor.id}, ${input.day}, ${input.kind}, ${clientId}, ${flowId}, ${taskId}, ${input.description.trim()}, ${input.hours ?? null}, ${input.link ?? null})`;
    // Horas informadas contam como esforço (capacidade), nunca como % de entrega.
    if (input.hours && input.kind !== "plano") {
      await tx`INSERT INTO time_entries (user_id, task_id, client_id, hours, occurred_on, note) VALUES (${actor.id}, ${taskId}, ${clientId}, ${input.hours}, ${input.day}, ${"Meu Dia: " + input.description.trim()})`;
    }
    if (input.taskId && input.kind === "complemento") {
      await tx`UPDATE tasks SET last_activity_at = now() WHERE id = ${input.taskId}`;
    }
    await logEvent(tx, {
      actorId: actor.id, entityType: "manual", clientId, flowId, taskId, action: `manual:${input.kind}`,
      summary: `${MANUAL_KIND[input.kind]}: ${input.description.trim()}${input.hours ? ` (${input.hours}h)` : ""}`,
      occurredAt: occurredInstant(input.day), relevant: input.kind === "complemento" && !!input.taskId,
    });
  });
}

export async function deleteManualEntry(actor: Actor, id: string) {
  const [m] = await sql<{ user_id: string }[]>`SELECT user_id FROM manual_activity_entries WHERE id = ${id}`;
  if (!m) throw new AppError("Registro não encontrado.");
  if (m.user_id !== actor.id) throw new ForbiddenError();
  await sql`DELETE FROM manual_activity_entries WHERE id = ${id}`;
}

/** Fechamento opcional do dia: motivos de não conclusão apenas para o que o usuário escolher explicar. */
export async function closeDay(actor: Actor, day: string, summary: string | null, reasons: { taskId: string; reason: string }[]) {
  for (const r of reasons.filter((r) => r.reason.trim())) {
    const t = await loadTaskForActor(actor, r.taskId);
    await logEvent(sql, { actorId: actor.id, entityType: "task", entityId: t.id, clientId: t.client_id, flowId: t.flow_id, taskId: t.id, action: "motivo_nao_conclusao", summary: `Motivo de não conclusão de “${t.title}”`, reason: r.reason.trim(), relevant: false, occurredAt: occurredInstant(day) });
  }
  await sql`INSERT INTO daily_closings (user_id, day, summary) VALUES (${actor.id}, ${day}, ${summary}) ON CONFLICT (user_id, day) DO UPDATE SET summary = EXCLUDED.summary, recorded_at = now()`;
}

/** Resumo pronto para o líder (texto copiável, sem IA — consolida fatos registrados). */
export function dailySummaryText(d: Awaited<ReturnType<typeof getDay>>) {
  const lines: string[] = [];
  const dd = d.day.split("-").reverse().join("/");
  lines.push(`Daily de ${d.person.name} — ${dd}`);
  const doneLines = d.completed.map((t) => `• ${t.title}${t.client_name ? ` (${t.client_name})` : ""}${t.is_extra ? " [extra]" : ""}`);
  lines.push("", `Concluído (${d.completed.length}):`, ...(doneLines.length ? doneLines : ["• nada concluído registrado"]));
  const doing = d.planned.filter((t) => t.status !== "concluida");
  if (doing.length) lines.push("", "Em andamento / previsto:", ...doing.map((t) => `• ${t.title} — ${TASK_STATUS[t.status]}${t.client_name ? ` (${t.client_name})` : ""}`));
  if (d.blocked.length) lines.push("", "Bloqueado:", ...d.blocked.map((t) => `• ${t.title} — ${fmtBlocker(t.blocker) ?? "motivo não informado"}`));
  const extras = d.manual.filter((m) => m.kind === "demanda_extra");
  if (extras.length) lines.push("", "Demandas não planejadas:", ...extras.map((m) => `• ${m.description}${m.hours ? ` (${m.hours}h)` : ""}`));
  const comp = d.manual.filter((m) => m.kind === "complemento" || m.kind === "observacao");
  if (comp.length) lines.push("", "Complementos e observações:", ...comp.map((m) => `• ${m.description}${m.task_title ? ` → ${m.task_title}` : ""}`));
  const realized = d.events.filter((e) => e.status === "realizado" && e.attendance === "confirmado");
  if (realized.length) lines.push("", "Participações confirmadas:", ...realized.map((e) => `• ${e.title}`));
  lines.push("", `Horas apontadas: ${d.hours.entries ? `${d.hours.total}h` : "sem apontamento"}`);
  if (d.closing?.summary) lines.push("", `Observação de fechamento: ${d.closing.summary}`);
  return lines.join("\n");
}

export { isManager };
