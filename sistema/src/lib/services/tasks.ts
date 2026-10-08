import { sql, type Tx } from "../db";
import type { Actor } from "../auth-core";
import { AppError, ForbiddenError } from "../errors";
import { assertCanManageFlow, assertClientAccess, isManager, loadTaskForActor, type TaskRow } from "../access";
import { logEvent } from "../events";
import { localToInstant, today } from "../dates";
import { BLOCK_REASON, TASK_STATUS } from "../labels";

export type NewTask = {
  clientId?: string | null;
  flowId?: string | null;
  parentTaskId?: string | null;
  contentId?: string | null;
  title: string;
  description?: string | null;
  stage?: string | null;
  assigneeId?: string | null;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  estHours?: number | null;
  inBaseline?: boolean;
  baselineReason?: string | null;
  isExtra?: boolean;
  scopeClass?: string | null;
  doneCriteria?: string | null;
  origin?: string;
};

/** Instante em que algo "ocorreu": hoje → agora; data passada → 18h daquele dia (registro retrospectivo). */
export function occurredInstant(day?: string | null): Date {
  if (!day || day >= today()) return new Date();
  return localToInstant(day, "18:00");
}

export async function createTask(actor: Actor, input: NewTask, txArg?: Tx): Promise<string> {
  const title = input.title?.trim();
  if (!title) throw new AppError("Informe o título da tarefa.");
  let clientId = input.clientId ?? null;
  let flow: { id: string; client_id: string | null; status: string; baseline_version: number } | undefined;
  const db = txArg ?? sql;
  if (input.flowId) {
    [flow] = await db<{ id: string; client_id: string | null; status: string; baseline_version: number }[]>`
      SELECT id, client_id, status, baseline_version FROM flow_instances WHERE id = ${input.flowId}`;
    if (!flow) throw new AppError("Fluxo não encontrado.");
    clientId = flow.client_id;
  }
  if (input.parentTaskId) {
    const [p] = await db<{ client_id: string | null; flow_id: string | null }[]>`SELECT client_id, flow_id FROM tasks WHERE id = ${input.parentTaskId}`;
    if (!p) throw new AppError("Tarefa-mãe não encontrada.");
    clientId = clientId ?? p.client_id;
    if (!flow && p.flow_id) input.flowId = p.flow_id;
  }
  await assertClientAccess(actor, clientId);

  const manager = isManager(actor);
  let inBaseline = !!input.inBaseline && !!input.flowId;
  let isExtra = !!input.isExtra;
  let assignee = input.assigneeId ?? null;
  if (!manager) {
    // Colaborador registra demandas extraordinárias para si; não altera a base planejada.
    if (inBaseline) throw new ForbiddenError("Somente líderes incluem tarefas na base planejada do fluxo.");
    isExtra = true;
    assignee = actor.id;
  }
  const changesActiveBaseline = inBaseline && flow && flow.status !== "planejado";
  if (changesActiveBaseline && !input.baselineReason?.trim())
    throw new AppError("Incluir tarefa na base planejada de um fluxo em execução é mudança de escopo: informe o motivo/aprovação.");
  if (!inBaseline && input.flowId && !isExtra && !input.scopeClass) {
    // tarefa fora da base em fluxo: tratada como extra (conta esforço, não muda % vendido)
    isExtra = true;
  }

  const run = async (tx: Tx) => {
    const [{ pos }] = await tx<{ pos: number }[]>`SELECT coalesce(max(position), 0) + 1 AS pos FROM tasks WHERE flow_id IS NOT DISTINCT FROM ${input.flowId ?? null}`;
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO tasks (client_id, flow_id, parent_task_id, content_id, title, description, stage, position, assignee_id, priority,
                         start_date, due_date, est_hours, in_baseline, is_extra, scope_class, done_criteria, origin, created_by, is_demo)
      VALUES (${clientId}, ${input.flowId ?? null}, ${input.parentTaskId ?? null}, ${input.contentId ?? null}, ${title}, ${input.description ?? null},
              ${input.stage ?? null}, ${pos}, ${assignee}, ${input.priority ?? "normal"}, ${input.startDate ?? null}, ${input.dueDate ?? null},
              ${input.estHours ?? null}, ${inBaseline}, ${isExtra}, ${input.scopeClass ?? (isExtra ? "avaliar_escopo" : null)},
              ${input.doneCriteria ?? null}, ${input.origin ?? "manual"}, ${actor.id}, false)
      RETURNING id`;
    await logEvent(tx, {
      actorId: actor.id, entityType: "task", entityId: row.id, clientId, flowId: input.flowId ?? null, taskId: row.id,
      action: "criou", summary: `Criou a tarefa “${title}”${isExtra ? " (demanda não planejada)" : ""}`,
      after: { status: "a_fazer", in_baseline: inBaseline, est_hours: input.estHours ?? null },
    });
    if (changesActiveBaseline && flow) {
      await tx`UPDATE flow_instances SET baseline_version = baseline_version + 1, updated_at = now() WHERE id = ${flow.id}`;
      await logEvent(tx, {
        actorId: actor.id, entityType: "flow", entityId: flow.id, clientId, flowId: flow.id, taskId: row.id,
        action: "base_alterada", summary: `Base planejada alterada (v${flow.baseline_version} → v${flow.baseline_version + 1}): inclusão de “${title}”`,
        reason: input.baselineReason, before: { baseline_version: flow.baseline_version }, after: { baseline_version: flow.baseline_version + 1 },
      });
    }
    return row.id;
  };
  return txArg ? run(txArg) : sql.begin(run);
}

const MANAGER_FIELDS = ["assignee_id", "est_hours", "due_date", "start_date", "priority", "stage", "in_baseline", "scope_class", "title"] as const;

export type TaskPatch = Partial<{
  title: string;
  description: string | null;
  stage: string | null;
  assignee_id: string | null;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  est_hours: number | null;
  scope_class: string | null;
  done_criteria: string | null;
  content_id: string | null;
}>;

export async function updateTask(actor: Actor, taskId: string, patch: TaskPatch, reason?: string | null) {
  const t = await loadTaskForActor(actor, taskId);
  const keys = Object.keys(patch) as (keyof TaskPatch)[];
  const changed = keys.filter((k) => normalize(patch[k]) !== normalize((t as unknown as Record<string, unknown>)[k]));
  if (changed.length === 0) return;
  if (!isManager(actor)) {
    const forbidden = changed.filter((k) => (MANAGER_FIELDS as readonly string[]).includes(k));
    // Colaborador pode ajustar prazo/estimativa apenas das próprias demandas extras
    const ownExtra = t.is_extra && t.assignee_id === actor.id;
    if (forbidden.length && !(ownExtra && forbidden.every((k) => ["due_date", "est_hours", "title", "start_date"].includes(k))))
      throw new ForbiddenError("Colaboradores não alteram responsável, prazo, estimativa ou prioridade de tarefas planejadas. Solicite ao líder.");
  }
  if (changed.includes("est_hours") && t.in_baseline && t.status !== "a_fazer" && !reason?.trim() && t.est_hours != null)
    throw new AppError("Alterar a estimativa de tarefa da base já iniciada muda o peso do progresso: informe o motivo.");
  if (changed.includes("due_date") && t.due_date && !reason?.trim() && t.status !== "a_fazer" && t.in_baseline)
    throw new AppError("Reprogramar prazo de tarefa em execução exige motivo (histórico preservado).");
  if (patch.title !== undefined && !patch.title.trim()) throw new AppError("Título não pode ficar vazio.");

  await sql.begin(async (tx) => {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of changed) {
      before[k] = (t as unknown as Record<string, unknown>)[k];
      after[k] = patch[k];
    }
    await tx`UPDATE tasks SET ${tx(patch as Record<string, unknown>, ...changed)}, updated_at = now(), last_activity_at = now() WHERE id = ${taskId}`;
    const desc = changed.map((k) => FIELD_LABEL[k] ?? k).join(", ");
    await logEvent(tx, {
      actorId: actor.id, entityType: "task", entityId: taskId, clientId: t.client_id, flowId: t.flow_id, taskId,
      action: changed.includes("due_date") ? "prazo_alterado" : "editou",
      summary: `Alterou ${desc} de “${t.title}”`, reason, before, after,
      relevant: changed.some((k) => k === "assignee_id" || k === "due_date"),
    });
  });
}

const FIELD_LABEL: Record<string, string> = {
  title: "título", description: "descrição", stage: "etapa", assignee_id: "responsável", priority: "prioridade",
  start_date: "início", due_date: "prazo", est_hours: "horas estimadas", scope_class: "classificação de escopo",
  done_criteria: "critério de pronto", content_id: "conteúdo vinculado",
};

function normalize(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  return String(v);
}

/** Mudança simples de status (a fazer, em andamento, em revisão, concluída). Bloqueio, cancelamento e reabertura têm fluxos próprios com motivo. */
export async function changeStatus(actor: Actor, taskId: string, status: string, opts: { occurredOn?: string | null; note?: string | null } = {}) {
  if (!["a_fazer", "em_andamento", "em_revisao", "concluida"].includes(status))
    throw new AppError("Use as ações específicas para bloquear, cancelar ou reabrir (exigem motivo).");
  if (opts.occurredOn && opts.occurredOn > today()) throw new AppError("A data de ocorrência não pode estar no futuro.");
  const t = await loadTaskForActor(actor, taskId);
  if (t.status === status) return;
  if (t.status === "concluida") throw new AppError("Tarefa concluída: use “Reabrir” informando o motivo.");
  if (t.status === "cancelada") throw new AppError("Tarefa cancelada: use “Reabrir” informando o motivo.");
  if (!isManager(actor) && t.assignee_id && t.assignee_id !== actor.id)
    throw new ForbiddenError("Esta tarefa é de outro responsável. Peça ao líder para redistribuir.");

  const occurred = occurredInstant(opts.occurredOn);
  await sql.begin(async (tx) => {
    if (t.status === "bloqueada") {
      await tx`UPDATE blockers SET resolved_at = now(), resolved_by = ${actor.id}, resolution = coalesce(resolution, ${"Desbloqueada ao mudar status para " + TASK_STATUS[status]}) WHERE task_id = ${taskId} AND resolved_at IS NULL`;
    }
    if (status === "concluida") {
      await tx`UPDATE tasks SET status = 'concluida', completed_at = ${occurred}, completed_recorded_at = now(), updated_at = now(), last_activity_at = now() WHERE id = ${taskId}`;
    } else {
      await tx`UPDATE tasks SET status = ${status}, updated_at = now(), last_activity_at = now(),
                start_date = CASE WHEN ${status} = 'em_andamento' AND start_date IS NULL THEN ${today()}::date ELSE start_date END
               WHERE id = ${taskId}`;
    }
    const verb: Record<string, string> = { a_fazer: "Voltou para “a fazer”", em_andamento: "Começou", em_revisao: "Enviou para revisão", concluida: "Concluiu" };
    await logEvent(tx, {
      actorId: actor.id, entityType: "task", entityId: taskId, clientId: t.client_id, flowId: t.flow_id, taskId,
      action: `status:${status}`, summary: `${verb[status]} “${t.title}”`, reason: opts.note ?? null,
      before: { status: t.status }, after: { status }, occurredAt: occurred,
    });
  });
}

export async function blockTask(actor: Actor, taskId: string, input: { category: string; comment?: string | null; releaseOwner?: string | null; expectedResolution?: string | null; link?: string | null }) {
  if (!BLOCK_REASON[input.category]) throw new AppError("Escolha a categoria do motivo do bloqueio.");
  if (input.category === "outro" && !input.comment?.trim()) throw new AppError("Descreva o motivo do bloqueio.");
  const t = await loadTaskForActor(actor, taskId);
  if (["concluida", "cancelada"].includes(t.status)) throw new AppError("Não é possível bloquear tarefa encerrada.");
  await sql.begin(async (tx) => {
    await tx`UPDATE blockers SET resolved_at = now(), resolved_by = ${actor.id}, resolution = 'Substituído por novo bloqueio' WHERE task_id = ${taskId} AND resolved_at IS NULL`;
    const [b] = await tx<{ id: string }[]>`
      INSERT INTO blockers (task_id, client_id, flow_id, reason_category, comment, release_owner, expected_resolution, link, opened_by)
      VALUES (${taskId}, ${t.client_id}, ${t.flow_id}, ${input.category}, ${input.comment ?? null}, ${input.releaseOwner ?? null}, ${input.expectedResolution ?? null}, ${input.link ?? null}, ${actor.id})
      RETURNING id`;
    await tx`UPDATE tasks SET status = 'bloqueada', updated_at = now(), last_activity_at = now() WHERE id = ${taskId}`;
    await logEvent(tx, {
      actorId: actor.id, entityType: "task", entityId: taskId, clientId: t.client_id, flowId: t.flow_id, taskId,
      action: "bloqueou", summary: `Bloqueou “${t.title}” — ${BLOCK_REASON[input.category]}`, reason: input.comment ?? null,
      before: { status: t.status }, after: { status: "bloqueada", blocker_id: b.id, release_owner: input.releaseOwner, expected_resolution: input.expectedResolution },
    });
  });
}

export async function resolveBlocker(actor: Actor, blockerId: string, resolution: string, nextStatus = "em_andamento") {
  const [b] = await sql<{ id: string; task_id: string; resolved_at: Date | null }[]>`SELECT id, task_id, resolved_at FROM blockers WHERE id = ${blockerId}`;
  if (!b) throw new AppError("Bloqueio não encontrado.");
  if (b.resolved_at) throw new AppError("Este bloqueio já foi resolvido.");
  if (!resolution?.trim()) throw new AppError("Descreva como o bloqueio foi resolvido.");
  if (!["a_fazer", "em_andamento", "em_revisao"].includes(nextStatus)) throw new AppError("Status inválido após desbloqueio.");
  const t = await loadTaskForActor(actor, b.task_id);
  await sql.begin(async (tx) => {
    await tx`UPDATE blockers SET resolved_at = now(), resolved_by = ${actor.id}, resolution = ${resolution} WHERE id = ${blockerId}`;
    await tx`UPDATE tasks SET status = ${nextStatus}, updated_at = now(), last_activity_at = now() WHERE id = ${t.id} AND status = 'bloqueada'`;
    await logEvent(tx, {
      actorId: actor.id, entityType: "blocker", entityId: blockerId, clientId: t.client_id, flowId: t.flow_id, taskId: t.id,
      action: "desbloqueou", summary: `Desbloqueou “${t.title}”`, reason: resolution, before: { status: "bloqueada" }, after: { status: nextStatus },
    });
  });
}

export async function cancelTask(actor: Actor, taskId: string, reason: string, treatment: "remover_da_base" | "manter_na_base") {
  if (!reason?.trim()) throw new AppError("Cancelamento exige motivo.");
  if (!["remover_da_base", "manter_na_base"].includes(treatment)) throw new AppError("Defina o tratamento no escopo (remover da base ou manter pendente).");
  const t = await loadTaskForActor(actor, taskId);
  if (!isManager(actor) && !(t.is_extra && t.assignee_id === actor.id))
    throw new ForbiddenError("Apenas líderes cancelam tarefas planejadas. Use “Bloquear” para sinalizar o problema.");
  if (t.status === "cancelada") throw new AppError("Tarefa já cancelada.");
  await sql.begin(async (tx) => {
    await tx`UPDATE blockers SET resolved_at = now(), resolved_by = ${actor.id}, resolution = 'Tarefa cancelada' WHERE task_id = ${taskId} AND resolved_at IS NULL`;
    await tx`UPDATE tasks SET status = 'cancelada', cancel_reason = ${reason}, cancel_scope_treatment = ${treatment}, updated_at = now(), last_activity_at = now() WHERE id = ${taskId}`;
    await logEvent(tx, {
      actorId: actor.id, entityType: "task", entityId: taskId, clientId: t.client_id, flowId: t.flow_id, taskId,
      action: "cancelou", summary: `Cancelou “${t.title}” (${treatment === "remover_da_base" ? "removida da base planejada" : "mantida na base como pendente"})`,
      reason, before: { status: t.status, in_baseline: t.in_baseline }, after: { status: "cancelada", cancel_scope_treatment: treatment },
    });
  });
}

/** Reabertura: gera auditoria, preserva a conclusão anterior no histórico e recalcula indicadores (AT-18). */
export async function reopenTask(actor: Actor, taskId: string, reason: string) {
  if (!reason?.trim()) throw new AppError("Reabertura exige motivo.");
  const t = await loadTaskForActor(actor, taskId);
  if (!["concluida", "cancelada"].includes(t.status)) throw new AppError("Somente tarefas concluídas ou canceladas podem ser reabertas.");
  if (!isManager(actor) && t.assignee_id !== actor.id) throw new ForbiddenError();
  await sql.begin(async (tx) => {
    await tx`UPDATE tasks SET status = 'em_andamento', completed_at = NULL, completed_recorded_at = NULL, cancel_reason = NULL, cancel_scope_treatment = NULL,
              reopened_count = reopened_count + 1, updated_at = now(), last_activity_at = now() WHERE id = ${taskId}`;
    await logEvent(tx, {
      actorId: actor.id, entityType: "task", entityId: taskId, clientId: t.client_id, flowId: t.flow_id, taskId,
      action: "reabriu", summary: `Reabriu “${t.title}”`, reason,
      before: { status: t.status, completed_at: t.completed_at, cancel_reason: t.cancel_reason, cancel_scope_treatment: t.cancel_scope_treatment },
      after: { status: "em_andamento" },
    });
  });
}

/** Espera planejada: evita alerta de inatividade enquanto aguarda data/aprovação legítima. */
export async function setWaiting(actor: Actor, taskId: string, until: string | null, reason: string | null) {
  const t = await loadTaskForActor(actor, taskId);
  if (until && !reason?.trim()) throw new AppError("Informe o motivo da espera.");
  await sql.begin(async (tx) => {
    await tx`UPDATE tasks SET waiting_until = ${until}, waiting_reason = ${until ? reason : null}, updated_at = now() WHERE id = ${taskId}`;
    await logEvent(tx, {
      actorId: actor.id, entityType: "task", entityId: taskId, clientId: t.client_id, flowId: t.flow_id, taskId,
      action: until ? "espera" : "fim_espera", summary: until ? `Marcou espera planejada até ${until} em “${t.title}”` : `Encerrou espera planejada de “${t.title}”`,
      reason, relevant: false,
    });
  });
}

export async function setBaseline(actor: Actor, taskId: string, inBaseline: boolean, reason: string) {
  const t = await loadTaskForActor(actor, taskId);
  await assertCanManageFlow(actor, t.client_id);
  if (!t.flow_id) throw new AppError("Apenas tarefas de fluxo têm base planejada.");
  if (!reason?.trim()) throw new AppError("Mudança na base planejada exige motivo/aprovação.");
  if (t.in_baseline === inBaseline) return;
  await sql.begin(async (tx) => {
    const [f] = await tx<{ baseline_version: number }[]>`UPDATE flow_instances SET baseline_version = baseline_version + 1, updated_at = now() WHERE id = ${t.flow_id} RETURNING baseline_version`;
    await tx`UPDATE tasks SET in_baseline = ${inBaseline}, is_extra = ${!inBaseline && t.is_extra}, scope_class = CASE WHEN ${inBaseline} AND is_extra THEN 'escopo_adicional_aprovado' ELSE scope_class END, updated_at = now() WHERE id = ${taskId}`;
    await logEvent(tx, {
      actorId: actor.id, entityType: "flow", entityId: t.flow_id, clientId: t.client_id, flowId: t.flow_id, taskId,
      action: "base_alterada", summary: `${inBaseline ? "Incluiu" : "Retirou"} “${t.title}” ${inBaseline ? "na" : "da"} base planejada (v${f.baseline_version})`,
      reason, before: { in_baseline: t.in_baseline }, after: { in_baseline: inBaseline, baseline_version: f.baseline_version },
    });
  });
}

export async function addEvidence(actor: Actor, taskId: string, url: string | null, note: string | null) {
  if (!url?.trim() && !note?.trim()) throw new AppError("Informe um link ou uma observação.");
  const t = await loadTaskForActor(actor, taskId);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO task_evidence (task_id, url, note, created_by) VALUES (${taskId}, ${url || null}, ${note || null}, ${actor.id})`;
    await tx`UPDATE tasks SET last_activity_at = now() WHERE id = ${taskId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "task", entityId: taskId, clientId: t.client_id, flowId: t.flow_id, taskId, action: "evidencia", summary: `Anexou evidência em “${t.title}”`, after: { url, note } });
  });
}

/** Horas reais: só para consumo de capacidade — nunca alteram o percentual de progresso. */
export async function addTimeEntry(actor: Actor, input: { taskId?: string | null; clientId?: string | null; hours: number; occurredOn: string; note?: string | null }) {
  if (!(input.hours > 0) || input.hours > 24) throw new AppError("Informe horas entre 0 e 24.");
  if (input.occurredOn > today()) throw new AppError("Não é possível apontar horas no futuro.");
  let clientId = input.clientId ?? null;
  let t: TaskRow | null = null;
  if (input.taskId) {
    t = await loadTaskForActor(actor, input.taskId);
    clientId = t.client_id;
  } else await assertClientAccess(actor, clientId);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO time_entries (user_id, task_id, client_id, hours, occurred_on, note) VALUES (${actor.id}, ${input.taskId ?? null}, ${clientId}, ${input.hours}, ${input.occurredOn}, ${input.note ?? null})`;
    await logEvent(tx, {
      actorId: actor.id, entityType: "task", entityId: input.taskId ?? null, clientId, flowId: t?.flow_id ?? null, taskId: input.taskId ?? null,
      action: "apontou_horas", summary: `Apontou ${input.hours}h${t ? ` em “${t.title}”` : ""}`, occurredAt: occurredInstant(input.occurredOn), relevant: false,
    });
  });
}

export async function updateChecklist(actor: Actor, taskId: string, op: { add?: string; toggle?: number; remove?: number }) {
  const t = await loadTaskForActor(actor, taskId);
  const list = [...(t.checklist ?? [])];
  if (op.add?.trim()) list.push({ text: op.add.trim(), done: false });
  if (op.toggle != null && list[op.toggle]) list[op.toggle] = { ...list[op.toggle], done: !list[op.toggle].done };
  if (op.remove != null) list.splice(op.remove, 1);
  await sql`UPDATE tasks SET checklist = ${sql.json(list)}, updated_at = now(), last_activity_at = now() WHERE id = ${taskId}`;
}

export async function addDependency(actor: Actor, taskId: string, dependsOnId: string) {
  const t = await loadTaskForActor(actor, taskId);
  await assertCanManageFlow(actor, t.client_id);
  if (taskId === dependsOnId) throw new AppError("Uma tarefa não depende de si mesma.");
  await loadTaskForActor(actor, dependsOnId);
  await sql`INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (${taskId}, ${dependsOnId}) ON CONFLICT DO NOTHING`;
}

export async function removeDependency(actor: Actor, taskId: string, dependsOnId: string) {
  const t = await loadTaskForActor(actor, taskId);
  await assertCanManageFlow(actor, t.client_id);
  await sql`DELETE FROM task_dependencies WHERE task_id = ${taskId} AND depends_on_id = ${dependsOnId}`;
}

export async function deleteTask(actor: Actor, taskId: string, reason: string) {
  const t = await loadTaskForActor(actor, taskId);
  await assertCanManageFlow(actor, t.client_id);
  if (!reason?.trim()) throw new AppError("Exclusão exige motivo (registro preservado para auditoria).");
  await sql.begin(async (tx) => {
    await tx`UPDATE tasks SET deleted_at = now() WHERE id = ${taskId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "task", entityId: taskId, clientId: t.client_id, flowId: t.flow_id, taskId, action: "excluiu", summary: `Excluiu “${t.title}” (lançamento indevido)`, reason, before: { status: t.status } });
  });
}
