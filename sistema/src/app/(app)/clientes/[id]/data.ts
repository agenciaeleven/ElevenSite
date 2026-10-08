import { sql } from "@/lib/db";
import type { Actor } from "@/lib/auth-core";
import { flowProgress } from "@/lib/queries";
import { computeAlerts, healthOf, type Alert } from "@/lib/services/alerts";
import { dateOfInstant } from "@/lib/dates";
import type { Severity } from "@/lib/labels";

export type ClientFlow = {
  id: string; name: string; lifecycle: string; status: string; cycle_label: string | null; reference_date: string | null; start_date: string | null; due_date: string | null;
  owner_name: string | null; service_name: string | null; parent_flow_id: string | null; completed_at: Date | null; wait_reason: string | null; is_demo: boolean;
  deliverables: { id: string; name: string }[]; last_move: Date | null; open_tasks: number; plan_label: string | null;
};

export async function loadClientFlows(clientId: string) {
  return sql<ClientFlow[]>`
    SELECT f.id, f.name, f.lifecycle, f.status, f.cycle_label, f.reference_date, f.start_date, f.due_date, f.parent_flow_id, f.completed_at, f.wait_reason, f.is_demo,
           u.name AS owner_name, sv.name AS service_name, qp.label AS plan_label,
           coalesce((SELECT json_agg(json_build_object('id', d.id, 'name', d.name)) FROM flow_deliverables fd JOIN deliverables d ON d.id = fd.deliverable_id WHERE fd.flow_id = f.id), '[]') AS deliverables,
           (SELECT max(oe.occurred_at) FROM operational_events oe WHERE oe.flow_id = f.id AND oe.is_relevant) AS last_move,
           (SELECT count(*)::int FROM tasks t WHERE t.flow_id = f.id AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada')) AS open_tasks
    FROM flow_instances f LEFT JOIN users u ON u.id = f.owner_id LEFT JOIN services sv ON sv.id = f.service_id LEFT JOIN quarterly_plans qp ON qp.id = f.quarterly_plan_id
    WHERE f.client_id = ${clientId}
    ORDER BY f.status IN ('concluido','cancelado','arquivado'), coalesce(f.reference_date, f.start_date) DESC NULLS LAST, f.created_at DESC`;
}

export async function loadFlowsWithHealth(actor: Actor, clientId: string) {
  const flows = await loadClientFlows(clientId);
  const progress = await flowProgress(flows.map((f) => f.id));
  const alerts = await computeAlerts(actor, { clientId });
  const flowHealth = (id: string, status: string): { level: Severity; reasons: string[] } => {
    if (["concluido", "cancelado", "arquivado"].includes(status)) return { level: "sem_dados", reasons: ["Encerrado"] };
    const fa = alerts.filter((a) => a.flowId === id);
    return healthOf(fa, (progress.get(id)?.baselineCount ?? 0) > 0);
  };
  return { flows, progress, alerts, flowHealth };
}

export function lastMoveLabel(d: Date | null) {
  return d ? dateOfInstant(d) : null;
}

export type { Alert };
