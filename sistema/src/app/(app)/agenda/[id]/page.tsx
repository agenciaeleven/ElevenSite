import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { clientScope, inScope, isManager } from "@/lib/access";
import { usersList } from "@/lib/queries";
import { dateOfInstant, fmtDate, fmtDateTime, fmtTime } from "@/lib/dates";
import { EVENT_KIND, EVENT_STATUS } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Demo, Empty, Field } from "@/components/ui";
import { cancelEventAction, eventDoneAction, meetingItemAction, meetingItemToTaskAction, meetingNotesAction, rescheduleEventAction } from "../../../actions";

export const metadata = { title: "Evento" };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [e] = await sql<{ id: string; kind: string; title: string; client_id: string | null; client_name: string | null; flow_id: string | null; flow_name: string | null; task_id: string | null; task_title: string | null; squad_name: string | null; starts_at: Date; ends_at: Date | null; all_day: boolean; location: string | null; status: string; cancel_reason: string | null; reschedule_count: number; meeting_notes: string | null; created_by: string | null; creator: string | null; is_demo: boolean }[]>`
    SELECT e.*, c.name AS client_name, f.name AS flow_name, t.title AS task_title, s.name AS squad_name, u.name AS creator
    FROM calendar_events e LEFT JOIN clients c ON c.id = e.client_id LEFT JOIN flow_instances f ON f.id = e.flow_id LEFT JOIN tasks t ON t.id = e.task_id LEFT JOIN squads s ON s.id = e.squad_id LEFT JOIN users u ON u.id = e.created_by
    WHERE e.id = ${id}`;
  if (!e || !inScope(await clientScope(actor), e.client_id)) notFound();
  const parts = await sql<{ id: string; name: string; attendance: string }[]>`SELECT u.id, u.name, p.attendance FROM event_participants p JOIN users u ON u.id = p.user_id WHERE p.event_id = ${id} ORDER BY u.name`;
  const items = await sql<{ id: string; kind: string; text: string; owner: string | null; due_date: string | null; task_id: string | null }[]>`SELECT mi.id, mi.kind, mi.text, u.name AS owner, mi.due_date, mi.task_id FROM meeting_items mi LEFT JOIN users u ON u.id = mi.owner_id WHERE mi.event_id = ${id} ORDER BY mi.created_at`;
  const history = await sql<{ id: number; occurred_at: Date; summary: string; reason: string | null; actor: string | null }[]>`
    SELECT oe.id, oe.occurred_at, oe.summary, oe.reason, u.name AS actor FROM operational_events oe LEFT JOIN users u ON u.id = oe.actor_id WHERE oe.entity_type = 'event' AND oe.entity_id = ${id} AND oe.action <> 'participou' ORDER BY oe.occurred_at DESC`;
  const canEdit = isManager(actor) || e.created_by === actor.id;
  const users = await usersList();
  const date = dateOfInstant(e.starts_at);
  const past = e.starts_at < new Date();

  return (
    <div className="page">
      <div className="crumbs"><Link href={`/agenda?data=${date}`}>Agenda</Link> / evento</div>
      <div className="page-head">
        <div>
          <h1 style={e.status === "cancelado" ? { textDecoration: "line-through" } : undefined}>{e.title} <Demo on={e.is_demo} /></h1>
          <p className="sub">{EVENT_KIND[e.kind]} · {e.all_day ? `${fmtDate(date, { weekday: true, year: true })} (dia todo)` : `${fmtDate(date, { weekday: true, year: true })}, ${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}`} · <b>{EVENT_STATUS[e.status]}</b>{e.reschedule_count ? ` · remarcado ${e.reschedule_count}x` : ""}</p>
          <p className="small muted">
            {e.client_id ? <><Link href={`/clientes/${e.client_id}`}>{e.client_name}</Link> · </> : "Interno · "}
            {e.flow_id ? <><Link href={`/fluxos/${e.flow_id}`}>{e.flow_name}</Link> · </> : null}
            {e.task_id ? <>tarefa <Link href={`/tarefas/${e.task_id}`}>{e.task_title}</Link> · </> : null}
            {e.squad_name ? `squad ${e.squad_name} · ` : ""}{e.location ? `local: ${e.location} · ` : ""}criado por {e.creator ?? "—"}
          </p>
        </div>
      </div>
      {e.status === "cancelado" ? <div className="callout warn" style={{ marginBottom: 12 }}>Cancelado: {e.cancel_reason}. O registro permanece no histórico.</div> : null}
      <div className="grid g-side">
        <div className="stack">
          <Card title="Participantes" hint="Agendado não é realizado: confirme a participação após o evento." tight>
            {parts.length === 0 ? <Empty title="Sem participantes" /> : (
              <ul className="list">{parts.map((p) => <li key={p.id} className="row between"><span>{p.name}</span><span className={`badge ${p.attendance === "confirmado" ? "b-normal" : p.attendance === "ausente" ? "b-neutral" : "b-info"}`}>{p.attendance}</span></li>)}</ul>
            )}
            {canEdit && e.status === "agendado" && past && parts.length ? (
              <div className="card-b">
                <ActionForm action={eventDoneAction} className="stack">
                  <input type="hidden" name="eventId" value={id} />
                  <div className="row">{parts.map((p) => <label key={p.id} className="check"><input type="checkbox" name="attended" value={p.id} defaultChecked /> {p.name}</label>)}</div>
                  <Submit className="btn ok">Registrar como realizado</Submit>
                </ActionForm>
              </div>
            ) : null}
          </Card>
          {e.kind === "reuniao" ? (
            <Card title="Ata, decisões e encaminhamentos" hint="Comentário/decisão não vira tarefa automaticamente — converta apenas o que for executável.">
              <ActionForm action={meetingNotesAction} className="stack">
                <input type="hidden" name="eventId" value={id} />
                <textarea name="notes" defaultValue={e.meeting_notes ?? ""} placeholder="Ata da reunião" style={{ minHeight: 120 }} disabled={!canEdit} />
                {canEdit ? <Submit className="btn">Salvar ata</Submit> : null}
              </ActionForm>
              <ul className="list" style={{ marginTop: 10 }}>{items.map((i) => (
                <li key={i.id} className="row between">
                  <span><span className="badge b-neutral">{i.kind}</span> {i.text} <span className="small muted">{i.owner ? `· ${i.owner}` : ""}{i.due_date ? ` · ${fmtDate(i.due_date)}` : ""}</span></span>
                  {i.task_id ? <Link className="small" href={`/tarefas/${i.task_id}`}>tarefa criada</Link> : isManager(actor) && i.kind === "encaminhamento" ? <ActionForm action={meetingItemToTaskAction}><input type="hidden" name="itemId" value={i.id} /><Submit className="btn sm">Converter em tarefa</Submit></ActionForm> : null}
                </li>
              ))}</ul>
              {canEdit ? (
                <ActionForm action={meetingItemAction} className="form-grid" reset>
                  <input type="hidden" name="eventId" value={id} />
                  <Field label="Tipo"><select name="kind"><option value="decisao">Decisão</option><option value="encaminhamento">Encaminhamento</option><option value="duvida">Dúvida/solicitação</option></select></Field>
                  <Field label="Responsável"><select name="ownerId"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                  <Field label="Prazo"><input type="date" name="dueDate" /></Field>
                  <Field label="Descrição" full><input name="text" required /></Field>
                  <div><Submit className="btn sm">Adicionar item</Submit></div>
                </ActionForm>
              ) : null}
            </Card>
          ) : null}
          <Card title="Histórico do evento" tight>
            {history.length === 0 ? <Empty title="Sem alterações" /> : (
              <ul className="timeline">{history.map((h) => <li key={h.id}><span className="when">{fmtDateTime(h.occurred_at)}</span><div><b>{h.actor}</b> — {h.summary}{h.reason ? <div className="why">Motivo: {h.reason}</div> : null}</div></li>)}</ul>
            )}
          </Card>
        </div>
        {canEdit && e.status !== "cancelado" ? (
          <div className="stack">
            {e.status === "agendado" ? (
              <Card title="Remarcar" hint="Atualiza este mesmo evento em todas as visões (agenda geral, squad, fluxo e prazo da tarefa vinculada).">
                <ActionForm action={rescheduleEventAction} className="stack">
                  <input type="hidden" name="eventId" value={id} />
                  <div className="row"><input type="date" name="date" defaultValue={date} required style={{ width: 150 }} />{!e.all_day ? <><input type="time" name="startTime" defaultValue={fmtTime(e.starts_at)} style={{ width: 110 }} /><input type="time" name="endTime" defaultValue={fmtTime(e.ends_at)} style={{ width: 110 }} /></> : null}</div>
                  <input name="reason" placeholder="Motivo da remarcação (obrigatório)" required />
                  <label className="check"><input type="checkbox" name="force" /> Salvar mesmo com conflito</label>
                  <Submit>Remarcar</Submit>
                </ActionForm>
              </Card>
            ) : null}
            <Card title="Cancelar" hint="Cancelar ≠ remarcar. O evento cancelado fica no histórico.">
              <ActionForm action={cancelEventAction} className="stack" confirm="Cancelar este evento?">
                <input type="hidden" name="eventId" value={id} />
                <input name="reason" placeholder="Motivo do cancelamento (obrigatório)" required />
                <Submit className="btn danger">Cancelar evento</Submit>
              </ActionForm>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
