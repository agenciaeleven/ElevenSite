// Controle de acesso aplicado no servidor (toda leitura e escrita passa por aqui).
// • Admin/Direção: toda a agência.
// • Líder: clientes dos squads que lidera ou integra + clientes onde tem tarefas.
// • Colaborador: clientes dos seus squads + clientes onde tem tarefas; executa e registra, não altera contrato/estratégia.
import { sql } from "./db";
import type { Actor } from "./auth-core";
import { ForbiddenError, AppError } from "./errors";

export type ClientScope = "all" | string[];

export async function clientScope(actor: Actor): Promise<ClientScope> {
  if (actor.role === "admin") return "all";
  const rows = await sql<{ id: string }[]>`
    SELECT c.id FROM clients c
    WHERE c.deleted_at IS NULL AND (
      c.is_internal
      OR c.id IN (SELECT cs.client_id FROM client_squads cs
                  JOIN squads s ON s.id = cs.squad_id
                  LEFT JOIN squad_members sm ON sm.squad_id = s.id AND sm.user_id = ${actor.id}
                  WHERE s.leader_id = ${actor.id} OR sm.user_id IS NOT NULL)
      OR c.id IN (SELECT t.client_id FROM tasks t WHERE t.assignee_id = ${actor.id} AND t.deleted_at IS NULL AND t.client_id IS NOT NULL)
    )`;
  return rows.map((r) => r.id);
}

export function inScope(scope: ClientScope, clientId: string | null | undefined) {
  if (scope === "all") return true;
  if (!clientId) return true; // tarefas internas sem cliente
  return scope.includes(clientId);
}

/** Filtro SQL: retorna array de ids ou null (= todos). Use com `client_id = ANY(...)`. */
export function scopeIds(scope: ClientScope): string[] | null {
  return scope === "all" ? null : scope;
}

export async function assertClientAccess(actor: Actor, clientId: string | null | undefined) {
  if (!clientId) return;
  const scope = await clientScope(actor);
  if (!inScope(scope, clientId)) throw new ForbiddenError("Você não tem acesso a este cliente.");
}

export function isManager(actor: Actor) {
  return actor.role === "admin" || actor.role === "lider";
}

export function assertManager(actor: Actor, msg = "Apenas líderes e direção podem fazer isso.") {
  if (!isManager(actor)) throw new ForbiddenError(msg);
}

export function assertAdmin(actor: Actor, msg = "Apenas a direção (admin) pode fazer isso.") {
  if (actor.role !== "admin") throw new ForbiddenError(msg);
}

/** Contrato, serviços e entregáveis vendidos: somente direção. */
export const assertCanEditScope = (a: Actor) => assertAdmin(a, "Somente a direção pode alterar contrato, serviços e entregáveis vendidos.");

/** Bússola/trimestre/decisões estratégicas: direção ou líder com acesso ao cliente. */
export async function assertCanEditStrategy(a: Actor, clientId: string) {
  assertManager(a, "Colaboradores não alteram Bússola, metas ou planejamento estratégico.");
  await assertClientAccess(a, clientId);
}

/** Estrutura de fluxos (criar, base planejada, concluir, estimativas, responsáveis). */
export async function assertCanManageFlow(a: Actor, clientId: string | null) {
  assertManager(a, "Apenas líderes e direção estruturam fluxos e redistribuem tarefas.");
  await assertClientAccess(a, clientId);
}

export async function loadTaskForActor(actor: Actor, taskId: string) {
  const [t] = await sql<TaskRow[]>`SELECT * FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL`;
  if (!t) throw new AppError("Tarefa não encontrada.");
  if (!t.client_id) {
    if (!isManager(actor) && t.assignee_id !== actor.id && t.created_by !== actor.id) throw new ForbiddenError();
  } else {
    await assertClientAccess(actor, t.client_id);
  }
  return t;
}

export type TaskRow = {
  id: string;
  client_id: string | null;
  flow_id: string | null;
  parent_task_id: string | null;
  content_id: string | null;
  title: string;
  description: string | null;
  stage: string | null;
  position: number;
  assignee_id: string | null;
  status: string;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  est_hours: number | null;
  in_baseline: boolean;
  is_extra: boolean;
  scope_class: string | null;
  waiting_until: string | null;
  waiting_reason: string | null;
  done_criteria: string | null;
  checklist: { text: string; done: boolean }[];
  completed_at: Date | null;
  completed_recorded_at: Date | null;
  cancel_reason: string | null;
  cancel_scope_treatment: string | null;
  reopened_count: number;
  last_activity_at: Date;
  origin: string;
  is_demo: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};
