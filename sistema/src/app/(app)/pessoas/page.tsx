import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { squadsList } from "@/lib/queries";
import { ROLE } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Demo, Field } from "@/components/ui";
import { createUserAction } from "../../actions";

export const metadata = { title: "Pessoas" };

export default async function PeoplePage() {
  const actor = await requireActor();
  if (!isManager(actor)) redirect(`/pessoas/${actor.id}`);
  const people = await sql<{ id: string; name: string; email: string; role: string; job_title: string | null; active: boolean; is_demo: boolean; squads: string | null; open: number; overdue: number }[]>`
    SELECT u.id, u.name, u.email, u.role, u.job_title, u.active, u.is_demo,
      (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM squad_members sm JOIN squads s ON s.id = sm.squad_id WHERE sm.user_id = u.id) AS squads,
      (SELECT count(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada')) AS open,
      (SELECT count(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada','bloqueada') AND t.due_date < CURRENT_DATE) AS overdue
    FROM users u ORDER BY u.active DESC, u.name`;
  const squads = actor.role === "admin" ? await squadsList() : [];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Pessoas</h1><p className="sub">Perfis, squads (vários por pessoa) e acesso. Dados de capacidade individual visíveis apenas para direção e líderes.</p></div></div>
      <div className={actor.role === "admin" ? "grid g-side" : ""}>
        <Card tight>
          <div className="table-wrap"><table>
            <thead><tr><th>Pessoa</th><th>Perfil</th><th>Squads</th><th className="num">Abertas</th><th className="num">Vencidas</th><th /></tr></thead>
            <tbody>{people.map((p) => (
              <tr key={p.id} style={p.active ? undefined : { opacity: 0.5 }}>
                <td><Link href={`/pessoas/${p.id}`}><b>{p.name}</b></Link> <Demo on={p.is_demo} />{!p.active ? <span className="badge b-neutral">inativo</span> : null}<div className="small muted">{p.job_title ?? ""} · {p.email}</div></td>
                <td className="small">{ROLE[p.role]}</td>
                <td className="small">{p.squads ?? "—"}</td>
                <td className="num">{p.open}</td>
                <td className={`num ${p.overdue ? "late" : ""}`}>{p.overdue}</td>
                <td><Link className="btn sm ghost" href={`/meu-dia?pessoa=${p.id}`}>Dia</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
        {actor.role === "admin" ? (
          <Card title="Novo usuário" hint="Informe uma senha inicial e peça para a pessoa trocá-la em “Minha conta”.">
            <ActionForm action={createUserAction} className="stack" reset>
              <Field label="Nome"><input name="name" required /></Field>
              <Field label="E-mail (login)"><input name="email" type="email" required /></Field>
              <Field label="Senha inicial"><input name="password" type="text" minLength={8} required /></Field>
              <div className="form-grid">
                <Field label="Perfil"><select name="role" defaultValue="colaborador">{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Função"><input name="jobTitle" /></Field>
                <Field label="Capacidade semanal (h)"><input name="weeklyCapacity" inputMode="decimal" /></Field>
              </div>
              <Field label="Squads"><div className="row">{squads.map((s) => <label key={s.id} className="check"><input type="checkbox" name="squadIds" value={s.id} /> {s.name}</label>)}</div></Field>
              <Submit>Criar usuário</Submit>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
