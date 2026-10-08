import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "./db";

export type Role = "admin" | "lider" | "colaborador";
export type Actor = { id: string; name: string; email: string; role: Role; workspace_id: string; is_demo: boolean };

export const SESSION_DAYS = 14;

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function authenticate(email: string, password: string): Promise<Actor | null> {
  const [u] = await sql<(Actor & { password_hash: string; active: boolean })[]>`
    SELECT id, name, email, role, workspace_id, is_demo, password_hash, active FROM users WHERE lower(email) = lower(${email.trim()})`;
  if (!u || !u.active) return null;
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return null;
  const { password_hash: _ph, active: _a, ...actor } = u;
  return actor;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${hashToken(token)}, ${userId}, ${expires})`;
  return { token, expires };
}

export async function actorFromToken(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const [u] = await sql<Actor[]>`
    SELECT u.id, u.name, u.email, u.role, u.workspace_id, u.is_demo
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now() AND u.active`;
  return u ?? null;
}

export async function destroySession(token: string | undefined) {
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
}
