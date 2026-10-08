import { sql } from "../db";
import type { Actor } from "../auth-core";
import { AppError, ForbiddenError } from "../errors";
import { assertClientAccess, clientScope, isManager, scopeIds } from "../access";
import { logEvent } from "../events";
import { dateOfInstant, fmtDateTime, localToInstant } from "../dates";
import { EVENT_KIND } from "../labels";
import { createTask } from "./tasks";

export type CalendarEvent = {
  id: string;
  kind: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  flow_id: string | null;
  flow_name: string | null;
  task_id: string | null;
  squad_id: string | null;
  starts_at: Date;
  ends_at: Date | null;
  all_day: boolean;
  location: string | null;
  status: string;
  cancel_reason: string | null;
  reschedule_count: number;
  meeting_notes: string | null;
  is_demo: boolean;
  participants: { id: string; name: string; attendance: string }[];
};

export async function listEvents(actor: Actor, f: { from: Date; to: Date; kind?: string | null; squadId?: string | null; clientId?: string | null; userId?: string | null; flowId?: string | null; includeCancelled?: boolean }) {
  const ids = scopeIds(await clientScope(actor));
  // Filtro de squad: evento do squad, de cliente do squad ou com participante do squad (mesmo objeto aparece em vários filtros).
  return sql<CalendarEvent[]>`
    SELECT e.*, c.name AS client_name, fi.name AS flow_name,
      coalesce((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'attendance', p.attendance) ORDER BY u.name)
                FROM event_participants p JOIN users u ON u.id = p.user_id WHERE p.event_id = e.id), '[]') AS participants
    FROM calendar_events e
    LEFT JOIN clients c ON c.id = e.client_id
    LEFT JOIN flow_instances fi ON fi.id = e.flow_id
    WHERE e.starts_at < ${f.to} AND coalesce(e.ends_at, e.starts_at) >= ${f.from}
      AND (${ids}::uuid[] IS NULL OR e.client_id IS NULL OR e.client_id = ANY(${ids}::uuid[]))
      AND (${f.kind ?? null}::text IS NULL OR e.kind = ${f.kind ?? null})
      AND (${f.clientId ?? null}::uuid IS NULL OR e.client_id = ${f.clientId ?? null})
      AND (${f.flowId ?? null}::uuid IS NULL OR e.flow_id = ${f.flowId ?? null})
      AND (${f.userId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = e.id AND p.user_id = ${f.userId ?? null}))
      AND (${f.squadId ?? null}::uuid IS NULL OR e.squad_id = ${f.squadId ?? null}
           OR e.client_id IN (SELECT client_id FROM client_squads WHERE squad_id = ${f.squadId ?? null})
           OR EXISTS (SELECT 1 FROM event_participants p JOIN squad_members sm ON sm.user_id = p.user_id WHERE p.event_id = e.id AND sm.squad_id = ${f.squadId ?? null}))
      AND (${!!f.includeCancelled} OR e.status <> 'cancelado')
    ORDER BY e.starts_at`;
}

export type EventInput = {
  kind: string;
  title: string;
  clientId?: string | null;
  flowId?: string | null;
  taskId?: string | null;
  squadId?: string | null;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  location?: string | null;
  participantIds?: string[];
  force?: boolean;
};

function range(date: string, start?: string | null, end?: string | null, allDay?: boolean) {
  if (allDay || !start) return { startsAt: localToInstant(date, "00:00"), endsAt: localToInstant(date, "23:59"), allDay: true };
  const startsAt = localToInstant(date, start);
  const endsAt = end ? localToInstant(date, end) : new Date(startsAt.getTime() + 60 * 60000);
  if (endsAt <= startsAt) throw new AppError("O horário de término deve ser depois do início.");
  return { startsAt, endsAt, allDay: false };
}

/** Conflitos visíveis: participantes com indisponibilidade ou outro evento no mesmo horário. */
export async function findConflicts(participantIds: string[], startsAt: Date, endsAt: Date, ignoreEventId?: string | null) {
  if (!participantIds.length) return [];
  return sql<{ user_name: string; title: string; kind: string; starts_at: Date }[]>`
    SELECT u.name AS user_name, e.title, e.kind, e.starts_at
    FROM calendar_events e JOIN event_participants p ON p.event_id = e.id JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ANY(${participantIds}::uuid[]) AND e.status <> 'cancelado'
      AND e.id IS DISTINCT FROM ${ignoreEventId ?? null}::uuid
      AND e.starts_at < ${endsAt} AND coalesce(e.ends_at, e.starts_at + interval '1 hour') > ${startsAt}
    ORDER BY e.starts_at`;
}

function conflictMessage(c: { user_name: string; title: string; kind: string; starts_at: Date }[]) {
  return `Conflito de agenda: ${c.map((x) => `${x.user_name} tem “${x.title}” (${EVENT_KIND[x.kind]}, ${fmtDateTime(x.starts_at)})`).join("; ")}. Marque “salvar mesmo com conflito” para confirmar.`;
}

export async function createEvent(actor: Actor, input: EventInput) {
  if (!EVENT_KIND[input.kind]) throw new AppError("Tipo de evento inválido.");
  if (!input.title?.trim()) throw new AppError("Informe o título do evento.");
  if (!input.date) throw new AppError("Informe a data.");
  const participants = [...new Set(input.participantIds ?? [])];
  if (!isManager(actor)) {
    // Colaborador registra a própria indisponibilidade ou reuniões das quais participa.
    if (!["indisponibilidade", "reuniao"].includes(input.kind)) throw new ForbiddenError("Colaboradores registram apenas indisponibilidade e reuniões próprias.");
    if (!participants.includes(actor.id)) participants.push(actor.id);
  }
  let clientId = input.clientId ?? null;
  if (input.flowId) {
    const [f] = await sql<{ client_id: string }[]>`SELECT client_id FROM flow_instances WHERE id = ${input.flowId}`;
    if (!f) throw new AppError("Fluxo não encontrado.");
    clientId = f.client_id;
  }
  await assertClientAccess(actor, clientId);
  const { startsAt, endsAt, allDay } = range(input.date, input.startTime, input.endTime, input.allDay);
  if (input.kind !== "feriado" && input.kind !== "indisponibilidade" && !input.force) {
    const c = await findConflicts(participants, startsAt, endsAt);
    if (c.length) throw new AppError(conflictMessage(c));
  }
  return sql.begin(async (tx) => {
    const [e] = await tx<{ id: string }[]>`
      INSERT INTO calendar_events (kind, title, client_id, flow_id, task_id, squad_id, starts_at, ends_at, all_day, location, created_by)
      VALUES (${input.kind}, ${input.title.trim()}, ${clientId}, ${input.flowId ?? null}, ${input.taskId ?? null}, ${input.squadId ?? null}, ${startsAt}, ${endsAt}, ${allDay}, ${input.location ?? null}, ${actor.id})
      RETURNING id`;
    for (const p of participants) await tx`INSERT INTO event_participants (event_id, user_id) VALUES (${e.id}, ${p})`;
    if (input.taskId) {
      await tx`UPDATE tasks SET due_date = ${input.date}, updated_at = now() WHERE id = ${input.taskId}`;
    }
    await logEvent(tx, { actorId: actor.id, entityType: "event", entityId: e.id, clientId, flowId: input.flowId ?? null, taskId: input.taskId ?? null, action: "agendou", summary: `Agendou ${EVENT_KIND[input.kind].toLowerCase()} “${input.title.trim()}” para ${fmtDateTime(startsAt)}`, relevant: false });
    return e.id;
  });
}

async function loadEvent(actor: Actor, id: string) {
  const [e] = await sql<{ id: string; kind: string; title: string; client_id: string | null; flow_id: string | null; task_id: string | null; starts_at: Date; ends_at: Date | null; all_day: boolean; status: string; created_by: string | null }[]>`SELECT * FROM calendar_events WHERE id = ${id}`;
  if (!e) throw new AppError("Evento não encontrado.");
  await assertClientAccess(actor, e.client_id);
  if (!isManager(actor) && e.created_by !== actor.id) throw new ForbiddenError("Apenas líderes ou quem criou o evento podem alterá-lo.");
  return e;
}

/** Remarcação: atualiza o MESMO objeto (agenda, fluxo, tarefa vinculada) e preserva o histórico — nunca duplica. */
export async function rescheduleEvent(actor: Actor, id: string, input: { date: string; startTime?: string | null; endTime?: string | null; reason: string; force?: boolean }) {
  if (!input.reason?.trim()) throw new AppError("Remarcação exige motivo.");
  const e = await loadEvent(actor, id);
  if (e.status === "cancelado") throw new AppError("Evento cancelado não pode ser remarcado; crie um novo.");
  const { startsAt, endsAt, allDay } = range(input.date, input.startTime, input.endTime, e.all_day && !input.startTime);
  const parts = (await sql<{ user_id: string }[]>`SELECT user_id FROM event_participants WHERE event_id = ${id}`).map((p) => p.user_id);
  if (!input.force && e.kind !== "indisponibilidade" && e.kind !== "feriado") {
    const c = await findConflicts(parts, startsAt, endsAt, id);
    if (c.length) throw new AppError(conflictMessage(c));
  }
  await sql.begin(async (tx) => {
    await tx`UPDATE calendar_events SET starts_at = ${startsAt}, ends_at = ${endsAt}, all_day = ${allDay}, reschedule_count = reschedule_count + 1, updated_at = now() WHERE id = ${id}`;
    if (e.task_id) {
      const [t] = await tx<{ due_date: string | null }[]>`SELECT due_date FROM tasks WHERE id = ${e.task_id}`;
      await tx`UPDATE tasks SET due_date = ${input.date}, updated_at = now() WHERE id = ${e.task_id}`;
      await logEvent(tx, { actorId: actor.id, entityType: "task", entityId: e.task_id, clientId: e.client_id, flowId: e.flow_id, taskId: e.task_id, action: "prazo_alterado", summary: `Prazo acompanhou a remarcação de “${e.title}”`, reason: input.reason, before: { due_date: t?.due_date }, after: { due_date: input.date }, relevant: false });
    }
    if (e.flow_id && e.kind === "producao") {
      await tx`UPDATE flow_instances SET reference_date = ${input.date}, updated_at = now() WHERE id = ${e.flow_id} AND reference_date = ${dateOfInstant(e.starts_at)}`;
    }
    await logEvent(tx, { actorId: actor.id, entityType: "event", entityId: id, clientId: e.client_id, flowId: e.flow_id, action: "remarcou", summary: `Remarcou “${e.title}”: ${fmtDateTime(e.starts_at)} → ${fmtDateTime(startsAt)}`, reason: input.reason, before: { starts_at: e.starts_at, ends_at: e.ends_at }, after: { starts_at: startsAt, ends_at: endsAt }, relevant: false });
  });
}

export async function cancelEvent(actor: Actor, id: string, reason: string) {
  if (!reason?.trim()) throw new AppError("Cancelamento exige motivo.");
  const e = await loadEvent(actor, id);
  if (e.status === "cancelado") throw new AppError("Evento já cancelado.");
  await sql.begin(async (tx) => {
    await tx`UPDATE calendar_events SET status = 'cancelado', cancel_reason = ${reason}, updated_at = now() WHERE id = ${id}`;
    await logEvent(tx, { actorId: actor.id, entityType: "event", entityId: id, clientId: e.client_id, flowId: e.flow_id, action: "cancelou_evento", summary: `Cancelou “${e.title}” (${fmtDateTime(e.starts_at)})`, reason, before: { status: e.status }, after: { status: "cancelado" } });
  });
}

/** Marcar realizado: só então vira fato no daily dos participantes (agendado ≠ realizado). */
export async function markEventDone(actor: Actor, id: string, attendedIds: string[]) {
  const e = await loadEvent(actor, id);
  if (e.status !== "agendado") throw new AppError("Somente eventos agendados podem ser marcados como realizados.");
  if (e.starts_at > new Date()) throw new AppError("O evento ainda não aconteceu.");
  await sql.begin(async (tx) => {
    await tx`UPDATE calendar_events SET status = 'realizado', updated_at = now() WHERE id = ${id}`;
    await tx`UPDATE event_participants SET attendance = CASE WHEN user_id = ANY(${attendedIds}::uuid[]) THEN 'confirmado' ELSE 'ausente' END WHERE event_id = ${id}`;
    await logEvent(tx, { actorId: actor.id, entityType: "event", entityId: id, clientId: e.client_id, flowId: e.flow_id, action: "realizou_evento", summary: `Registrou como realizado: “${e.title}”`, occurredAt: e.starts_at });
    for (const u of attendedIds) {
      await logEvent(tx, { actorId: u, entityType: "event", entityId: id, clientId: e.client_id, flowId: e.flow_id, action: "participou", summary: `Participou de ${EVENT_KIND[e.kind].toLowerCase()} “${e.title}” (confirmado por ${actor.name})`, occurredAt: e.starts_at });
    }
  });
}

export async function saveMeetingNotes(actor: Actor, id: string, notes: string) {
  const e = await loadEvent(actor, id);
  await sql`UPDATE calendar_events SET meeting_notes = ${notes}, updated_at = now() WHERE id = ${id}`;
  await logEvent(sql, { actorId: actor.id, entityType: "event", entityId: id, clientId: e.client_id, flowId: e.flow_id, action: "ata", summary: `Atualizou a ata de “${e.title}”`, relevant: false });
}

export async function addMeetingItem(actor: Actor, eventId: string, input: { kind: string; text: string; ownerId?: string | null; dueDate?: string | null }) {
  await loadEvent(actor, eventId);
  if (!input.text?.trim()) throw new AppError("Descreva a decisão/encaminhamento.");
  await sql`INSERT INTO meeting_items (event_id, kind, text, owner_id, due_date, created_by) VALUES (${eventId}, ${input.kind}, ${input.text.trim()}, ${input.ownerId ?? null}, ${input.dueDate ?? null}, ${actor.id})`;
}

/** Encaminhamento só vira tarefa por decisão explícita do líder. */
export async function meetingItemToTask(actor: Actor, itemId: string) {
  const [it] = await sql<{ id: string; event_id: string; text: string; owner_id: string | null; due_date: string | null; task_id: string | null }[]>`SELECT * FROM meeting_items WHERE id = ${itemId}`;
  if (!it) throw new AppError("Item não encontrado.");
  if (it.task_id) throw new AppError("Este encaminhamento já virou tarefa.");
  const e = await loadEvent(actor, it.event_id);
  const taskId = await createTask(actor, { clientId: e.client_id, flowId: null, title: it.text, assigneeId: it.owner_id, dueDate: it.due_date, origin: "reuniao", isExtra: true, scopeClass: "avaliar_escopo" });
  await sql`UPDATE meeting_items SET task_id = ${taskId} WHERE id = ${itemId}`;
  return taskId;
}
