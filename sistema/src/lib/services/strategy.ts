// Bússola (direção estratégica), oportunidades e Planejamento Trimestral — base P0 (CRUD + vínculos).
// Regras: objetivo da Bússola não cria compromisso contratual; oportunidade não aprovada não gera execução.
import { sql } from "../db";
import type { Actor } from "../auth-core";
import { AppError } from "../errors";
import { assertCanEditStrategy } from "../access";
import { logEvent } from "../events";
import { INITIATIVE_STATUS, OPPORTUNITY_STATUS } from "../labels";
import { createFlow } from "./flows";

export async function saveCompass(actor: Actor, clientId: string, input: { diagnosis?: string | null; audience?: string | null; positioning?: string | null; guidelines?: string | null; hypotheses?: string | null; newVersion?: boolean }) {
  await assertCanEditStrategy(actor, clientId);
  const [cur] = await sql<{ id: string; version: number }[]>`SELECT id, version FROM strategic_compasses WHERE client_id = ${clientId} AND status = 'vigente' ORDER BY version DESC LIMIT 1`;
  return sql.begin(async (tx) => {
    if (cur && !input.newVersion) {
      await tx`UPDATE strategic_compasses SET diagnosis = ${input.diagnosis ?? null}, audience = ${input.audience ?? null}, positioning = ${input.positioning ?? null}, guidelines = ${input.guidelines ?? null}, hypotheses = ${input.hypotheses ?? null} WHERE id = ${cur.id}`;
      await logEvent(tx, { actorId: actor.id, entityType: "compass", entityId: cur.id, clientId, action: "editou_bussola", summary: `Atualizou a Bússola v${cur.version}`, relevant: false });
      return cur.id;
    }
    // Nova versão: preserva a anterior (substituída) e copia objetivos/frentes (REQ-008)
    const version = (cur?.version ?? 0) + 1;
    if (cur) await tx`UPDATE strategic_compasses SET status = 'substituida' WHERE id = ${cur.id}`;
    const [n] = await tx<{ id: string }[]>`
      INSERT INTO strategic_compasses (client_id, version, status, diagnosis, audience, positioning, guidelines, hypotheses, created_by)
      VALUES (${clientId}, ${version}, 'vigente', ${input.diagnosis ?? null}, ${input.audience ?? null}, ${input.positioning ?? null}, ${input.guidelines ?? null}, ${input.hypotheses ?? null}, ${actor.id}) RETURNING id`;
    if (cur) {
      const objs = await tx<{ id: string; code: string | null; title: string; description: string | null; position: number }[]>`SELECT * FROM strategic_objectives WHERE compass_id = ${cur.id}`;
      for (const o of objs) {
        const [no] = await tx<{ id: string }[]>`INSERT INTO strategic_objectives (compass_id, code, title, description, position) VALUES (${n.id}, ${o.code}, ${o.title}, ${o.description}, ${o.position}) RETURNING id`;
        await tx`INSERT INTO strategic_fronts (objective_id, title, description, position) SELECT ${no.id}, title, description, position FROM strategic_fronts WHERE objective_id = ${o.id}`;
        await tx`UPDATE kpi_definitions SET objective_id = ${no.id} WHERE objective_id = ${o.id}`;
        await tx`INSERT INTO initiative_objectives (initiative_id, objective_id) SELECT initiative_id, ${no.id} FROM initiative_objectives WHERE objective_id = ${o.id} ON CONFLICT DO NOTHING`;
      }
    }
    await logEvent(tx, { actorId: actor.id, entityType: "compass", entityId: n.id, clientId, action: "versao_bussola", summary: `Criou a Bússola v${version}${cur ? ` (v${cur.version} preservada)` : ""}` });
    return n.id;
  });
}

export async function saveObjective(actor: Actor, input: { id?: string | null; compassId: string; clientId: string; code?: string | null; title: string; description?: string | null }) {
  await assertCanEditStrategy(actor, input.clientId);
  if (!input.title?.trim()) throw new AppError("Informe o objetivo.");
  if (input.id) {
    await sql`UPDATE strategic_objectives SET code = ${input.code ?? null}, title = ${input.title.trim()}, description = ${input.description ?? null} WHERE id = ${input.id}`;
    return input.id;
  }
  const [{ pos }] = await sql<{ pos: number }[]>`SELECT coalesce(max(position), 0) + 1 AS pos FROM strategic_objectives WHERE compass_id = ${input.compassId}`;
  const [o] = await sql<{ id: string }[]>`INSERT INTO strategic_objectives (compass_id, code, title, description, position) VALUES (${input.compassId}, ${input.code ?? null}, ${input.title.trim()}, ${input.description ?? null}, ${pos}) RETURNING id`;
  return o.id;
}

export async function deleteObjective(actor: Actor, clientId: string, id: string) {
  await assertCanEditStrategy(actor, clientId);
  await sql`DELETE FROM strategic_objectives WHERE id = ${id}`;
}

export async function saveFront(actor: Actor, input: { clientId: string; objectiveId: string; title: string; description?: string | null }) {
  await assertCanEditStrategy(actor, input.clientId);
  if (!input.title?.trim()) throw new AppError("Informe a frente.");
  await sql`INSERT INTO strategic_fronts (objective_id, title, description, position) VALUES (${input.objectiveId}, ${input.title.trim()}, ${input.description ?? null}, (SELECT coalesce(max(position),0)+1 FROM strategic_fronts WHERE objective_id = ${input.objectiveId}))`;
}

export async function deleteFront(actor: Actor, clientId: string, id: string) {
  await assertCanEditStrategy(actor, clientId);
  await sql`DELETE FROM strategic_fronts WHERE id = ${id}`;
}

// ───────────── Oportunidades (REQ-038/041/057) ─────────────

export async function createOpportunity(actor: Actor, input: { clientId: string; objectiveId?: string | null; title: string; description?: string | null; origin?: string | null }) {
  await assertCanEditStrategy(actor, input.clientId);
  if (!input.title?.trim()) throw new AppError("Descreva a oportunidade.");
  const [o] = await sql<{ id: string }[]>`INSERT INTO strategic_opportunities (client_id, objective_id, title, description, origin) VALUES (${input.clientId}, ${input.objectiveId ?? null}, ${input.title.trim()}, ${input.description ?? null}, ${input.origin ?? null}) RETURNING id`;
  await logEvent(sql, { actorId: actor.id, entityType: "opportunity", entityId: o.id, clientId: input.clientId, action: "registrou_oportunidade", summary: `Registrou oportunidade: ${input.title.trim()}`, relevant: false });
  return o.id;
}

export async function setOpportunityStatus(actor: Actor, id: string, status: string, note: string | null, scopeCheck: string | null) {
  if (!OPPORTUNITY_STATUS[status]) throw new AppError("Status inválido.");
  const [o] = await sql<{ client_id: string; title: string; status: string }[]>`SELECT client_id, title, status FROM strategic_opportunities WHERE id = ${id}`;
  if (!o) throw new AppError("Oportunidade não encontrada.");
  await assertCanEditStrategy(actor, o.client_id);
  if (["aprovada", "recusada"].includes(status) && !note?.trim()) throw new AppError("Registre a justificativa da decisão.");
  if (status === "aprovada" && !scopeCheck) throw new AppError("Indique a verificação de escopo (dentro do escopo, avaliar ou adicional aprovado).");
  await sql`UPDATE strategic_opportunities SET status = ${status}, decision_note = coalesce(${note}, decision_note), scope_check = coalesce(${scopeCheck}, scope_check),
            decided_by = CASE WHEN ${status} IN ('aprovada','recusada') THEN ${actor.id}::uuid ELSE decided_by END,
            decided_at = CASE WHEN ${status} IN ('aprovada','recusada') THEN now() ELSE decided_at END WHERE id = ${id}`;
  await logEvent(sql, { actorId: actor.id, entityType: "opportunity", entityId: id, clientId: o.client_id, action: "decidiu_oportunidade", summary: `Oportunidade “${o.title}”: ${OPPORTUNITY_STATUS[o.status]} → ${OPPORTUNITY_STATUS[status]}`, reason: note, relevant: false });
}

export async function convertOpportunity(actor: Actor, id: string, input: { name: string; lifecycle: string; templateId?: string | null; startDate?: string | null; dueDate?: string | null }) {
  const [o] = await sql<{ client_id: string; title: string; status: string; converted_flow_id: string | null }[]>`SELECT client_id, title, status, converted_flow_id FROM strategic_opportunities WHERE id = ${id}`;
  if (!o) throw new AppError("Oportunidade não encontrada.");
  await assertCanEditStrategy(actor, o.client_id);
  if (o.status !== "aprovada") throw new AppError("Somente oportunidades aprovadas viram execução.");
  if (o.converted_flow_id) throw new AppError("Esta oportunidade já gerou um fluxo.");
  const flowId = await createFlow(actor, { clientId: o.client_id, name: input.name || o.title, lifecycle: input.lifecycle, templateId: input.templateId, startDate: input.startDate, dueDate: input.dueDate, objective: `Origem: oportunidade “${o.title}”`, status: "planejado" });
  await sql`UPDATE strategic_opportunities SET converted_flow_id = ${flowId} WHERE id = ${id}`;
  return flowId;
}

// ───────────── Planejamento Trimestral (Mês 1 / 2 / 3) ─────────────

export async function savePlan(actor: Actor, input: { id?: string | null; clientId: string; label: string; startDate: string; endDate: string; status?: string; month1?: string | null; month2?: string | null; month3?: string | null; closingNotes?: string | null }) {
  await assertCanEditStrategy(actor, input.clientId);
  if (!input.label?.trim() || !input.startDate || !input.endDate) throw new AppError("Informe rótulo e período do trimestre.");
  if (input.id) {
    await sql`UPDATE quarterly_plans SET label = ${input.label.trim()}, start_date = ${input.startDate}, end_date = ${input.endDate}, status = ${input.status ?? "em_planejamento"},
              month1_focus = ${input.month1 ?? null}, month2_focus = ${input.month2 ?? null}, month3_focus = ${input.month3 ?? null}, closing_notes = ${input.closingNotes ?? null} WHERE id = ${input.id}`;
    return input.id;
  }
  const [cmp] = await sql<{ id: string }[]>`SELECT id FROM strategic_compasses WHERE client_id = ${input.clientId} AND status = 'vigente' ORDER BY version DESC LIMIT 1`;
  const [p] = await sql<{ id: string }[]>`
    INSERT INTO quarterly_plans (client_id, compass_id, label, start_date, end_date, status, month1_focus, month2_focus, month3_focus)
    VALUES (${input.clientId}, ${cmp?.id ?? null}, ${input.label.trim()}, ${input.startDate}, ${input.endDate}, ${input.status ?? "em_planejamento"}, ${input.month1 ?? null}, ${input.month2 ?? null}, ${input.month3 ?? null}) RETURNING id`;
  await logEvent(sql, { actorId: actor.id, entityType: "plan", entityId: p.id, clientId: input.clientId, action: "criou_trimestre", summary: `Criou o planejamento ${input.label.trim()} (referenciando a Bússola vigente, sem copiá-la)`, relevant: false });
  return p.id;
}

export async function saveInitiative(actor: Actor, input: { id?: string | null; planId: string; clientId: string; title: string; kind: string; monthIndex?: number | null; status?: string; scopeCheck?: string | null; conditionalNote?: string | null; objectiveIds?: string[] }) {
  await assertCanEditStrategy(actor, input.clientId);
  if (!input.title?.trim()) throw new AppError("Descreva a iniciativa.");
  if (input.status && !INITIATIVE_STATUS[input.status]) throw new AppError("Status inválido.");
  if (input.status === "aprovada" && !input.scopeCheck) throw new AppError("Para aprovar, indique a verificação de escopo contratado.");
  return sql.begin(async (tx) => {
    let id = input.id;
    if (id) {
      await tx`UPDATE initiatives SET title = ${input.title.trim()}, kind = ${input.kind}, month_index = ${input.monthIndex ?? null}, status = ${input.status ?? "proposta"}, scope_check = ${input.scopeCheck ?? null}, conditional_note = ${input.conditionalNote ?? null} WHERE id = ${id}`;
    } else {
      [{ id }] = await tx<{ id: string }[]>`
        INSERT INTO initiatives (plan_id, client_id, title, kind, month_index, status, scope_check, conditional_note)
        VALUES (${input.planId}, ${input.clientId}, ${input.title.trim()}, ${input.kind}, ${input.monthIndex ?? null}, ${input.status ?? "proposta"}, ${input.scopeCheck ?? null}, ${input.conditionalNote ?? null}) RETURNING id`;
    }
    if (input.objectiveIds) {
      await tx`DELETE FROM initiative_objectives WHERE initiative_id = ${id!}`;
      for (const o of input.objectiveIds) await tx`INSERT INTO initiative_objectives (initiative_id, objective_id) VALUES (${id!}, ${o})`;
    }
    await logEvent(tx, { actorId: actor.id, entityType: "initiative", entityId: id!, clientId: input.clientId, action: "salvou_iniciativa", summary: `Iniciativa “${input.title.trim()}” — ${INITIATIVE_STATUS[input.status ?? "proposta"]}`, relevant: false });
    return id!;
  });
}

/** Iniciativa aprovada vira projeto/fluxo rastreável (REQ-044/057). */
export async function initiativeToFlow(actor: Actor, initiativeId: string, input: { name?: string | null; lifecycle: string; templateId?: string | null; startDate?: string | null; dueDate?: string | null; existingFlowId?: string | null }) {
  const [i] = await sql<{ client_id: string; plan_id: string; title: string; status: string; flow_id: string | null }[]>`SELECT client_id, plan_id, title, status, flow_id FROM initiatives WHERE id = ${initiativeId}`;
  if (!i) throw new AppError("Iniciativa não encontrada.");
  await assertCanEditStrategy(actor, i.client_id);
  if (!["aprovada", "em_execucao"].includes(i.status)) throw new AppError("Somente iniciativas aprovadas viram execução.");
  if (i.flow_id) throw new AppError("Iniciativa já vinculada a um fluxo.");
  let flowId = input.existingFlowId ?? null;
  if (!flowId) flowId = await createFlow(actor, { clientId: i.client_id, name: input.name || i.title, lifecycle: input.lifecycle, templateId: input.templateId, planId: i.plan_id, startDate: input.startDate, dueDate: input.dueDate, objective: `Iniciativa do trimestre: ${i.title}`, status: "planejado" });
  await sql`UPDATE initiatives SET flow_id = ${flowId}, status = 'em_execucao' WHERE id = ${initiativeId}`;
  return flowId;
}
