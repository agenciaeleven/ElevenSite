import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { assertCanSeeDay } from "@/lib/services/daily";
import { squadsList } from "@/lib/queries";
import { fmtDateTime } from "@/lib/dates";
import { ROLE, fmtBlocker } from "@/lib/labels";
import { ForbiddenError } from "@/lib/errors";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Demo, Empty, Field } from "@/components/ui";
import { TaskList, type TaskItem } from "@/components/TaskList";
import { resetPasswordAction, updateUserAction } from "../../../actions";

export const metadata = { title: "Pessoa" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try { await assertCanSeeDay(actor, id); } catch (e) { if (e instanceof ForbiddenError) notFound(); throw e; }
  const [u] = await sql<{ id: string; name: string; email: string; role: string; job_title: string | null; weekly_capacity_hours: number | null; active: boolean; is_demo: boolean; squads: { id: string; name: string }[] }[]>`
    SELECT u.*, coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name)) FROM squad_members sm JOIN squads s ON s.id = sm.squad_id WHERE sm.user_id = u.id), '[]') AS squads FROM users u WHERE u.id = ${id}`;
  if (!u) notFound();
  const tasks = await sql<TaskItem[]>`
    SELECT t.id, t.title, t.status, t.priority, t.due_date, t.est_hours, t.assignee_id, NULL AS assignee_name, t.is_extra, t.in_baseline, c.name AS client_name, f.name AS flow_name, t.flow_id, t.waiting_until,
      (SELECT b.reason_category || coalesce(': ' || b.comment, '') FROM blockers b WHERE b.task_id = t.id AND b.resolved_at IS NULL LIMIT 1) AS blocker
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN flow_instances f ON f.id = t.flow_id
    WHERE t.assignee_id = ${id} AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada') ORDER BY t.due_date NULLS LAST LIMIT 60`;
  for (const t of tasks) t.blocker = fmtBlocker(t.blocker);
  const history = await sql<{ id: number; occurred_at: Date; summary: string; client_name: string | null }[]>`
    SELECT oe.id, oe.occurred_at, oe.summary, c.name AS client_name FROM operational_events oe LEFT JOIN clients c ON c.id = oe.client_id WHERE oe.actor_id = ${id} ORDER BY oe.occurred_at DESC LIMIT 30`;
  const squads = actor.role === "admin" ? await squadsList() : [];
  const showCap = isManager(actor) || actor.id === id;
  return (
    <div className="page">
      <div className="crumbs">{isManager(actor) ? <Link href="/pessoas">Pessoas</Link> : "Pessoas"} /</div>
      <div className="page-head">
        <div><h1>{u.name} <Demo on={u.is_demo} /></h1><p className="sub">{ROLE[u.role]}{u.job_title ? ` · ${u.job_title}` : ""} · squads: {u.squads.map((s) => s.name).join(", ") || "—"}{showCap && u.weekly_capacity_hours ? ` · capacidade ${u.weekly_capacity_hours}h/semana` : ""}</p></div>
        <Link className="btn primary" href={`/meu-dia?pessoa=${id}`}>Ver Meu Dia</Link>
      </div>
      <div className="grid g-side">
        <div className="stack">
          <Card title={`Tarefas abertas (${tasks.length})`} tight>{tasks.length ? <TaskList tasks={tasks} canManage={isManager(actor)} actorId={actor.id} context="person" /> : <Empty title="Nenhuma tarefa aberta" />}</Card>
          <Card title="Histórico recente" tight>
            {history.length === 0 ? <Empty title="Sem registros" /> : <ul className="timeline">{history.map((h) => <li key={h.id}><span className="when">{fmtDateTime(h.occurred_at)}</span><div>{h.summary}{h.client_name ? <span className="small muted"> · {h.client_name}</span> : null}</div></li>)}</ul>}
          </Card>
        </div>
        {actor.role === "admin" ? (
          <div className="stack">
            <Card title="Editar acesso">
              <ActionForm action={updateUserAction} className="stack">
                <input type="hidden" name="userId" value={id} />
                <Field label="Nome"><input name="name" defaultValue={u.name} required /></Field>
                <div className="form-grid">
                  <Field label="Perfil"><select name="role" defaultValue={u.role}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <Field label="Função"><input name="jobTitle" defaultValue={u.job_title ?? ""} /></Field>
                  <Field label="Capacidade semanal (h)"><input name="weeklyCapacity" defaultValue={u.weekly_capacity_hours ?? ""} inputMode="decimal" /></Field>
                </div>
                <Field label="Squads"><div className="row">{squads.map((s) => <label key={s.id} className="check"><input type="checkbox" name="squadIds" value={s.id} defaultChecked={u.squads.some((x) => x.id === s.id)} /> {s.name}</label>)}</div></Field>
                <label className="check"><input type="checkbox" name="active" defaultChecked={u.active} /> Acesso ativo</label>
                <Submit>Salvar</Submit>
              </ActionForm>
            </Card>
            <Card title="Redefinir senha">
              <ActionForm action={resetPasswordAction} className="stack" reset>
                <input type="hidden" name="userId" value={id} />
                <input name="password" type="text" minLength={8} placeholder="Nova senha (8+ caracteres)" required />
                <Submit className="btn">Redefinir</Submit>
              </ActionForm>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
