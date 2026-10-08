import { sql } from "../db";
import type { Actor } from "../auth-core";
import { hashPassword } from "../auth-core";
import { AppError } from "../errors";
import { assertAdmin, assertManager } from "../access";
import { logEvent } from "../events";
import { LIFECYCLE, ROLE } from "../labels";

export async function createUser(actor: Actor, input: { name: string; email: string; password: string; role: string; jobTitle?: string | null; weeklyCapacity?: number | null; squadIds?: string[] }) {
  assertAdmin(actor, "Somente a direção cadastra usuários.");
  if (!input.name?.trim() || !input.email?.trim()) throw new AppError("Nome e e-mail são obrigatórios.");
  if (!ROLE[input.role]) throw new AppError("Perfil inválido.");
  if (!input.password || input.password.length < 8) throw new AppError("A senha inicial deve ter pelo menos 8 caracteres.");
  const [exists] = await sql`SELECT 1 FROM users WHERE lower(email) = lower(${input.email.trim()})`;
  if (exists) throw new AppError("Já existe um usuário com este e-mail.");
  const hash = await hashPassword(input.password);
  return sql.begin(async (tx) => {
    const [u] = await tx<{ id: string }[]>`
      INSERT INTO users (workspace_id, name, email, password_hash, role, job_title, weekly_capacity_hours)
      VALUES (${actor.workspace_id}, ${input.name.trim()}, ${input.email.trim().toLowerCase()}, ${hash}, ${input.role}, ${input.jobTitle ?? null}, ${input.weeklyCapacity ?? null}) RETURNING id`;
    for (const s of input.squadIds ?? []) await tx`INSERT INTO squad_members (squad_id, user_id) VALUES (${s}, ${u.id})`;
    await logEvent(tx, { actorId: actor.id, entityType: "user", entityId: u.id, action: "criou", summary: `Cadastrou ${input.name.trim()} (${ROLE[input.role]})`, relevant: false });
    return u.id;
  });
}

export async function updateUser(actor: Actor, userId: string, input: { name: string; role: string; jobTitle?: string | null; weeklyCapacity?: number | null; active: boolean; squadIds?: string[] }) {
  assertAdmin(actor);
  if (!ROLE[input.role]) throw new AppError("Perfil inválido.");
  if (userId === actor.id && (input.role !== "admin" || !input.active)) throw new AppError("Você não pode remover seu próprio acesso de admin.");
  await sql.begin(async (tx) => {
    await tx`UPDATE users SET name = ${input.name.trim()}, role = ${input.role}, job_title = ${input.jobTitle ?? null}, weekly_capacity_hours = ${input.weeklyCapacity ?? null}, active = ${input.active}, updated_at = now() WHERE id = ${userId}`;
    if (input.squadIds) {
      await tx`DELETE FROM squad_members WHERE user_id = ${userId} AND NOT (squad_id = ANY(${input.squadIds}))`;
      for (const s of input.squadIds) await tx`INSERT INTO squad_members (squad_id, user_id) VALUES (${s}, ${userId}) ON CONFLICT DO NOTHING`;
    }
    if (!input.active) await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
    await logEvent(tx, { actorId: actor.id, entityType: "user", entityId: userId, action: "editou", summary: `Atualizou o usuário ${input.name.trim()}`, after: input, relevant: false });
  });
}

export async function resetPassword(actor: Actor, userId: string, password: string) {
  if (actor.id !== userId) assertAdmin(actor);
  if (!password || password.length < 8) throw new AppError("A senha deve ter pelo menos 8 caracteres.");
  await sql`UPDATE users SET password_hash = ${await hashPassword(password)}, updated_at = now() WHERE id = ${userId}`;
  await sql`DELETE FROM sessions WHERE user_id = ${userId} AND ${actor.id !== userId}`;
}

export async function saveSquad(actor: Actor, input: { id?: string | null; name: string; color?: string | null; leaderId?: string | null; weeklyCapacity?: number | null }) {
  assertAdmin(actor, "Somente a direção cria e edita squads.");
  if (!input.name?.trim()) throw new AppError("Informe o nome do squad.");
  if (input.id) {
    await sql`UPDATE squads SET name = ${input.name.trim()}, color = ${input.color ?? null}, leader_id = ${input.leaderId ?? null}, weekly_capacity_hours = ${input.weeklyCapacity ?? null} WHERE id = ${input.id}`;
    if (input.leaderId) await sql`INSERT INTO squad_members (squad_id, user_id) VALUES (${input.id}, ${input.leaderId}) ON CONFLICT DO NOTHING`;
    return input.id;
  }
  const [s] = await sql<{ id: string }[]>`INSERT INTO squads (name, color, leader_id, weekly_capacity_hours) VALUES (${input.name.trim()}, ${input.color ?? null}, ${input.leaderId ?? null}, ${input.weeklyCapacity ?? null}) RETURNING id`;
  if (input.leaderId) await sql`INSERT INTO squad_members (squad_id, user_id) VALUES (${s.id}, ${input.leaderId}) ON CONFLICT DO NOTHING`;
  return s.id;
}

export async function setSquadMember(actor: Actor, squadId: string, userId: string, member: boolean, allocationPct?: number | null) {
  assertAdmin(actor);
  if (member) await sql`INSERT INTO squad_members (squad_id, user_id, allocation_pct) VALUES (${squadId}, ${userId}, ${allocationPct ?? null}) ON CONFLICT (squad_id, user_id) DO UPDATE SET allocation_pct = EXCLUDED.allocation_pct`;
  else await sql`DELETE FROM squad_members WHERE squad_id = ${squadId} AND user_id = ${userId}`;
}

// ───────────── Biblioteca de fluxos (modelos) ─────────────

export async function saveTemplate(actor: Actor, input: { id?: string | null; name: string; lifecycle: string; description?: string | null; active?: boolean }) {
  assertManager(actor);
  if (!input.name?.trim()) throw new AppError("Informe o nome do modelo.");
  if (!LIFECYCLE[input.lifecycle] || input.lifecycle === "extra") throw new AppError("Tipo de execução inválido.");
  if (input.id) {
    await sql`UPDATE flow_templates SET name = ${input.name.trim()}, lifecycle = ${input.lifecycle}, description = ${input.description ?? null}, active = ${input.active ?? true} WHERE id = ${input.id}`;
    return input.id;
  }
  const [t] = await sql<{ id: string }[]>`INSERT INTO flow_templates (name, lifecycle, description) VALUES (${input.name.trim()}, ${input.lifecycle}, ${input.description ?? null}) RETURNING id`;
  return t.id;
}

export async function saveTemplateStep(actor: Actor, input: { id?: string | null; templateId: string; stage?: string | null; name: string; roleHint?: string | null; estHours?: number | null; offsetDays?: number | null; position?: number | null; doneCriteria?: string | null }) {
  assertManager(actor);
  if (!input.name?.trim()) throw new AppError("Informe o nome da etapa/tarefa.");
  if (input.estHours != null && input.estHours < 0) throw new AppError("Horas estimadas não podem ser negativas.");
  if (input.id) {
    await sql`UPDATE flow_template_steps SET stage = ${input.stage ?? null}, name = ${input.name.trim()}, role_hint = ${input.roleHint ?? null}, est_hours = ${input.estHours ?? null},
              offset_days = ${input.offsetDays ?? null}, position = coalesce(${input.position ?? null}, position), done_criteria = ${input.doneCriteria ?? null} WHERE id = ${input.id}`;
    return input.id;
  }
  const [{ pos }] = await sql<{ pos: number }[]>`SELECT coalesce(max(position), 0) + 1 AS pos FROM flow_template_steps WHERE template_id = ${input.templateId}`;
  const [s] = await sql<{ id: string }[]>`
    INSERT INTO flow_template_steps (template_id, position, stage, name, role_hint, est_hours, offset_days, done_criteria)
    VALUES (${input.templateId}, ${input.position ?? pos}, ${input.stage ?? null}, ${input.name.trim()}, ${input.roleHint ?? null}, ${input.estHours ?? null}, ${input.offsetDays ?? null}, ${input.doneCriteria ?? null}) RETURNING id`;
  return s.id;
}

export async function deleteTemplateStep(actor: Actor, stepId: string) {
  assertManager(actor);
  await sql`DELETE FROM flow_template_steps WHERE id = ${stepId}`;
}

export async function saveAlertRule(actor: Actor, key: string, enabled: boolean, threshold: number | null) {
  assertAdmin(actor, "Somente a direção altera regras de alerta.");
  await sql`UPDATE alert_rules SET enabled = ${enabled}, threshold = ${threshold} WHERE key = ${key}`;
}
