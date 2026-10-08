import Link from "next/link";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { visibleClients } from "@/lib/queries";
import { dailySummaryText, getDay, type DayTask } from "@/lib/services/daily";
import { addDays, fmtDate, fmtDateTime, fmtTime, today } from "@/lib/dates";
import { BLOCK_REASON, EVENT_KIND, MANUAL_KIND, fmtBlocker } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { CopyButton } from "@/components/ClientBits";
import { Card, Demo, Empty, Field, StatusPill } from "@/components/ui";
import { InlineStatus } from "@/components/TaskList";
import { answerJustificationAction, closeDayAction, completeTaskAction, deleteManualEntryAction, manualEntryAction } from "../../actions";

export const metadata = { title: "Meu Dia" };

export default async function MyDayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const day = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : today();
  const userId = sp.pessoa && isManager(actor) ? sp.pessoa : actor.id;
  const d = await getDay(actor, userId, day);
  const own = userId === actor.id;
  const clients = own ? await visibleClients(actor) : [];
  const myOpen = own ? [...d.planned, ...d.overdue, ...d.upcoming, ...d.blocked] : [];
  const team = isManager(actor)
    ? await sql<{ id: string; name: string }[]>`SELECT DISTINCT u.id, u.name FROM users u JOIN squad_members sm ON sm.user_id = u.id
        WHERE u.active AND (${actor.role === "admin"} OR sm.squad_id IN (SELECT squad_id FROM squad_members WHERE user_id = ${actor.id} UNION SELECT id FROM squads WHERE leader_id = ${actor.id})) ORDER BY u.name`
    : [];
  const link = (patch: Record<string, string>) => `/meu-dia?${new URLSearchParams({ ...(sp.pessoa ? { pessoa: sp.pessoa } : {}), dia: day, ...patch }).toString()}`;
  const past = day < today();
  const summary = dailySummaryText(d);

  const TaskRows = ({ list, empty }: { list: DayTask[]; empty: string }) =>
    list.length === 0 ? <Empty title={empty} /> : (
      <div>{list.map((t) => (
        <div key={t.id} className="task-row" style={{ gridTemplateColumns: "minmax(0,1fr) 130px 84px auto" }}>
          <div className="title"><Link href={`/tarefas/${t.id}`}>{t.title}</Link>{t.is_extra ? <span className="badge b-neutral" style={{ marginLeft: 6 }}>extra</span> : null}
            <div className="sub">{t.client_name ?? "Interno"}{t.flow_name ? ` · ${t.flow_name}` : ""}{t.est_hours != null ? ` · ${t.est_hours}h` : ""}{t.blocker ? ` · ${fmtBlocker(t.blocker)}` : ""}</div></div>
          <div><InlineStatus t={{ ...t, assignee_id: userId, assignee_name: null }} canEdit={own || isManager(actor)} /></div>
          <div className={`small mono ${t.due_date && t.due_date < day ? "late" : ""}`}>{fmtDate(t.due_date)}</div>
          <div>{own && !["concluida", "bloqueada"].includes(t.status) ? (
            <ActionForm action={completeTaskAction} className="row" style={{ gap: 4 }}>
              <input type="hidden" name="taskId" value={t.id} />
              {past ? <input type="hidden" name="occurredOn" value={day} /> : null}
              <Submit className="btn sm ok" pendingText="…">✓ {past ? `Feito em ${fmtDate(day)}` : "Concluir"}</Submit>
            </ActionForm>
          ) : null}</div>
        </div>
      ))}</div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{own ? "Meu Dia" : `Dia de ${d.person.name}`}</h1>
          <p className="sub">{fmtDate(day, { weekday: true, year: true })}{d.isToday ? " · hoje" : ""} — o que estava previsto, o que aconteceu de fato e o que precisa de atenção. Registre do seu jeito: planejando antes, marcando durante ou lançando ao final.</p>
        </div>
        <div className="row">
          <Link className="btn sm" href={link({ dia: addDays(day, -1) })}>‹ Dia anterior</Link>
          {!d.isToday ? <Link className="btn sm" href={link({ dia: today() })}>Hoje</Link> : null}
          <Link className="btn sm" href={link({ dia: addDays(day, 1) })}>Próximo ›</Link>
          {team.length ? (
            <form method="get" className="row">
              <input type="hidden" name="dia" value={day} />
              <select name="pessoa" defaultValue={userId} className="inline">{[{ id: actor.id, name: `${actor.name} (eu)` }, ...team.filter((u) => u.id !== actor.id)].map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              <button className="btn sm">Ver</button>
            </form>
          ) : null}
        </div>
      </div>

      {d.requests.length && own ? (
        <Card title={`O líder pediu o motivo de ${d.requests.length} pendência(s)`} hint="Responda com uma categoria — vai para a tarefa, o histórico e a central do líder.">
          <div className="stack">{d.requests.map((r) => (
            <div key={r.id} className="card card-b">
              <div className="small"><b>{r.by_name}</b> em {fmtDateTime(r.requested_at)} sobre <Link href={`/tarefas/${r.task_id}`}>{r.title}</Link>{r.question ? `: “${r.question}”` : ""}</div>
              <ActionForm action={answerJustificationAction} className="form-grid" style={{ marginTop: 8 }}>
                <input type="hidden" name="requestId" value={r.id} />
                <Field label="Motivo"><select name="category" required defaultValue=""><option value="" disabled>Escolha…</option>{Object.entries(BLOCK_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Previsão de solução"><input type="date" name="expectedResolution" /></Field>
                <Field label="Comentário" full><input name="answer" /></Field>
                <label className="check"><input type="checkbox" name="alsoBlock" /> Marcar tarefa como bloqueada</label>
                <div><Submit className="btn sm primary">Responder</Submit></div>
              </ActionForm>
            </div>
          ))}</div>
        </Card>
      ) : null}

      <div className="grid g-side" style={{ marginTop: d.requests.length && own ? 14 : 0 }}>
        <div className="stack">
          <Card title={`Previsto para ${d.isToday ? "hoje" : "o dia"} (${d.planned.length})`} hint="Prazo no dia, em andamento ou com início alcançado." tight><TaskRows list={d.planned} empty="Nada previsto" /></Card>
          {d.overdue.length ? <Card title={`Atrasadas (${d.overdue.length})`} hint="Prazo vencido sem espera planejada. Se não der, use “Bloquear” na tarefa e informe o motivo." tight><TaskRows list={d.overdue} empty="" /></Card> : null}
          {d.blocked.length ? <Card title={`Bloqueadas (${d.blocked.length})`} tight><TaskRows list={d.blocked} empty="" /></Card> : null}
          <Card title={`Concluídas no dia (${d.completed.length})`} hint="Conclusões efetivas com a data em que ocorreram." tight>
            {d.completed.length === 0 ? <Empty title="Nenhuma conclusão registrada neste dia" /> : (
              <ul className="list">{d.completed.map((t) => (
                <li key={t.id} className="row between">
                  <span><Link href={`/tarefas/${t.id}`}>{t.title}</Link> <span className="small muted">· {t.client_name ?? "Interno"}{t.is_extra ? " · extra" : ""}</span></span>
                  <span className="small muted">{fmtTime(t.completed_at)}{t.completed_recorded_at && t.completed_at && Math.abs(t.completed_recorded_at.getTime() - t.completed_at.getTime()) > 3 * 3600000 ? ` · registrada ${fmtDateTime(t.completed_recorded_at)}` : ""}</span>
                </li>
              ))}</ul>
            )}
          </Card>
          <Card title="Próximos prazos (7 dias)" tight><TaskRows list={d.upcoming} empty="Nenhum prazo nos próximos 7 dias" /></Card>
        </div>

        <div className="stack">
          <Card title="Compromissos" hint="Agendado não é realizado: a participação só conta após confirmação." tight>
            {d.events.length === 0 ? <Empty title="Sem compromissos na agenda" /> : (
              <ul className="list">{d.events.map((e) => (
                <li key={e.id}>
                  <Link href={`/agenda/${e.id}`}><b>{e.all_day ? "Dia todo" : fmtTime(e.starts_at)} · {e.title}</b></Link>
                  <div className="small muted">{EVENT_KIND[e.kind]}{e.client_name ? ` · ${e.client_name}` : ""} · {e.status === "realizado" ? (e.attendance === "confirmado" ? "participação confirmada" : "ausente") : "agendado"}</div>
                </li>
              ))}</ul>
            )}
          </Card>

          {own ? (
            <Card title="Registrar atividade" hint="Complemente sem duplicar: vincule a uma tarefa existente ou registre demanda não planejada.">
              <ActionForm action={manualEntryAction} className="stack" reset>
                <input type="hidden" name="day" value={day} />
                <Field label="Tipo"><select name="kind" defaultValue="complemento">{Object.entries(MANUAL_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="O que foi feito"><textarea name="description" required placeholder="Ex.: revisei marcações de 4 vídeos; ligação com cliente sobre acesso…" /></Field>
                <Field label="Tarefa existente (complemento)" help="Se escolher, NÃO cria tarefa nova — só registra o complemento."><select name="taskId" defaultValue=""><option value="">— nenhuma</option>{myOpen.map((t) => <option key={t.id} value={t.id}>{t.title}{t.client_name ? ` (${t.client_name})` : ""}</option>)}</select></Field>
                <div className="form-grid">
                  <Field label="Cliente"><select name="clientId" defaultValue=""><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                  <Field label="Tempo gasto (h)"><input name="hours" inputMode="decimal" /></Field>
                </div>
                <Field label="Link / evidência"><input name="link" type="url" placeholder="https://" /></Field>
                <label className="check"><input type="checkbox" name="createAsTask" /> Demanda não planejada: registrar também como tarefa extra concluída (conta esforço, não altera escopo vendido)</label>
                <Submit>Registrar {past ? `em ${fmtDate(day)}` : ""}</Submit>
              </ActionForm>
            </Card>
          ) : null}

          <Card title="Linha do tempo do dia" hint="Ações confirmadas, na hora em que ocorreram." tight>
            {d.feed.length === 0 && d.manual.length === 0 ? <Empty title="Nenhuma ação registrada" /> : (
              <ul className="timeline">
                {d.feed.map((e) => (
                  <li key={`e${e.id}`}><span className="when">{fmtTime(e.occurred_at)}</span>
                    <div>{e.summary}{e.client_name ? <span className="small muted"> · {e.client_name}</span> : null}
                      {e.reason ? <div className="why">{e.reason}</div> : null}
                      {Math.abs(e.recorded_at.getTime() - e.occurred_at.getTime()) > 3 * 3600000 ? <div className="retro">registrado {fmtDateTime(e.recorded_at)}</div> : null}</div></li>
                ))}
              </ul>
            )}
            {d.manual.length ? (
              <ul className="list">{d.manual.map((m) => (
                <li key={m.id} className="row between top">
                  <div><span className="badge b-neutral">{MANUAL_KIND[m.kind]}</span> {m.description}{m.hours ? ` · ${m.hours}h` : ""}
                    <div className="small muted">{m.client_name ?? ""}{m.task_title ? ` → ${m.task_title}` : ""}{m.link ? <> · <a href={m.link} target="_blank" rel="noreferrer">link</a></> : null} · registrado {fmtDateTime(m.recorded_at)}</div></div>
                  {own ? <ActionForm action={deleteManualEntryAction}><input type="hidden" name="id" value={m.id} /><Submit className="btn sm ghost" pendingText="…">×</Submit></ActionForm> : null}
                </li>
              ))}</ul>
            ) : null}
            <div className="card-b small muted">Horas apontadas no dia: {d.hours.entries ? <b>{d.hours.total}h</b> : "sem apontamento"}</div>
          </Card>

          {own && (d.isToday || past) ? (
            <Card title="Fechamento do dia (opcional)" hint="Divergências para confirmar. Explique apenas o que achar relevante.">
              <ActionForm action={closeDayAction} className="stack">
                <input type="hidden" name="day" value={day} />
                {d.divergences.length === 0 ? <p className="small muted">Nenhuma divergência detectada.</p> : d.divergences.map((v) => (
                  <div key={v.id}>
                    <div className="small">{v.text}</div>
                    {v.type === "tarefa" ? (<><input type="hidden" name="reasonTask" value={v.id} /><input name={`reason_${v.id}`} placeholder="Motivo (opcional)" /></>) : <Link className="small" href={`/agenda/${v.id}`}>Confirmar na agenda</Link>}
                  </div>
                ))}
                <Field label="Observação do dia"><textarea name="summary" defaultValue={d.closing?.summary ?? ""} /></Field>
                <Submit className="btn">{d.closing ? "Atualizar fechamento" : "Fechar o dia"}</Submit>
                {d.closing ? <p className="small muted">Fechado em {fmtDateTime(d.closing.recorded_at)}</p> : null}
              </ActionForm>
            </Card>
          ) : null}

          <Card title="Resumo para o líder" hint="Gerado a partir dos registros (sem IA). Copie e cole onde precisar.">
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, background: "var(--surface-2)", padding: 10, borderRadius: 8, margin: "0 0 8px" }}>{summary}</pre>
            <CopyButton text={summary} />
          </Card>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}><Demo on={actor.is_demo} /> Texto livre não é prova de conclusão: só tarefas marcadas como concluídas contam no progresso.</p>
    </div>
  );
}
