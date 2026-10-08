import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { usersList } from "@/lib/queries";
import { computeAlerts } from "@/lib/services/alerts";
import { listEvents } from "@/lib/services/agenda";
import { addDays, fmtDate, fmtDateTime, localToInstant, today } from "@/lib/dates";
import { EVENT_KIND } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AlertList } from "@/components/AlertList";
import { Card, Demo, Empty, Field, Hours, Kpi } from "@/components/ui";
import { saveSquadAction, squadMemberAction } from "../../../actions";

export const metadata = { title: "Squad" };

export default async function SquadPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [s] = await sql<{ id: string; name: string; color: string | null; leader_id: string | null; leader: string | null; weekly_capacity_hours: number | null; is_demo: boolean }[]>`
    SELECT s.*, l.name AS leader FROM squads s LEFT JOIN users l ON l.id = s.leader_id WHERE s.id = ${id}`;
  if (!s) notFound();
  const ref = today();
  const manager = isManager(actor);
  const showCapacity = actor.role === "admin" || s.leader_id === actor.id;
  const members = await sql<{ id: string; name: string; job_title: string | null; cap: number | null; allocation_pct: number | null; other_squads: string | null; est7: number | null; unest7: number; open: number; logged7: number | null; logged_n: number; extras30: number }[]>`
    SELECT u.id, u.name, u.job_title, u.weekly_capacity_hours AS cap, sm.allocation_pct,
      (SELECT string_agg(s2.name, ', ') FROM squad_members m2 JOIN squads s2 ON s2.id = m2.squad_id WHERE m2.user_id = u.id AND m2.squad_id <> ${id}) AS other_squads,
      (SELECT sum(est_hours) FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada') AND t.due_date BETWEEN ${ref}::date AND ${addDays(ref, 6)}::date) AS est7,
      (SELECT count(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada') AND t.est_hours IS NULL AND t.due_date BETWEEN ${ref}::date AND ${addDays(ref, 6)}::date) AS unest7,
      (SELECT count(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada')) AS open,
      (SELECT sum(hours) FROM time_entries te WHERE te.user_id = u.id AND te.occurred_on BETWEEN ${addDays(ref, -6)}::date AND ${ref}::date) AS logged7,
      (SELECT count(*)::int FROM time_entries te WHERE te.user_id = u.id AND te.occurred_on BETWEEN ${addDays(ref, -6)}::date AND ${ref}::date) AS logged_n,
      (SELECT count(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.is_extra AND t.deleted_at IS NULL AND t.created_at >= now() - interval '30 days') +
      (SELECT count(*)::int FROM manual_activity_entries m WHERE m.user_id = u.id AND m.kind = 'demanda_extra' AND m.task_id IS NULL AND m.occurred_on >= ${addDays(ref, -30)}::date) AS extras30
    FROM squad_members sm JOIN users u ON u.id = sm.user_id WHERE sm.squad_id = ${id} AND u.active ORDER BY u.name`;
  const clients = await sql<{ id: string; name: string; is_demo: boolean }[]>`SELECT c.id, c.name, c.is_demo FROM client_squads cs JOIN clients c ON c.id = cs.client_id WHERE cs.squad_id = ${id} AND c.deleted_at IS NULL ORDER BY c.name`;
  const alerts = await computeAlerts(actor, { squadId: id });
  const events = await listEvents(actor, { from: localToInstant(ref), to: localToInstant(addDays(ref, 14)), squadId: id });
  const users = actor.role === "admin" ? await usersList() : [];
  const cap = s.weekly_capacity_hours ?? members.reduce((a, m) => a + (m.cap ?? 0), 0);
  const est = members.reduce((a, m) => a + (m.est7 ?? 0), 0);
  const logged = members.reduce((a, m) => a + (m.logged7 ?? 0), 0);
  const loggedN = members.reduce((a, m) => a + m.logged_n, 0);

  return (
    <div className="page">
      <div className="crumbs"><Link href="/squads">Squads</Link> /</div>
      <div className="page-head"><div><h1 className="sq"><span className="dot" style={{ background: s.color ?? "#999", width: 14, height: 14 }} /> {s.name} <Demo on={s.is_demo} /></h1><p className="sub">Líder: {s.leader ?? "não definido"} · {members.length} pessoa(s) · {clients.length} cliente(s)</p></div>
        <Link className="btn" href={`/?squad=${id}`}>Ver no Radar</Link></div>
      {showCapacity ? (
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <Kpi label="Capacidade semanal definida" value={cap ? `${cap}h` : <small className="nodata">não definida</small>} />
          <Kpi label="Horas estimadas (prazos em 7 dias)" value={`${est}h`} foot={cap ? `${Math.round((100 * est) / cap)}% da capacidade` : undefined} />
          <Kpi label="Horas apontadas (últimos 7 dias)" value={loggedN ? `${logged}h` : <small className="nodata">sem apontamento</small>} />
          <Kpi label="Alertas" value={alerts.filter((a) => a.severity !== "info").length} foot={`${alerts.filter((a) => a.rule === "bloqueio").length} bloqueio(s)`} />
        </div>
      ) : null}
      <div className="grid g-side">
        <div className="stack">
          <Card title="Pessoas" hint={showCapacity ? "Capacidade estimada não é espaço vazio na agenda. Sem apontamento não significa 0h." : undefined} tight>
            <div className="table-wrap"><table>
              <thead><tr><th>Pessoa</th><th>Outros squads</th><th className="num">Tarefas abertas</th>{showCapacity ? <><th className="num">Est. 7 dias / capacidade</th><th className="num">Apontado 7 dias</th></> : null}<th className="num">Demandas extras (30d)</th></tr></thead>
              <tbody>{members.map((m) => (
                <tr key={m.id}>
                  <td><Link href={`/pessoas/${m.id}`}><b>{m.name}</b></Link><div className="small muted">{m.job_title ?? ""}{m.allocation_pct ? ` · ${m.allocation_pct}% alocado` : ""}</div></td>
                  <td className="small">{m.other_squads ?? "—"}</td>
                  <td className="num">{m.open}</td>
                  {showCapacity ? <><td className={`num ${m.cap && (m.est7 ?? 0) > m.cap ? "late" : ""}`}>{m.est7 ?? 0}h / {m.cap ? `${m.cap}h` : "—"}{m.unest7 ? <div className="small muted">+{m.unest7} sem estimativa</div> : null}</td>
                  <td className="num"><Hours v={m.logged_n ? m.logged7 : null} /></td></> : null}
                  <td className="num">{m.extras30}</td>
                </tr>
              ))}</tbody>
            </table></div>
            {actor.role === "admin" ? (
              <div className="card-b row">
                <ActionForm action={squadMemberAction} className="row">
                  <input type="hidden" name="squadId" value={id} />
                  <select name="userId" style={{ width: 200 }}>{users.filter((u) => !members.some((m) => m.id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                  <input name="allocationPct" placeholder="% alocação" style={{ width: 110 }} inputMode="decimal" />
                  <Submit className="btn sm">Adicionar ao squad</Submit>
                </ActionForm>
                <ActionForm action={squadMemberAction} className="row">
                  <input type="hidden" name="squadId" value={id} /><input type="hidden" name="remove" value="true" />
                  <select name="userId" style={{ width: 200 }}>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                  <Submit className="btn sm danger">Remover</Submit>
                </ActionForm>
              </div>
            ) : null}
          </Card>
          <Card title="Saúde do squad" hint="Inclui clientes do squad e trabalho de membros em outros clientes (atuação cruzada)." tight><AlertList alerts={alerts} actor={actor} compact={!manager} /></Card>
        </div>
        <div className="stack">
          <Card title="Clientes" tight>{clients.length === 0 ? <Empty title="Nenhum cliente" /> : <ul className="list">{clients.map((c) => <li key={c.id}><Link href={`/clientes/${c.id}`}>{c.name}</Link> <Demo on={c.is_demo} /></li>)}</ul>}</Card>
          <Card title="Agenda do squad (14 dias)" tight>
            {events.length === 0 ? <Empty title="Sem eventos" /> : <ul className="list">{events.map((e) => <li key={e.id}><Link href={`/agenda/${e.id}`}><b>{e.title}</b></Link><div className="small muted">{EVENT_KIND[e.kind]} · {e.all_day ? fmtDate(e.starts_at.toISOString().slice(0, 10)) : fmtDateTime(e.starts_at)}</div></li>)}</ul>}
          </Card>
          {actor.role === "admin" ? (
            <Card title="Editar squad">
              <ActionForm action={saveSquadAction} className="stack">
                <input type="hidden" name="id" value={id} />
                <Field label="Nome"><input name="name" defaultValue={s.name} required /></Field>
                <Field label="Cor"><input type="color" name="color" defaultValue={s.color ?? "#3b5bdb"} style={{ height: 36 }} /></Field>
                <Field label="Líder"><select name="leaderId" defaultValue={s.leader_id ?? ""}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                <Field label="Capacidade semanal (h)"><input name="weeklyCapacity" defaultValue={s.weekly_capacity_hours ?? ""} inputMode="decimal" /></Field>
                <Submit>Salvar</Submit>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
