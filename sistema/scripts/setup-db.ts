// Preparação automática do banco no deploy (Vercel roda "vercel-build" antes do build).
// 1) aplica migrações; 2) cria/atualiza admin se ADMIN_EMAIL e ADMIN_PASSWORD existirem;
// 3) carrega dados de demonstração se SEED_DEMO=1 (apenas se ainda não existirem).
import { sql } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth-core";
import { migrate } from "./migrate";
import { seedDemo } from "./seed-demo";

async function main() {
  await migrate();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 8) throw new Error("ADMIN_PASSWORD precisa ter 8+ caracteres.");
    let [w] = await sql<{ id: string }[]>`SELECT id FROM workspaces ORDER BY created_at LIMIT 1`;
    if (!w) [w] = await sql<{ id: string }[]>`INSERT INTO workspaces (name) VALUES ('Agência Eleven') RETURNING id`;
    await sql`
      INSERT INTO users (workspace_id, name, email, password_hash, role, is_demo)
      VALUES (${w.id}, ${process.env.ADMIN_NAME || "Direção"}, ${email}, ${await hashPassword(password)}, 'admin', false)
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', active = true, is_demo = false`;
    console.log(`✔ Admin ${email} pronto.`);
  }
  if (process.env.SEED_DEMO === "1") await seedDemo();
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
