import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { isManager, loadTaskForActor } from "@/lib/access";
import { AppError } from "@/lib/errors";
import { usersList } from "@/lib/queries";
import { fmtDate, fmtDateTime, today } from "@/lib/dates";
import { BLOCK_REASON, EDITORIAL_STATE, INTERVENTION_KIND, PRIORITY, SCOPE_CLASS, TASK_STATUS } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Demo, Empty, Field, StatusPill } from "@/components/ui";
import {
  answerJustificationAction, baselineAction, blockTaskAction, cancelTaskAction, checklistAction, completeTaskAction, createTaskAction, deleteTaskAction, dependencyAction,
  evidenceAction, interventionAction, reopenTaskAction, requestJustificationAction, resolveBlockerAction, resolveInterventionAction, taskStatusAction, timeEntryAction, updateTaskAction, waitingAction,
} from "@/app/actions";

export const metadata = { title: "Tarefa" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    await loadTaskForActor(actor, id); // permissão no servidor (AT-14)
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const [t] = await sql<{ id: string; title: string; description: string | null; status: string; priority: string; stage: string | null; start_date: string | null; due_date: string | null; est_hours: number | null; in_baseline: boolean; is_extra: boolean; scope_class: string | null; waiting_until: string | null; waiting_reason: string | null; done_criteria: string | null; checklist: { text: string; done: boolean }[]; completed_at: Date | null; completed_recorded_at: Date | null; cancel_reason: string | null; cancel_scope_treatment: string | null; reopened_count: number; origin: string; created_at: Date; is_demo: boolean;
    client_id: string | null; client_name: string | null; client_demo: boolean; flow_id: string | null; flow_name: string | null; flow_status: string | null; cycle_label: string | null; service_name: string | null; assignee_id: string | null; assignee_name: string | null; creator: string | null; parent_task_id: string | null; parent_title: string | null; content_id: string | null; content_title: string | null; content_state: string | null; content_published: Date | null; deliverables: string | null }[]>`
    SELECT t.*, c.name AS client_name, c.is_demo AS client_demo, f.name AS flow_name, f.status AS flow_status, f.cycle_label, s.name AS service_name, u.name AS assignee_name, cr.name AS creator,
      p.title AS parent_title, ca.title AS content_title, ca.editorial_state AS content_state, ca.published_at AS content_published,
      (SELECT string_agg(d.name, ', ') FROM flow_deliverables fd JOIN deliverables d ON d.id = fd.deliverable_id WHERE fd.flow_id = t.flow_id) AS deliverables
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN flow_instances f ON f.id = t.flow_id LEFT JOIN services s ON s.id = f.service_id
    LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cr ON cr.id = t.created_by LEFT JOIN tasks p ON p.id = t.parent_task_id LEFT JOIN content_assets ca ON ca.id = t.content_id
    WHERE t.id = ${id}`;
  const manager = isManager(actor);
  const mine = t.assignee_id === actor.id;
  const canAct = manager || mine || !t.assignee_id;
  const [subtasks, evidence, hours, deps, blockers, requests, interventions, history, users, siblings] = await Promise.all([
    sql<{ id: string; title: string; status: string; due_date: string | null }[]>`SELECT id, title, status, due_date FROM tasks WHERE parent_task_id = ${id} AND deleted_at IS NULL ORDER BY position`,
    sql<{ id: string; url: string | null; note: string | null; created_at: Date; author: string | null }[]>`SELECT e.*, u.name AS author FROM task_evidence e LEFT JOIN users u ON u.id = e.created_by WHERE e.task_id = ${id} ORDER BY e.created_at DESC`,
    sql<{ id: string; hours: number; occurred_on: string; note: string | null; who: string }[]>`SELECT te.id, te.hours, te.occurred_on, te.note, u.name AS who FROM time_entries te JOIN users u ON u.id = te.user_id WHERE te.task_id = ${id} ORDER BY te.occurred_on DESC`,
    sql<{ id: string; title: string; status: string }[]>`SELECT t.id, t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id WHERE d.task_id = ${id}`,
    sql<{ id: string; reason_category: string; comment: string | null; release_owner: string | null; expected_resolution: string | null; opened_at: Date; resolved_at: Date | null; resolution: string | null; opener: string | null; resolver: string | null }[]>`
      SELECT b.*, o.name AS opener, r.name AS resolver FROM blockers b LEFT JOIN users o ON o.id = b.opened_by LEFT JOIN users r ON r.id = b.resolved_by WHERE b.task_id = ${id} ORDER BY b.opened_at DESC`,
    sql<{ id: string; question: string | null; requested_at: Date; answered_at: Date | null; reason_category: string | null; answer: string | null; expected_resolution: string | null; requested_to: string; by_name: string; to_name: string }[]>`
      SELECT jr.*, a.name AS by_name, b.name AS to_name FROM justification_requests jr JOIN users a ON a.id = jr.requested_by JOIN users b ON b.id = jr.requested_to WHERE jr.task_id = ${id} ORDER BY jr.requested_at DESC`,
    manager ? sql<{ id: string; kind: string; text: string; created_at: Date; resolved_at: Date | null; author: string; responsible: string | null; due_date: string | null }[]>`
      SELECT mi.*, a.name AS author, r.name AS responsible FROM manager_interventions mi JOIN users a ON a.id = mi.author_id LEFT JOIN users r ON r.id = mi.responsible_id WHERE mi.task_id = ${id} ORDER BY mi.created_at DESC` : Promise.resolve([]),
    sql<{ id: number; occurred_at: Date; recorded_at: Date; summary: string; reason: string | null; actor: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[]>`
      SELECT oe.id, oe.occurred_at, oe.recorded_at, oe.summary, oe.reason, u.name AS actor, oe.before, oe.after FROM operational_events oe LEFT JOIN users u ON u.id = oe.actor_id WHERE oe.task_id = ${id} ORDER BY oe.occurred_at DESC, oe.id DESC`,
    usersList(),
    t.flow_id ? sql<{ id: string; title: string }[]>`SELECT id, title FROM tasks WHERE flow_id = ${t.flow_id} AND id <> ${id} AND deleted_at IS NULL ORDER BY position` : Promise.resolve([]),
  ]);
  const openBlocker = blockers.find((b) => !b.resolved_at);
  const closed = ["concluida", "cancelada"].includes(t.status);
  const late = t.due_date && t.due_date < today() && !closed;
  const back = t.flow_id ? `/fluxos/${t.flow_id}` : t.client_id ? `/clientes/${t.client_id}` : "/meu-dia";

  return (
    <div className="page">
      <div className="crumbs">
        {t.client_id ? <><Link href={`/clientes/${t.client_id}`}>{t.client_name}</Link> / </> : <>Interno / </>}
        {t.flow_id ? <><Link href={`/fluxos/${t.flow_id}`}>{t.flow_name}</Link> / </> : null}
        {t.parent_task_id ? <><Link href={`/tarefas/${t.parent_task_id}`}>{t.parent_title}</Link> / </> : null}
        tarefa
      </div>
      <div className="page-head">
        <div>
          <h1>{t.title} <Demo on={t.is_demo || t.client_demo} /></h1>
          <p className="sub">
            <StatusPill status={t.status} /> · {t.assignee_name ?? "sem responsável"} · prazo <span className={late ? "late" : ""}>{fmtDate(t.due_date, { year: true })}</span> · {t.est_hours != null ? `${t.est_hours}h estimadas` : "sem estimativa (sem peso no progresso)"} · prioridade {PRIORITY[t.priority].toLowerCase()}
          </p>
          <p className="small muted">
            Atende: {t.client_name ?? "rotina interna"}{t.service_name ? ` · serviço ${t.service_name}` : ""}{t.deliverables ? ` · entregável ${t.deliverables}` : ""}{t.flow_name ? ` · fluxo ${t.flow_name}` : ""}{t.cycle_label ? ` · ciclo ${t.cycle_label}` : ""}
            {t.content_title ? ` · conteúdo “${t.content_title}” (${EDITORIAL_STATE[t.content_state!]}${t.content_published ? `, publicado ${fmtDateTime(t.content_published)}` : ", não publicado"})` : ""}
          </p>
          <p className="small muted">
            {t.in_baseline ? `Na base planejada` : t.is_extra ? "Demanda não planejada (conta esforço, não altera o escopo vendido)" : "Fora da base planejada"}
            {t.scope_class ? ` · ${SCOPE_CLASS[t.scope_class]}` : ""} · criada por {t.creator ?? "—"} em {fmtDateTime(t.created_at)} · origem {t.origin}
            {t.reopened_count ? ` · reaberta ${t.reopened_count}x` : ""}
          </p>
        </div>
        <Link className="btn" href={back}>← Voltar ao {t.flow_id ? "fluxo" : t.client_id ? "cliente" : "Meu Dia"}</Link>
      </div>

      {t.status === "concluida" ? <div className="callout info" style={{ marginBottom: 12 }}>Concluída em {fmtDateTime(t.completed_at)}{t.completed_recorded_at && Math.abs(t.completed_recorded_at.getTime() - t.completed_at!.getTime()) > 3 * 3600000 ? ` (registrada em ${fmtDateTime(t.completed_recorded_at)})` : ""}.</div> : null}
      {t.status === "cancelada" ? <div className="callout warn" style={{ marginBottom: 12 }}>Cancelada: {t.cancel_reason} · {t.cancel_scope_treatment === "remover_da_base" ? "removida da base planejada" : "mantida na base como pendente"}.</div> : null}
      {openBlocker ? <div className="callout warn" style={{ marginBottom: 12 }}><b>Bloqueada — {BLOCK_REASON[openBlocker.reason_category]}</b>{openBlocker.comment ? `: ${openBlocker.comment}` : ""}. Liberação: {openBlocker.release_owner ?? "não informado"} · previsão {fmtDate(openBlocker.expected_resolution)} · aberto por {openBlocker.opener} em {fmtDateTime(openBlocker.opened_at)}.</div> : null}
      {t.waiting_until && t.waiting_until >= today() ? <div className="callout info" style={{ marginBottom: 12 }}>Espera planejada até {fmtDate(t.waiting_until)}: {t.waiting_reason}</div> : null}

      <div className="grid g-side">
        <div className="stack">
          {canAct ? (
            <Card title="Atualizar">
              {!closed ? (
                <div className="stack">
                  <div className="row">
                    {t.status !== "em_andamento" ? <ActionForm action={taskStatusAction}><input type="hidden" name="taskId" value={id} /><input type="hidden" name="status" value="em_andamento" /><Submit className="btn">▶ Começar</Submit></ActionForm> : null}
                    {t.status !== "em_revisao" ? <ActionForm action={taskStatusAction}><input type="hidden" name="taskId" value={id} /><input type="hidden" name="status" value="em_revisao" /><Submit className="btn">Enviar para revisão</Submit></ActionForm> : null}
                    {t.status !== "a_fazer" ? <ActionForm action={taskStatusAction}><input type="hidden" name="taskId" value={id} /><input type="hidden" name="status" value="a_fazer" /><Submit className="btn ghost">Voltar para a fazer</Submit></ActionForm> : null}
                  </div>
                  <ActionForm action={completeTaskAction} className="row">
                    <input type="hidden" name="taskId" value={id} />
                    <Submit className="btn ok">✓ Concluir</Submit>
                    <label className="small row" style={{ gap: 6, margin: 0 }}>ocorreu em <input type="date" name="occurredOn" defaultValue={today()} max={today()} style={{ width: 150 }} /></label>
                    <span className="small muted">Registro retrospectivo preserva as duas datas.</span>
                  </ActionForm>
                  <div className="grid g2">
                    {t.status !== "bloqueada" ? (
                      <details className="panel"><summary>Bloquear (informar motivo)</summary>
                        <ActionForm action={blockTaskAction} className="stack">
                          <input type="hidden" name="taskId" value={id} />
                          <select name="category" required defaultValue=""><option value="" disabled>Categoria do motivo…</option>{Object.entries(BLOCK_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                          <textarea name="comment" placeholder="Explique (o líder verá)" />
                          <input name="releaseOwner" placeholder="Quem precisa liberar? (cliente, fornecedor, pessoa)" />
                          <label className="small">Previsão de solução<input type="date" name="expectedResolution" /></label>
                          <input name="link" placeholder="Link/anexo (opcional)" />
                          <Submit className="btn danger">Registrar bloqueio</Submit>
                        </ActionForm>
                      </details>
                    ) : openBlocker ? (
                      <details className="panel" open><summary>Resolver bloqueio</summary>
                        <ActionForm action={resolveBlockerAction} className="stack">
                          <input type="hidden" name="blockerId" value={openBlocker.id} />
                          <textarea name="resolution" placeholder="Como foi resolvido?" required />
                          <select name="nextStatus" defaultValue="em_andamento"><option value="em_andamento">Voltar para em andamento</option><option value="a_fazer">Voltar para a fazer</option><option value="em_revisao">Em revisão</option></select>
                          <Submit className="btn ok">Desbloquear</Submit>
                        </ActionForm>
                      </details>
                    ) : null}
                    <details className="panel"><summary>Espera planejada</summary>
                      <ActionForm action={waitingAction} className="stack">
                        <input type="hidden" name="taskId" value={id} />
                        <label className="small">Até<input type="date" name="until" defaultValue={t.waiting_until ?? ""} /></label>
                        <input name="reason" placeholder="Ex.: aguardando captação de 19/10" defaultValue={t.waiting_reason ?? ""} />
                        <p className="small muted">Deixe a data vazia para encerrar a espera. Espera legítima não gera alerta de inatividade.</p>
                        <Submit className="btn">Salvar</Submit>
                      </ActionForm>
                    </details>
                    {manager || (t.is_extra && mine) ? (
                      <details className="panel"><summary>Cancelar</summary>
                        <ActionForm action={cancelTaskAction} className="stack">
                          <input type="hidden" name="taskId" value={id} />
                          <textarea name="reason" placeholder="Motivo (obrigatório)" required />
                          <select name="treatment" defaultValue="manter_na_base"><option value="manter_na_base">Manter na base planejada (conta como não entregue)</option><option value="remover_da_base">Remover da base planejada (mudança de escopo)</option></select>
                          <Submit className="btn danger">Cancelar tarefa</Submit>
                        </ActionForm>
                      </details>
                    ) : null}
                  </div>
                </div>
              ) : (
                <ActionForm action={reopenTaskAction} className="row">
                  <input type="hidden" name="taskId" value={id} />
                  <input name="reason" placeholder="Motivo da reabertura (obrigatório)" required className="grow" style={{ width: "auto" }} />
                  <Submit className="btn">Reabrir</Submit>
                </ActionForm>
              )}
            </Card>
          ) : <div className="note">Esta tarefa é de {t.assignee_name}. Você pode consultar o andamento; alterações ficam com o responsável ou o líder.</div>}

          <Card title="Descrição, critério de pronto e checklist">
            {t.description ? <p style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{t.description}</p> : <p className="nodata" style={{ marginBottom: 10 }}>Sem descrição.</p>}
            {t.done_criteria ? <p className="small" style={{ marginBottom: 10 }}><b>Critério de pronto:</b> {t.done_criteria}</p> : null}
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {t.checklist.map((c, i) => (
                <li key={i} className="row" style={{ padding: "3px 0" }}>
                  <ActionForm action={checklistAction}><input type="hidden" name="taskId" value={id} /><input type="hidden" name="toggle" value={i} /><Submit className="btn sm ghost" pendingText="…">{c.done ? "☑" : "☐"}</Submit></ActionForm>
                  <span style={c.done ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>{c.text}</span>
                  {canAct ? <ActionForm action={checklistAction}><input type="hidden" name="taskId" value={id} /><input type="hidden" name="remove" value={i} /><Submit className="btn sm ghost" pendingText="…">×</Submit></ActionForm> : null}
                </li>
              ))}
            </ul>
            {canAct ? <ActionForm action={checklistAction} className="row" reset><input type="hidden" name="taskId" value={id} /><input name="add" placeholder="Item de checklist (opcional)" className="grow" style={{ width: "auto" }} /><Submit className="btn sm">Adicionar</Submit></ActionForm> : null}
          </Card>

          {(subtasks.length || canAct) && !t.parent_task_id ? (
            <Card title="Subtarefas" tight>
              {subtasks.length === 0 ? <Empty title="Nenhuma subtarefa" /> : (
                <ul className="list">{subtasks.map((s) => <li key={s.id} className="row between"><Link href={`/tarefas/${s.id}`}>{s.title}</Link><span className="row"><span className="small mono">{fmtDate(s.due_date)}</span><StatusPill status={s.status} /></span></li>)}</ul>
              )}
              {canAct && !closed ? (
                <div className="card-b">
                  <ActionForm action={createTaskAction} className="row" reset>
                    <input type="hidden" name="parentTaskId" value={id} />{t.flow_id ? <input type="hidden" name="flowId" value={t.flow_id} /> : <input type="hidden" name="clientId" value={t.client_id ?? ""} />}
                    <input name="title" placeholder="Nova subtarefa" required className="grow" style={{ width: "auto" }} />
                    <input type="date" name="dueDate" style={{ width: 150 }} />
                    <input name="estHours" placeholder="h" style={{ width: 60 }} inputMode="decimal" />
                    {manager ? <label className="check"><input type="checkbox" name="inBaseline" defaultChecked={t.in_baseline && t.flow_status === "planejado"} /> na base</label> : null}
                    <Submit className="btn sm">Adicionar</Submit>
                  </ActionForm>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card title="Histórico auditável da tarefa" tight>
            {history.length === 0 ? <Empty title="Sem eventos" /> : (
              <ul className="timeline">{history.map((e) => (
                <li key={e.id}><span className="when">{fmtDateTime(e.occurred_at)}</span>
                  <div><b>{e.actor ?? "Sistema"}</b> — {e.summary}
                    {e.reason ? <div className="why">Motivo: {e.reason}</div> : null}
                    {e.before && e.after ? <div className="why">{Object.keys(e.after).filter((k) => k in (e.before ?? {})).map((k) => `${k}: ${fmtVal(e.before![k])} → ${fmtVal(e.after![k])}`).join(" · ")}</div> : null}
                    {Math.abs(e.recorded_at.getTime() - e.occurred_at.getTime()) > 3 * 3600000 ? <div className="retro">Registrado em {fmtDateTime(e.recorded_at)} (retrospectivo)</div> : null}
                  </div></li>
              ))}</ul>
            )}
          </Card>
        </div>

        <div className="stack">
          {requests.length ? (
            <Card title="Pedidos de motivo" tight>
              <ul className="list">{requests.map((r) => (
                <li key={r.id}>
                  <div className="small"><b>{r.by_name}</b> perguntou a {r.to_name} em {fmtDateTime(r.requested_at)}{r.question ? `: “${r.question}”` : ""}</div>
                  {r.answered_at ? <div className="just">{BLOCK_REASON[r.reason_category!]}{r.answer ? ` — ${r.answer}` : ""}{r.expected_resolution ? ` · previsão ${fmtDate(r.expected_resolution)}` : ""} <span className="muted">({fmtDateTime(r.answered_at)})</span></div>
                    : r.requested_to === actor.id ? (
                      <ActionForm action={answerJustificationAction} className="stack" style={{ marginTop: 6 }}>
                        <input type="hidden" name="requestId" value={r.id} />
                        <select name="category" required defaultValue=""><option value="" disabled>Motivo…</option>{Object.entries(BLOCK_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                        <textarea name="answer" placeholder="Comentário" />
                        <label className="small">Previsão de solução<input type="date" name="expectedResolution" /></label>
                        <label className="check"><input type="checkbox" name="alsoBlock" /> Marcar a tarefa como bloqueada com este motivo</label>
                        <Submit className="btn sm primary">Responder</Submit>
                      </ActionForm>
                    ) : <div className="small" style={{ color: "var(--warn)" }}>Aguardando resposta</div>}
                </li>
              ))}</ul>
            </Card>
          ) : null}

          {manager ? (
            <Card title="Líder: acompanhamento" tight>
              {interventions.length ? (
                <ul className="list">{interventions.map((i) => (
                  <li key={i.id}>
                    <div className="small"><b>{INTERVENTION_KIND[i.kind]}</b> · {i.author} · {fmtDateTime(i.created_at)} {i.resolved_at ? <span className="badge b-normal">resolvido</span> : null}</div>
                    <div>{i.text}</div>
                    <div className="small muted">{i.responsible ? `Responsável: ${i.responsible}` : ""}{i.due_date ? ` · prazo ${fmtDate(i.due_date)}` : ""}</div>
                    {!i.resolved_at ? <ActionForm action={resolveInterventionAction}><input type="hidden" name="id" value={i.id} /><Submit className="btn sm ghost">Marcar resolvido</Submit></ActionForm> : null}
                  </li>
                ))}</ul>
              ) : null}
              <div className="card-b stack">
                {t.assignee_id && !closed && !requests.some((r) => !r.answered_at) ? (
                  <ActionForm action={requestJustificationAction} className="stack">
                    <input type="hidden" name="taskId" value={id} />
                    <input name="question" placeholder={`Pergunta a ${t.assignee_name} (opcional)`} />
                    <Submit className="btn sm">Perguntar o motivo ao responsável</Submit>
                  </ActionForm>
                ) : null}
                <details className="panel"><summary>Registrar orientação / encaminhamento</summary>
                  <ActionForm action={interventionAction} className="stack" reset>
                    <input type="hidden" name="taskId" value={id} />
                    {openBlocker ? <input type="hidden" name="blockerId" value={openBlocker.id} /> : null}
                    <select name="kind" defaultValue="encaminhamento">{Object.entries(INTERVENTION_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <textarea name="text" placeholder="Orientação, correção ou decisão (fato ≠ justificativa ≠ decisão)" required />
                    <select name="responsibleId"><option value="">Responsável pelo encaminhamento…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                    {t.assignee_id ? <input type="hidden" name="subjectUserId" value={t.assignee_id} /> : null}
                    <label className="small">Prazo<input type="date" name="dueDate" /></label>
                    <Submit className="btn sm primary">Registrar</Submit>
                  </ActionForm>
                </details>
              </div>
            </Card>
          ) : null}

          <Card title="Evidências e links" tight>
            {evidence.length === 0 ? <Empty title="Nenhuma evidência" /> : (
              <ul className="list">{evidence.map((e) => (
                <li key={e.id}>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.url}</a> : null}{e.note ? <div className="small">{e.note}</div> : null}<div className="small muted">{e.author} · {fmtDateTime(e.created_at)}</div></li>
              ))}</ul>
            )}
            {canAct ? (
              <div className="card-b"><ActionForm action={evidenceAction} className="stack" reset>
                <input type="hidden" name="taskId" value={id} />
                <input name="url" placeholder="https://… (Drive, post publicado, arquivo)" type="url" />
                <input name="note" placeholder="Observação" />
                <Submit className="btn sm">Anexar evidência</Submit>
              </ActionForm></div>
            ) : null}
          </Card>

          <Card title="Horas reais" hint="Apontamento separado do progresso." tight>
            {hours.length === 0 ? <Empty title="Sem apontamento" /> : (
              <ul className="list">{hours.map((h) => <li key={h.id} className="row between small"><span>{h.who} · {fmtDate(h.occurred_on)}{h.note ? ` · ${h.note}` : ""}</span><b>{h.hours}h</b></li>)}</ul>
            )}
            <div className="card-b">
              <ActionForm action={timeEntryAction} className="row" reset>
                <input type="hidden" name="taskId" value={id} />
                <input name="hours" placeholder="Horas" inputMode="decimal" style={{ width: 80 }} required />
                <input type="date" name="occurredOn" defaultValue={today()} max={today()} style={{ width: 150 }} />
                <Submit className="btn sm">Apontar</Submit>
              </ActionForm>
            </div>
          </Card>

          <Card title="Dependências" tight>
            {deps.length === 0 ? <Empty title="Sem dependências" /> : (
              <ul className="list">{deps.map((d) => (
                <li key={d.id} className="row between"><span>Depende de <Link href={`/tarefas/${d.id}`}>{d.title}</Link> <StatusPill status={d.status} /></span>
                  {manager ? <ActionForm action={dependencyAction}><input type="hidden" name="taskId" value={id} /><input type="hidden" name="remove" value={d.id} /><Submit className="btn sm ghost">×</Submit></ActionForm> : null}</li>
              ))}</ul>
            )}
            {manager && siblings.length ? (
              <div className="card-b"><ActionForm action={dependencyAction} className="row">
                <input type="hidden" name="taskId" value={id} />
                <select name="dependsOn" className="grow" style={{ width: "auto" }}>{siblings.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
                <Submit className="btn sm">Adicionar</Submit>
              </ActionForm></div>
            ) : null}
          </Card>

          <Card title="Editar">
            <ActionForm action={updateTaskAction} className="stack">
              <input type="hidden" name="taskId" value={id} />
              <Field label="Título"><input name="title" defaultValue={t.title} required disabled={!manager && !(t.is_extra && mine)} /></Field>
              <Field label="Descrição"><textarea name="description" defaultValue={t.description ?? ""} /></Field>
              {manager ? (
                <>
                  <div className="form-grid">
                    <Field label="Responsável"><select name="assignee_id" defaultValue={t.assignee_id ?? ""}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                    <Field label="Prioridade"><select name="priority" defaultValue={t.priority}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    <Field label="Início"><input type="date" name="start_date" defaultValue={t.start_date ?? ""} /></Field>
                    <Field label="Prazo"><input type="date" name="due_date" defaultValue={t.due_date ?? ""} /></Field>
                    <Field label="Horas estimadas"><input name="est_hours" inputMode="decimal" defaultValue={t.est_hours ?? ""} /></Field>
                    <Field label="Etapa"><input name="stage" defaultValue={t.stage ?? ""} /></Field>
                    <Field label="Escopo"><select name="scope_class" defaultValue={t.scope_class ?? ""}><option value="">—</option>{Object.entries(SCOPE_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  </div>
                  <Field label="Critério de pronto"><input name="done_criteria" defaultValue={t.done_criteria ?? ""} /></Field>
                </>
              ) : t.is_extra && mine ? (
                <div className="form-grid">
                  <Field label="Prazo"><input type="date" name="due_date" defaultValue={t.due_date ?? ""} /></Field>
                  <Field label="Horas estimadas"><input name="est_hours" inputMode="decimal" defaultValue={t.est_hours ?? ""} /></Field>
                </div>
              ) : <p className="small muted">Responsável, prazo, estimativa e prioridade são definidos pelo líder.</p>}
              <Field label="Motivo da alteração" help="Obrigatório ao reprogramar prazo ou mudar estimativa de tarefa em execução."><input name="reason" /></Field>
              <Submit>Salvar alterações</Submit>
            </ActionForm>
          </Card>

          {manager && t.flow_id ? (
            <Card title="Base planejada">
              <p className="small" style={{ marginBottom: 8 }}>{t.in_baseline ? "Esta tarefa compõe o denominador do progresso do fluxo." : "Esta tarefa não altera o % vendido do fluxo."}</p>
              <ActionForm action={baselineAction} className="stack">
                <input type="hidden" name="taskId" value={id} />
                <input type="hidden" name="inBaseline" value={t.in_baseline ? "false" : "true"} />
                <input name="reason" placeholder="Motivo / aprovação da mudança de escopo" required />
                <Submit className="btn">{t.in_baseline ? "Retirar da base planejada" : "Incluir na base planejada"}</Submit>
              </ActionForm>
            </Card>
          ) : null}
          {manager ? (
            <details className="panel"><summary>Excluir lançamento indevido</summary>
              <ActionForm action={deleteTaskAction} className="stack" confirm="Excluir esta tarefa? O registro fica no histórico de auditoria.">
                <input type="hidden" name="taskId" value={id} /><input type="hidden" name="back" value={back} />
                <input name="reason" placeholder="Motivo (duplicada, lançada por engano…)" required />
                <Submit className="btn danger">Excluir</Submit>
              </ActionForm>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function fmtVal(v: unknown) {
  if (v == null || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === "string" && TASK_STATUS[v]) return TASK_STATUS[v];
  return String(v);
}
