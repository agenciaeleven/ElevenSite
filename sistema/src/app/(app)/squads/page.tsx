import Link from "next/link";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { usersList } from "@/lib/queries";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Demo, Empty, Field } from "@/components/ui";
import { saveSquadAction } from "../../actions";

export const metadata = { title: "Squads" };

export default async function SquadsPage() {
  const actor = await requireActor();
  const squads = await sql<{ id: string; name: string; color: string | null; leader: string | null; is_demo: boolean; members: string | null; clients: string | null; open_tasks: number }[]>`
    SELECT s.id, s.name, s.color, l.name AS leader, s.is_demo,
      (SELECT string_agg(u.name, ', ' ORDER BY u.name) FROM squad_members sm JOIN users u ON u.id = sm.user_id WHERE sm.squad_id = s.id AND u.active) AS members,
      (SELECT string_agg(c.name, ', ' ORDER BY c.name) FROM client_squads cs JOIN clients c ON c.id = cs.client_id WHERE cs.squad_id = s.id AND c.deleted_at IS NULL) AS clients,
      (SELECT count(*)::int FROM tasks t WHERE t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada') AND t.assignee_id IN (SELECT user_id FROM squad_members WHERE squad_id = s.id)) AS open_tasks
    FROM squads s LEFT JOIN users l ON l.id = s.leader_id ORDER BY s.name`;
  const users = actor.role === "admin" ? await usersList() : [];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Squads</h1><p className="sub">Pessoas podem atuar em vários squads; o mesmo trabalho aparece em cada filtro sem duplicação.</p></div></div>
      <div className={actor.role === "admin" ? "grid g-side" : ""}>
        <div className="grid g2">
          {squads.length === 0 ? <Card><Empty title="Nenhum squad" /></Card> : squads.map((s) => (
            <div key={s.id} className="card card-b">
              <div className="row between"><Link href={`/squads/${s.id}`} className="sq"><span className="dot" style={{ background: s.color ?? "#999", width: 12, height: 12 }} /> <h2>{s.name}</h2></Link><Demo on={s.is_demo} /></div>
              <p className="small" style={{ marginTop: 6 }}>Líder: <b>{s.leader ?? "não definido"}</b></p>
              <p className="small muted">Membros: {s.members ?? "—"}</p>
              <p className="small muted">Clientes: {s.clients ?? "—"}</p>
              <p className="small" style={{ marginTop: 6 }}>{s.open_tasks} tarefa(s) abertas com membros do squad</p>
            </div>
          ))}
        </div>
        {actor.role === "admin" ? (
          <Card title="Novo squad">
            <ActionForm action={saveSquadAction} className="stack" reset>
              <Field label="Nome"><input name="name" required /></Field>
              <Field label="Cor"><input type="color" name="color" defaultValue="#3b5bdb" style={{ height: 36 }} /></Field>
              <Field label="Líder"><select name="leaderId"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="Capacidade semanal do squad (h)" help="Opcional. Se vazio, soma a capacidade dos membros."><input name="weeklyCapacity" inputMode="decimal" /></Field>
              <Submit>Criar squad</Submit>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
