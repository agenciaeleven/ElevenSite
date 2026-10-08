import Link from "next/link";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { clientScope, isManager, scopeIds } from "@/lib/access";
import { listEvents } from "@/lib/services/agenda";
import { squadsList, usersList, visibleClients } from "@/lib/queries";
import { addDays, dateOfInstant, fmtDate, fmtMonth, fmtTime, localToInstant, monthRange, shiftMonth, today, weekStart } from "@/lib/dates";
import { EVENT_KIND, EVENT_STATUS } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Empty, Field } from "@/components/ui";
import { createEventAction } from "../../actions";

export const metadata = { title: "Agenda" };
const WD = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const view = sp.visao === "mes" || sp.visao === "lista" ? sp.visao : "semana";
  const ref = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? sp.data : today();
  let from: string, to: string;
  if (view === "mes") {
    const r = monthRange(ref.slice(0, 7));
    from = weekStart(r.start);
    to = addDays(weekStart(addDays(r.end, 6)), -1);
    if (to < r.end) to = addDays(to, 7);
  } else if (view === "semana") {
    from = weekStart(ref);
    to = addDays(from, 6);
  } else {
    from = ref;
    to = addDays(ref, 30);
  }
  const filters = { kind: sp.tipo || null, squadId: sp.squad || null, clientId: sp.cliente || null, userId: sp.pessoa || null };
  const events = await listEvents(actor, { from: localToInstant(from), to: localToInstant(addDays(to, 1)), ...filters, includeCancelled: sp.canceladas === "1" });
  // Prazos de tarefas (não são eventos — exibidos tracejados para contexto)
  const ids = scopeIds(await clientScope(actor));
  const dues = sp.prazos === "0" ? [] : await sql<{ id: string; title: string; due_date: string; client_name: string | null; status: string }[]>`
    SELECT t.id, t.title, t.due_date, c.name AS client_name, t.status FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada') AND t.parent_task_id IS NULL AND t.due_date BETWEEN ${from}::date AND ${to}::date
      AND (${ids}::uuid[] IS NULL OR t.client_id IS NULL OR t.client_id = ANY(${ids}::uuid[]))
      AND (${filters.clientId}::uuid IS NULL OR t.client_id = ${filters.clientId})
      AND (${filters.userId}::uuid IS NULL OR t.assignee_id = ${filters.userId})
      AND (${filters.squadId}::uuid IS NULL OR t.client_id IN (SELECT client_id FROM client_squads WHERE squad_id = ${filters.squadId}) OR t.assignee_id IN (SELECT user_id FROM squad_members WHERE squad_id = ${filters.squadId}))
      AND ${!filters.kind || filters.kind === "entrega"}
    ORDER BY t.due_date LIMIT 300`;
  const [squads, users, clients] = await Promise.all([squadsList(), usersList(), visibleClients(actor)]);
  const manager = isManager(actor);
  const q = (patch: Record<string, string>) => `/agenda?${new URLSearchParams(Object.fromEntries(Object.entries({ ...sp, ...patch }).filter(([, v]) => v != null && v !== "")) as Record<string, string>).toString()}`;
  const step = view === "mes" ? (d: number) => shiftMonth(ref.slice(0, 7), d) + "-01" : view === "semana" ? (d: number) => addDays(ref, 7 * d) : (d: number) => addDays(ref, 30 * d);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const evOn = (d: string) => events.filter((e) => dateOfInstant(e.starts_at) <= d && dateOfInstant(e.ends_at ?? e.starts_at) >= d);
  const tdy = today();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Agenda operacional</h1>
          <p className="sub">Produções, reuniões, entregas, feriados e indisponibilidades. Um único registro por evento, visível em todos os filtros.</p>
        </div>
        <div className="row">
          <div className="lens">
            <Link href={q({ visao: "semana" })} className={view === "semana" ? "on" : ""}>Semana</Link>
            <Link href={q({ visao: "mes" })} className={view === "mes" ? "on" : ""}>Mês</Link>
            <Link href={q({ visao: "lista" })} className={view === "lista" ? "on" : ""}>Lista</Link>
          </div>
          <Link className="btn sm" href={q({ data: step(-1) })}>‹</Link>
          <b style={{ minWidth: 150, textAlign: "center" }}>{view === "mes" ? fmtMonth(ref.slice(0, 7)) : `${fmtDate(from)} – ${fmtDate(to, { year: true })}`}</b>
          <Link className="btn sm" href={q({ data: step(1) })}>›</Link>
          <Link className="btn sm" href={q({ data: tdy })}>Hoje</Link>
        </div>
      </div>
      <form className="filters" method="get">
        <input type="hidden" name="visao" value={view} /><input type="hidden" name="data" value={ref} />
        <div className="field"><label>Tipo</label><select name="tipo" defaultValue={filters.kind ?? ""}><option value="">Todos</option>{Object.entries(EVENT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label>Squad</label><select name="squad" defaultValue={filters.squadId ?? ""}><option value="">Todos</option>{squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>Cliente</label><select name="cliente" defaultValue={filters.clientId ?? ""}><option value="">Todos</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>Pessoa</label><select name="pessoa" defaultValue={filters.userId ?? ""}><option value="">Todas</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <label className="check"><input type="checkbox" name="canceladas" value="1" defaultChecked={sp.canceladas === "1"} /> mostrar canceladas</label>
        <label className="check"><input type="checkbox" name="prazos" value="0" defaultChecked={sp.prazos === "0"} /> ocultar prazos de tarefas</label>
        <button className="btn primary">Filtrar</button>
      </form>

      <div className={manager || true ? "grid g-side" : ""}>
        <div>
          {view === "lista" ? (
            <Card tight>
              {events.length + dues.length === 0 ? <Empty title="Nada no período" /> : (
                <ul className="list">
                  {days.map((d) => {
                    const ev = evOn(d);
                    const du = dues.filter((t) => t.due_date === d);
                    if (!ev.length && !du.length) return null;
                    return (
                      <li key={d}>
                        <b className={d === tdy ? "late" : ""}>{fmtDate(d, { weekday: true })}</b>
                        {ev.map((e) => <div key={e.id} className="row" style={{ marginTop: 4 }}><Link href={`/agenda/${e.id}`} className={`ev ev-${e.kind} ${e.status}`} style={{ marginBottom: 0 }}>{e.all_day ? "dia todo" : fmtTime(e.starts_at)} · {e.title}</Link><span className="small muted">{EVENT_STATUS[e.status]}{e.client_name ? ` · ${e.client_name}` : ""}{e.participants.length ? ` · ${e.participants.map((p) => p.name).join(", ")}` : ""}</span></div>)}
                        {du.map((t) => <div key={t.id} className="small" style={{ marginTop: 4 }}>⏷ Prazo: <Link href={`/tarefas/${t.id}`}>{t.title}</Link> <span className="muted">· {t.client_name ?? "Interno"}</span></div>)}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              <div className={`cal ${view === "semana" ? "week" : ""}`}>
                {WD.map((w) => <div key={w} className="dh">{w}</div>)}
                {days.map((d) => (
                  <div key={d} className={`day ${d === tdy ? "today" : ""} ${view === "mes" && d.slice(0, 7) !== ref.slice(0, 7) ? "out" : ""}`}>
                    <div className="n">{view === "semana" ? fmtDate(d, { weekday: true }) : Number(d.slice(8))}</div>
                    {evOn(d).map((e) => (
                      <Link key={e.id} href={`/agenda/${e.id}`} className={`ev ev-${e.kind} ${e.status}`} title={`${EVENT_KIND[e.kind]} · ${e.participants.map((p) => p.name).join(", ")}`}>
                        {e.all_day ? "" : `${fmtTime(e.starts_at)} `}{e.title}
                      </Link>
                    ))}
                    {dues.filter((t) => t.due_date === d).slice(0, view === "mes" ? 3 : 12).map((t) => (
                      <Link key={t.id} href={`/tarefas/${t.id}`} className="ev tarefa" title="Prazo de tarefa">⏷ {t.title}</Link>
                    ))}
                    {view === "mes" && dues.filter((t) => t.due_date === d).length > 3 ? <span className="small muted">+{dues.filter((t) => t.due_date === d).length - 3} prazos</span> : null}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>Legenda: <span className="ev ev-producao" style={{ display: "inline" }}>produção</span> <span className="ev ev-reuniao" style={{ display: "inline" }}>reunião</span> <span className="ev ev-entrega" style={{ display: "inline" }}>entrega</span> <span className="ev ev-indisponibilidade" style={{ display: "inline" }}>indisponibilidade</span> <span className="ev ev-feriado" style={{ display: "inline" }}>feriado</span> <span className="ev tarefa" style={{ display: "inline" }}>⏷ prazo de tarefa</span></p>
        </div>
        <Card title="Novo evento" hint={manager ? "Produções podem ser vinculadas a um fluxo/ciclo e a uma tarefa (prazo acompanha remarcações)." : "Registre sua indisponibilidade ou uma reunião da qual participa."}>
          <ActionForm action={createEventAction} className="stack" reset>
            <Field label="Tipo"><select name="kind" defaultValue={manager ? "producao" : "indisponibilidade"}>{Object.entries(EVENT_KIND).filter(([k]) => manager || k === "indisponibilidade" || k === "reuniao").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Título"><input name="title" required /></Field>
            <div className="form-grid">
              <Field label="Data"><input type="date" name="date" defaultValue={ref} required /></Field>
              <Field label="Início"><input type="time" name="startTime" /></Field>
              <Field label="Fim"><input type="time" name="endTime" /></Field>
            </div>
            <label className="check"><input type="checkbox" name="allDay" /> Dia todo</label>
            {manager ? (
              <>
                <Field label="Cliente"><select name="clientId"><option value="">— interno</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <FlowSelect actorClients={clients.map((c) => c.id)} />
                <Field label="Squad"><select name="squadId"><option value="">—</option>{squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              </>
            ) : null}
            <Field label="Participantes"><div className="row">{users.map((u) => <label key={u.id} className="check"><input type="checkbox" name="participantIds" value={u.id} defaultChecked={!manager && u.id === actor.id} /> {u.name}</label>)}</div></Field>
            <Field label="Local"><input name="location" /></Field>
            <label className="check"><input type="checkbox" name="force" /> Salvar mesmo com conflito de agenda</label>
            <Submit>Agendar</Submit>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}

async function FlowSelect({ actorClients }: { actorClients: string[] }) {
  const flows = await sql<{ id: string; name: string; client_name: string }[]>`
    SELECT f.id, f.name, c.name AS client_name FROM flow_instances f JOIN clients c ON c.id = f.client_id
    WHERE f.status IN ('ativo','planejado','em_espera') AND f.client_id = ANY(${actorClients}::uuid[]) ORDER BY c.name, f.name`;
  return (
    <Field label="Fluxo / ciclo (opcional)" help="O evento aparecerá dentro do fluxo."><select name="flowId"><option value="">—</option>{flows.map((f) => <option key={f.id} value={f.id}>{f.client_name} · {f.name}</option>)}</select></Field>
  );
}
