import { sql } from "../db";
import type { Actor } from "../auth-core";
import { AppError } from "../errors";
import { assertAdmin, assertCanEditScope, assertClientAccess, assertManager } from "../access";
import { logEvent } from "../events";
import { CLIENT_STATUS, PERIODICITY, SERVICE_KIND } from "../labels";

export type ClientInput = {
  name: string;
  status?: string;
  segment?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  accountOwnerId?: string | null;
  internalNotes?: string | null;
  squadIds?: string[];
};

export async function createClient(actor: Actor, input: ClientInput) {
  assertAdmin(actor, "Somente a direção cadastra clientes.");
  if (!input.name?.trim()) throw new AppError("Informe o nome do cliente.");
  if (input.status && !CLIENT_STATUS[input.status]) throw new AppError("Situação inválida.");
  return sql.begin(async (tx) => {
    const [c] = await tx<{ id: string }[]>`
      INSERT INTO clients (name, status, segment, contact_name, contact_email, account_owner_id, internal_notes)
      VALUES (${input.name.trim()}, ${input.status ?? "onboarding"}, ${input.segment ?? null}, ${input.contactName ?? null}, ${input.contactEmail ?? null}, ${input.accountOwnerId ?? null}, ${input.internalNotes ?? null})
      RETURNING id`;
    for (const s of input.squadIds ?? []) await tx`INSERT INTO client_squads (client_id, squad_id) VALUES (${c.id}, ${s})`;
    await logEvent(tx, { actorId: actor.id, entityType: "client", entityId: c.id, clientId: c.id, action: "criou", summary: `Cadastrou o cliente “${input.name.trim()}”` });
    return c.id;
  });
}

export async function updateClient(actor: Actor, clientId: string, input: ClientInput) {
  assertManager(actor);
  await assertClientAccess(actor, clientId);
  if (!input.name?.trim()) throw new AppError("Informe o nome do cliente.");
  const [before] = await sql`SELECT name, status, segment, contact_name, contact_email, account_owner_id FROM clients WHERE id = ${clientId}`;
  await sql.begin(async (tx) => {
    await tx`UPDATE clients SET name = ${input.name.trim()}, status = ${input.status ?? "ativo"}, segment = ${input.segment ?? null}, contact_name = ${input.contactName ?? null},
             contact_email = ${input.contactEmail ?? null}, account_owner_id = ${input.accountOwnerId ?? null}, internal_notes = ${input.internalNotes ?? null}, updated_at = now()
             WHERE id = ${clientId}`;
    if (input.squadIds) {
      if (actor.role !== "admin") throw new AppError("Somente a direção altera os squads do cliente.");
      await tx`DELETE FROM client_squads WHERE client_id = ${clientId}`;
      for (const s of input.squadIds) await tx`INSERT INTO client_squads (client_id, squad_id) VALUES (${clientId}, ${s})`;
    }
    await logEvent(tx, { actorId: actor.id, entityType: "client", entityId: clientId, clientId, action: "editou", summary: `Atualizou dados do cliente`, before, after: input, relevant: false });
  });
}

export async function archiveClient(actor: Actor, clientId: string, reason: string) {
  assertAdmin(actor);
  if (!reason?.trim()) throw new AppError("Informe o motivo.");
  await sql.begin(async (tx) => {
    await tx`UPDATE clients SET deleted_at = now(), status = 'encerrado' WHERE id = ${clientId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "client", entityId: clientId, clientId, action: "arquivou", summary: "Arquivou o cliente", reason });
  });
}

// ───────────── Contrato / escopo comercial ─────────────

export async function saveContract(actor: Actor, input: { id?: string | null; clientId: string; title: string; status?: string; startDate?: string | null; endDate?: string | null; ownerId?: string | null; handoffNotes?: string | null; monthlyValue?: number | null; reason?: string | null }) {
  assertCanEditScope(actor);
  if (!input.title?.trim()) throw new AppError("Informe o título do contrato.");
  return sql.begin(async (tx) => {
    if (input.id) {
      const [b] = await tx`SELECT * FROM contracts WHERE id = ${input.id}`;
      if (!b) throw new AppError("Contrato não encontrado.");
      await tx`UPDATE contracts SET title = ${input.title.trim()}, status = ${input.status ?? "vigente"}, start_date = ${input.startDate ?? null}, end_date = ${input.endDate ?? null},
               owner_id = ${input.ownerId ?? null}, handoff_notes = ${input.handoffNotes ?? null}, monthly_value = ${input.monthlyValue ?? null}, version = version + 1, updated_at = now()
               WHERE id = ${input.id}`;
      await logEvent(tx, { actorId: actor.id, entityType: "contract", entityId: input.id, clientId: input.clientId, action: "alterou_escopo", summary: `Alterou o contrato “${input.title.trim()}” (nova versão)`, reason: input.reason, before: b, after: input });
      return input.id;
    }
    const [c] = await tx<{ id: string }[]>`
      INSERT INTO contracts (client_id, title, status, start_date, end_date, owner_id, handoff_notes, monthly_value)
      VALUES (${input.clientId}, ${input.title.trim()}, ${input.status ?? "vigente"}, ${input.startDate ?? null}, ${input.endDate ?? null}, ${input.ownerId ?? null}, ${input.handoffNotes ?? null}, ${input.monthlyValue ?? null})
      RETURNING id`;
    await logEvent(tx, { actorId: actor.id, entityType: "contract", entityId: c.id, clientId: input.clientId, action: "registrou_escopo", summary: `Registrou o contrato/escopo “${input.title.trim()}”` });
    return c.id;
  });
}

/** Passagem de bastão comercial → operação (REQ-009): aceite registrado pelo líder/direção. */
export async function acceptHandoff(actor: Actor, contractId: string, note: string | null) {
  assertManager(actor);
  const [c] = await sql<{ client_id: string; title: string; handoff_accepted_at: Date | null }[]>`SELECT client_id, title, handoff_accepted_at FROM contracts WHERE id = ${contractId}`;
  if (!c) throw new AppError("Contrato não encontrado.");
  await assertClientAccess(actor, c.client_id);
  if (c.handoff_accepted_at) throw new AppError("Passagem de bastão já aceita.");
  await sql.begin(async (tx) => {
    await tx`UPDATE contracts SET handoff_accepted_by = ${actor.id}, handoff_accepted_at = now() WHERE id = ${contractId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "contract", entityId: contractId, clientId: c.client_id, action: "aceitou_handoff", summary: `Aceitou a passagem de bastão de “${c.title}”`, reason: note });
  });
}

export async function saveService(actor: Actor, input: { id?: string | null; clientId: string; contractId?: string | null; name: string; kind: string; status?: string; startDate?: string | null; endDate?: string | null }) {
  assertCanEditScope(actor);
  if (!input.name?.trim()) throw new AppError("Informe o nome do serviço.");
  if (!SERVICE_KIND[input.kind]) throw new AppError("Tipo de serviço inválido.");
  return sql.begin(async (tx) => {
    if (input.id) {
      await tx`UPDATE services SET name = ${input.name.trim()}, kind = ${input.kind}, status = ${input.status ?? "ativo"}, contract_id = ${input.contractId ?? null}, start_date = ${input.startDate ?? null}, end_date = ${input.endDate ?? null} WHERE id = ${input.id}`;
      await logEvent(tx, { actorId: actor.id, entityType: "service", entityId: input.id, clientId: input.clientId, action: "alterou_escopo", summary: `Atualizou o serviço “${input.name.trim()}”`, after: input });
      return input.id;
    }
    const [s] = await tx<{ id: string }[]>`
      INSERT INTO services (client_id, contract_id, name, kind, status, start_date, end_date)
      VALUES (${input.clientId}, ${input.contractId ?? null}, ${input.name.trim()}, ${input.kind}, ${input.status ?? "ativo"}, ${input.startDate ?? null}, ${input.endDate ?? null}) RETURNING id`;
    await logEvent(tx, { actorId: actor.id, entityType: "service", entityId: s.id, clientId: input.clientId, action: "registrou_escopo", summary: `Adicionou o serviço ativo “${input.name.trim()}”` });
    return s.id;
  });
}

export async function saveDeliverable(actor: Actor, input: { id?: string | null; clientId: string; serviceId?: string | null; contractId?: string | null; name: string; quantity?: number | null; unit?: string | null; periodicity: string; acceptanceCriteria?: string | null; referenceHours?: number | null; startDate?: string | null; endDate?: string | null; status?: string; reason?: string | null }) {
  assertCanEditScope(actor);
  if (!input.name?.trim()) throw new AppError("Informe o entregável.");
  if (!PERIODICITY[input.periodicity]) throw new AppError("Periodicidade inválida.");
  return sql.begin(async (tx) => {
    if (input.id) {
      const [b] = await tx`SELECT * FROM deliverables WHERE id = ${input.id}`;
      await tx`UPDATE deliverables SET name = ${input.name.trim()}, service_id = ${input.serviceId ?? null}, contract_id = ${input.contractId ?? null}, quantity = ${input.quantity ?? null},
               unit = ${input.unit ?? null}, periodicity = ${input.periodicity}, acceptance_criteria = ${input.acceptanceCriteria ?? null}, reference_hours = ${input.referenceHours ?? null},
               start_date = ${input.startDate ?? null}, end_date = ${input.endDate ?? null}, status = ${input.status ?? "ativo"} WHERE id = ${input.id}`;
      await logEvent(tx, { actorId: actor.id, entityType: "deliverable", entityId: input.id, clientId: input.clientId, action: "alterou_escopo", summary: `Alterou o entregável “${input.name.trim()}”`, reason: input.reason, before: b, after: input });
      return input.id;
    }
    const [d] = await tx<{ id: string }[]>`
      INSERT INTO deliverables (client_id, service_id, contract_id, name, quantity, unit, periodicity, acceptance_criteria, reference_hours, start_date, end_date)
      VALUES (${input.clientId}, ${input.serviceId ?? null}, ${input.contractId ?? null}, ${input.name.trim()}, ${input.quantity ?? null}, ${input.unit ?? null}, ${input.periodicity},
              ${input.acceptanceCriteria ?? null}, ${input.referenceHours ?? null}, ${input.startDate ?? null}, ${input.endDate ?? null}) RETURNING id`;
    await logEvent(tx, { actorId: actor.id, entityType: "deliverable", entityId: d.id, clientId: input.clientId, action: "registrou_escopo", summary: `Adicionou o entregável vendido “${input.name.trim()}”` });
    return d.id;
  });
}

export async function linkFlowDeliverable(actor: Actor, flowId: string, deliverableId: string, link: boolean) {
  assertManager(actor);
  const [f] = await sql<{ client_id: string }[]>`SELECT client_id FROM flow_instances WHERE id = ${flowId}`;
  if (!f) throw new AppError("Fluxo não encontrado.");
  await assertClientAccess(actor, f.client_id);
  if (link) await sql`INSERT INTO flow_deliverables (flow_id, deliverable_id) VALUES (${flowId}, ${deliverableId}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM flow_deliverables WHERE flow_id = ${flowId} AND deliverable_id = ${deliverableId}`;
}
