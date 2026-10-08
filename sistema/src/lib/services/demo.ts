import { sql } from "../db";

/** Remove dados de demonstração. Usuários demo são desativados (podem estar referenciados por registros reais). */
export async function removeDemoData() {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM operational_events WHERE is_demo OR client_id IN (SELECT id FROM clients WHERE is_demo)`;
    await tx`DELETE FROM calendar_events WHERE is_demo OR client_id IN (SELECT id FROM clients WHERE is_demo)`;
    await tx`DELETE FROM time_entries WHERE is_demo`;
    await tx`DELETE FROM manual_activity_entries WHERE is_demo`;
    await tx`DELETE FROM justification_requests WHERE is_demo`;
    await tx`DELETE FROM manager_interventions WHERE is_demo`;
    await tx`DELETE FROM clients WHERE is_demo`;
    await tx`DELETE FROM flow_templates WHERE is_demo`;
    await tx`DELETE FROM squads WHERE is_demo`;
    await tx`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_demo)`;
    // Usuários demo podem estar referenciados por registros reais: são desativados, não apagados.
    await tx`UPDATE users SET active = false WHERE is_demo`;
  });
}

