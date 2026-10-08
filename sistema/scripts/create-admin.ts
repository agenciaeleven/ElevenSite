// Cria (ou reativa) um usuário admin real. Uso:
//   npm run db:create-admin -- "Nome" email@dominio.com "senha-forte"
import { sql } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth-core";
import { migrate } from "./migrate";

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password || password.length < 8) {
    console.error('Uso: npm run db:create-admin -- "Nome" email@dominio.com "senha com 8+ caracteres"');
    process.exit(1);
  }
  await migrate(false);
  let [w] = await sql<{ id: string }[]>`SELECT id FROM workspaces ORDER BY created_at LIMIT 1`;
  if (!w) [w] = await sql<{ id: string }[]>`INSERT INTO workspaces (name) VALUES ('Agência Eleven') RETURNING id`;
  await sql`
    INSERT INTO users (workspace_id, name, email, password_hash, role, is_demo)
    VALUES (${w.id}, ${name}, ${email.toLowerCase()}, ${await hashPassword(password)}, 'admin', false)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = 'admin', active = true, is_demo = false`;
  console.log(`✔ Admin ${email} pronto.`);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
