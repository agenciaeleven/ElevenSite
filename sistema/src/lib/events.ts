import type { Tx } from "./db";

export type OpEvent = {
  actorId: string | null;
  entityType: "task" | "flow" | "client" | "event" | "content" | "blocker" | "report" | "decision" | "opportunity" | "compass" | "contract" | "deliverable" | "service" | "manual" | "plan" | "initiative" | "user" | "squad" | "justification" | "intervention";
  entityId?: string | null;
  clientId?: string | null;
  flowId?: string | null;
  taskId?: string | null;
  action: string;
  summary: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  occurredAt?: Date | null;
  relevant?: boolean;
  isDemo?: boolean;
};

/** Registra evento auditável: quem, quando registrou, quando ocorreu, o quê, antes/depois e motivo. */
export async function logEvent(tx: Tx, e: OpEvent) {
  await tx`
    INSERT INTO operational_events (actor_id, occurred_at, entity_type, entity_id, client_id, flow_id, task_id, action, summary, reason, before, after, is_relevant, is_demo)
    VALUES (${e.actorId}, ${e.occurredAt ?? new Date()}, ${e.entityType}, ${e.entityId ?? null}, ${e.clientId ?? null}, ${e.flowId ?? null}, ${e.taskId ?? null},
            ${e.action}, ${e.summary}, ${e.reason ?? null},
            ${e.before === undefined ? null : tx.json(e.before as never)}, ${e.after === undefined ? null : tx.json(e.after as never)},
            ${e.relevant ?? true}, ${e.isDemo ?? false})`;
}
