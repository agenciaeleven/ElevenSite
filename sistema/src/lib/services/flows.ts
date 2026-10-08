import { sql, type Tx } from "../db";
import type { Actor } from "../auth-core";
import { AppError } from "../errors";
import { assertCanManageFlow, assertClientAccess } from "../access";
import { logEvent } from "../events";
import { addDays, today } from "../dates";
import { EDITORIAL_STATE, FLOW_STATUS, LIFECYCLE } from "../labels";
import { createTask } from "./tasks";

export type FlowRow = {
  id: string;
  client_id: string | null;
  service_id: string | null;
  template_id: string | null;
  quarterly_plan_id: string | null;
  parent_flow_id: string | null;
  name: string;
  lifecycle: string;
  cycle_label: string | null;
  reference_date: string | null;
  start_date: string | null;
  due_date: string | null;
  status: string;
  wait_reason: string | null;
  wait_until: string | null;
  baseline_version: number;
  owner_id: string | null;
  objective: string | null;
  acceptance_note: string | null;
  completed_at: Date | null;
  is_demo: boolean;
  created_at: Date;
};

export async function loadFlow(actor: Actor, flowId: string): Promise<FlowRow> {
  const [f] = await sql<FlowRow[]>`SELECT * FROM flow_instances WHERE id = ${flowId}`;
  if (!f) throw new AppError("Fluxo não encontrado.");
  await assertClientAccess(actor, f.client_id);
  return f;
}

export type NewFlow = {
  clientId: string;
  name: string;
  lifecycle: string;
  templateId?: string | null;
  serviceId?: string | null;
  deliverableIds?: string[];
  planId?: string | null;
  parentFlowId?: string | null;
  referenceDate?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  cycleLabel?: string | null;
  ownerId?: string | null;
  defaultAssigneeId?: string | null;
  objective?: string | null;
  status?: string;
};

export async function createFlow(actor: Actor, input: NewFlow, txArg?: Tx): Promise<string> {
  await assertCanManageFlow(actor, input.clientId);
  if (!input.name?.trim()) throw new AppError("Informe o nome do fluxo/projeto.");
  if (!LIFECYCLE[input.lifecycle]) throw new AppError("Escolha o tipo de execução.");
  const ref = input.referenceDate || input.startDate || today();

  const run = async (tx: Tx) => {
    const [f] = await tx<{ id: string }[]>`
      INSERT INTO flow_instances (client_id, service_id, template_id, quarterly_plan_id, parent_flow_id, name, lifecycle, cycle_label,
                                  reference_date, start_date, due_date, status, owner_id, objective, created_by)
      VALUES (${input.clientId}, ${input.serviceId ?? null}, ${input.templateId ?? null}, ${input.planId ?? null}, ${input.parentFlowId ?? null},
              ${input.name.trim()}, ${input.lifecycle}, ${input.cycleLabel ?? null}, ${input.referenceDate ?? null}, ${input.startDate ?? ref},
              ${input.dueDate ?? null}, ${input.status ?? "ativo"}, ${input.ownerId ?? actor.id}, ${input.objective ?? null}, ${actor.id})
      RETURNING id`;
    for (const d of input.deliverableIds ?? []) await tx`INSERT INTO flow_deliverables (flow_id, deliverable_id) VALUES (${f.id}, ${d}) ON CONFLICT DO NOTHING`;

    let created = 0;
    if (input.templateId) {
      const steps = await tx<{ id: string; stage: string | null; name: string; est_hours: number | null; offset_days: number | null; done_criteria: string | null }[]>`
        SELECT id, stage, name, est_hours, offset_days, done_criteria FROM flow_template_steps WHERE template_id = ${input.templateId} ORDER BY position`;
      for (const s of steps) {
        await tx`
          INSERT INTO tasks (client_id, flow_id, template_step_id, title, stage, position, assignee_id, due_date, est_hours, in_baseline, done_criteria, origin, created_by)
          VALUES (${input.clientId}, ${f.id}, ${s.id}, ${s.name}, ${s.stage}, ${created + 1}, ${input.defaultAssigneeId ?? null},
                  ${s.offset_days != null ? addDays(ref, s.offset_days) : null}, ${s.est_hours}, true, ${s.done_criteria}, 'modelo', ${actor.id})`;
        created++;
      }
      if (!input.dueDate && steps.some((s) => s.offset_days != null)) {
        await tx`UPDATE flow_instances SET due_date = (SELECT max(due_date) FROM tasks WHERE flow_id = ${f.id}) WHERE id = ${f.id}`;
      }
    }
    await logEvent(tx, {
      actorId: actor.id, entityType: "flow", entityId: f.id, clientId: input.clientId, flowId: f.id,
      action: "criou", summary: `Criou ${LIFECYCLE[input.lifecycle].toLowerCase()} “${input.name.trim()}”${created ? ` com ${created} tarefas do modelo` : ""}`,
      after: { baseline_version: 1, tasks: created, parent_flow_id: input.parentFlowId ?? null },
    });
    return f.id;
  };
  return txArg ? run(txArg) : sql.begin(run);
}

export async function updateFlow(actor: Actor, flowId: string, patch: Partial<Pick<FlowRow, "name" | "start_date" | "due_date" | "owner_id" | "objective" | "cycle_label" | "reference_date" | "service_id">>, reason?: string | null) {
  const f = await loadFlow(actor, flowId);
  await assertCanManageFlow(actor, f.client_id);
  const keys = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => (patch[k] ?? null) !== (f[k] ?? null));
  if (!keys.length) return;
  if (keys.includes("due_date") && f.due_date && !reason?.trim()) throw new AppError("Replanejar o prazo do fluxo exige motivo (o prazo original fica no histórico).");
  await sql.begin(async (tx) => {
    await tx`UPDATE flow_instances SET ${tx(patch as Record<string, unknown>, ...keys)}, updated_at = now() WHERE id = ${flowId}`;
    const before: Record<string, unknown> = {};
    for (const k of keys) before[k] = f[k];
    await logEvent(tx, { actorId: actor.id, entityType: "flow", entityId: flowId, clientId: f.client_id, flowId, action: keys.includes("due_date") ? "replanejou" : "editou", summary: `Atualizou o fluxo “${f.name}”`, reason, before, after: patch, relevant: false });
  });
}

/** Espera planejada do fluxo (ex.: aguardando captação agendada) — suspende alerta de inatividade. */
export async function setFlowWaiting(actor: Actor, flowId: string, waiting: boolean, reason: string | null, until: string | null) {
  const f = await loadFlow(actor, flowId);
  await assertCanManageFlow(actor, f.client_id);
  if (waiting && !reason?.trim()) throw new AppError("Informe o motivo da espera.");
  if (!["ativo", "em_espera", "planejado"].includes(f.status)) throw new AppError("Fluxo encerrado.");
  const status = waiting ? "em_espera" : "ativo";
  await sql.begin(async (tx) => {
    await tx`UPDATE flow_instances SET status = ${status}, wait_reason = ${waiting ? reason : null}, wait_until = ${waiting ? until : null}, updated_at = now() WHERE id = ${flowId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "flow", entityId: flowId, clientId: f.client_id, flowId, action: waiting ? "em_espera" : "retomou", summary: waiting ? `Colocou “${f.name}” em espera` : `Retomou “${f.name}”`, reason, before: { status: f.status }, after: { status } });
  });
}

export async function activateFlow(actor: Actor, flowId: string) {
  const f = await loadFlow(actor, flowId);
  await assertCanManageFlow(actor, f.client_id);
  if (f.status !== "planejado") return;
  await sql.begin(async (tx) => {
    await tx`UPDATE flow_instances SET status = 'ativo', updated_at = now() WHERE id = ${flowId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "flow", entityId: flowId, clientId: f.client_id, flowId, action: "ativou", summary: `Iniciou a execução de “${f.name}” (base planejada v${f.baseline_version} fixada)`, before: { status: "planejado" }, after: { status: "ativo" } });
  });
}

/**
 * Concluir fluxo exige aceite. Tarefas abertas da base precisam ser tratadas (ou confirmação explícita).
 * Implantação pode gerar acompanhamento contínuo SEM manter o projeto original aberto (AT-8 / REQ-048).
 */
export async function completeFlow(actor: Actor, flowId: string, input: { acceptanceNote: string; force?: boolean; followUpName?: string | null; followUpLifecycle?: string | null }) {
  const f = await loadFlow(actor, flowId);
  await assertCanManageFlow(actor, f.client_id);
  if (!input.acceptanceNote?.trim()) throw new AppError("Registre o aceite/critério cumprido para concluir.");
  if (["concluido", "cancelado", "arquivado"].includes(f.status)) throw new AppError("Fluxo já encerrado.");
  const open = await sql<{ title: string }[]>`SELECT title FROM tasks WHERE flow_id = ${flowId} AND deleted_at IS NULL AND in_baseline AND status NOT IN ('concluida','cancelada')`;
  if (open.length && !input.force)
    throw new AppError(`Há ${open.length} tarefa(s) da base ainda abertas (${open.slice(0, 3).map((t) => t.title).join(", ")}${open.length > 3 ? "…" : ""}). Conclua/cancele com motivo ou marque “concluir mesmo assim”.`);
  let followId: string | null = null;
  await sql.begin(async (tx) => {
    await tx`UPDATE flow_instances SET status = 'concluido', acceptance_note = ${input.acceptanceNote}, completed_at = now(), updated_at = now() WHERE id = ${flowId}`;
    await logEvent(tx, {
      actorId: actor.id, entityType: "flow", entityId: flowId, clientId: f.client_id, flowId, action: "concluiu",
      summary: `Concluiu “${f.name}”${open.length ? ` com ${open.length} tarefa(s) abertas` : ""}`, reason: input.acceptanceNote,
      before: { status: f.status }, after: { status: "concluido", open_tasks: open.length },
    });
    if (input.followUpName?.trim() && f.client_id) {
      followId = await createFlow(actor, {
        clientId: f.client_id, name: input.followUpName.trim(), lifecycle: input.followUpLifecycle || "continuo",
        serviceId: f.service_id, parentFlowId: flowId, ownerId: f.owner_id, objective: `Acompanhamento derivado de “${f.name}”`,
      }, tx);
    }
  });
  return followId;
}

export async function reopenFlow(actor: Actor, flowId: string, reason: string) {
  const f = await loadFlow(actor, flowId);
  await assertCanManageFlow(actor, f.client_id);
  if (!reason?.trim()) throw new AppError("Reabertura exige motivo.");
  if (!["concluido", "cancelado", "arquivado"].includes(f.status)) throw new AppError("Fluxo não está encerrado.");
  await sql.begin(async (tx) => {
    await tx`UPDATE flow_instances SET status = 'ativo', completed_at = NULL, updated_at = now() WHERE id = ${flowId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "flow", entityId: flowId, clientId: f.client_id, flowId, action: "reabriu", summary: `Reabriu “${f.name}”`, reason, before: { status: f.status, completed_at: f.completed_at, acceptance_note: f.acceptance_note }, after: { status: "ativo" } });
  });
}

export async function closeFlow(actor: Actor, flowId: string, status: "cancelado" | "arquivado", reason: string) {
  const f = await loadFlow(actor, flowId);
  await assertCanManageFlow(actor, f.client_id);
  if (!reason?.trim()) throw new AppError("Informe o motivo.");
  await sql.begin(async (tx) => {
    await tx`UPDATE flow_instances SET status = ${status}, updated_at = now() WHERE id = ${flowId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "flow", entityId: flowId, clientId: f.client_id, flowId, action: status, summary: `${FLOW_STATUS[status]}: “${f.name}”`, reason, before: { status: f.status }, after: { status } });
  });
}

// ───────────── Conteúdos individuais (estado editorial separado do status da tarefa) ─────────────

export async function createContent(actor: Actor, input: { flowId: string; title: string; kind?: string; script?: string | null; editorAssigneeId?: string | null; editHours?: number | null; publishHours?: number | null; editDue?: string | null; publishDue?: string | null; createTasks?: boolean; inBaseline?: boolean; baselineReason?: string | null }) {
  const f = await loadFlow(actor, input.flowId);
  await assertCanManageFlow(actor, f.client_id);
  if (!f.client_id) throw new AppError("Conteúdo precisa de cliente.");
  if (!input.title?.trim()) throw new AppError("Informe o título do conteúdo.");
  return sql.begin(async (tx) => {
    const [c] = await tx<{ id: string }[]>`
      INSERT INTO content_assets (client_id, flow_id, title, kind, script) VALUES (${f.client_id}, ${f.id}, ${input.title.trim()}, ${input.kind ?? "video"}, ${input.script ?? null}) RETURNING id`;
    await logEvent(tx, { actorId: actor.id, entityType: "content", entityId: c.id, clientId: f.client_id, flowId: f.id, action: "criou_conteudo", summary: `Criou o conteúdo “${input.title.trim()}”` });
    if (input.createTasks) {
      const base = { flowId: f.id, contentId: c.id, assigneeId: input.editorAssigneeId ?? null, inBaseline: input.inBaseline ?? true, baselineReason: input.baselineReason ?? null, origin: "manual" };
      const editId = await createTask(actor, { ...base, title: `EDIÇÃO — ${input.title.trim()}`, stage: "Edição", estHours: input.editHours ?? null, dueDate: input.editDue ?? null }, tx);
      await createTask(actor, { ...base, parentTaskId: editId, title: `PUBLICAÇÃO — ${input.title.trim()}`, stage: "Publicação", estHours: input.publishHours ?? null, dueDate: input.publishDue ?? null }, tx);
    }
    return c.id;
  });
}

/** Avança o estado editorial. Edição concluída NÃO publica: publicação é um evento separado com data própria (AT-5). */
export async function setContentState(actor: Actor, contentId: string, state: string, opts: { scheduledFor?: Date | null } = {}) {
  if (!EDITORIAL_STATE[state]) throw new AppError("Estado editorial inválido.");
  const [c] = await sql<{ id: string; client_id: string; flow_id: string | null; title: string; editorial_state: string; edited_at: Date | null }[]>`SELECT id, client_id, flow_id, title, editorial_state, edited_at FROM content_assets WHERE id = ${contentId}`;
  if (!c) throw new AppError("Conteúdo não encontrado.");
  await assertClientAccess(actor, c.client_id);
  if (c.editorial_state === state) return;
  await sql.begin(async (tx) => {
    await tx`UPDATE content_assets SET editorial_state = ${state}, updated_at = now(),
      edited_at = CASE WHEN ${state} IN ('aprovacao','agendada','postada') AND edited_at IS NULL THEN now() ELSE edited_at END,
      approved_at = CASE WHEN ${state} IN ('agendada','postada') AND approved_at IS NULL THEN now() ELSE approved_at END,
      approval_state = CASE WHEN ${state} IN ('agendada','postada') THEN 'aprovado' ELSE approval_state END,
      scheduled_for = CASE WHEN ${state} = 'agendada' THEN ${opts.scheduledFor ?? null}::timestamptz ELSE scheduled_for END,
      published_at = CASE WHEN ${state} = 'postada' THEN now() ELSE published_at END
      WHERE id = ${contentId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "content", entityId: contentId, clientId: c.client_id, flowId: c.flow_id, action: `editorial:${state}`, summary: `Conteúdo “${c.title}”: ${EDITORIAL_STATE[c.editorial_state]} → ${EDITORIAL_STATE[state]}`, before: { editorial_state: c.editorial_state }, after: { editorial_state: state } });
  });
}
