import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { clientScope, inScope, isManager } from "@/lib/access";
import { flowProgress, usersList } from "@/lib/queries";
import { computeAlerts, healthOf } from "@/lib/services/alerts";
import { listEvents } from "@/lib/services/agenda";
import { addDays, fmtDate, fmtDateTime, localToInstant, monthOf, today } from "@/lib/dates";
import { EDITORIAL_ORDER, EDITORIAL_STATE, EVENT_KIND, EVENT_STATUS, FLOW_STATUS, LIFECYCLE, PRIORITY, fmtBlocker } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Demo, Empty, Field, Health, Hours, ProgressBar, ProgressNote } from "@/components/ui";
import { TaskList, type TaskItem } from "@/components/TaskList";
import { AlertList } from "@/components/AlertList";
import {
  activateFlowAction, closeFlowAction, completeFlowAction, contentStateAction, createContentAction, createEventAction, createTaskAction,
  flowWaitingAction, linkDeliverableAction, reopenFlowAction, updateFlowAction,
} from "@/app/actions";

export const metadata = { title: "Fluxo" };

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [f] = await sql<{ id: string; client_id: string; client_name: string; client_demo: boolean; name: string; lifecycle: string; status: string; cycle_label: string | null; reference_date: string | null; start_date: string | null; due_date: string | null; wait_reason: string | null; wait_until: string | null; baseline_version: number; owner_id: string | null; owner_name: string | null; objective: string | null; acceptance_note: string | null; completed_at: Date | null; service_id: string | null; service_name: string | null; parent_flow_id: string | null; parent_name: string | null; plan_label: string | null; is_demo: boolean; created_at: Date }[]>`
    SELECT f.*, c.name AS client_name, c.is_demo AS client_demo, u.name AS owner_name, s.name AS service_name, p.name AS parent_name, q.label AS plan_label
    FROM flow_instances f LEFT JOIN clients c ON c.id = f.client_id LEFT JOIN users u ON u.id = f.owner_id LEFT JOIN services s ON s.id = f.service_id
    LEFT JOIN flow_instances p ON p.id = f.parent_flow_id LEFT JOIN quarterly_plans q ON q.id = f.quarterly_plan_id WHERE f.id = ${id}`;
  if (!f || !inScope(await clientScope(actor), f.client_id)) notFound();
  const manager = isManager(actor);
  const ref = today();
  const [progMap, tasks, children, deliverables, allDeliverables, contents, history, users, alerts, initiative] = await Promise.all([
    flowProgress([id]),
    sql<TaskItem[]>`
      SELECT t.id, t.title, t.status, t.priority, t.due_date, t.est_hours, t.assignee_id, u.name AS assignee_name, t.stage, t.parent_task_id, t.in_baseline, t.is_extra, t.waiting_until, t.content_id,
             (SELECT b.reason_category || coalesce(': ' || b.comment, '') FROM blockers b WHERE b.task_id = t.id AND b.resolved_at IS NULL LIMIT 1) AS blocker
      FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.flow_id = ${id} AND t.deleted_at IS NULL ORDER BY t.position, t.created_at`,
    sql<{ id: string; name: string; status: string }[]>`SELECT id, name, status FROM flow_instances WHERE parent_flow_id = ${id}`,
    sql<{ id: string; name: string }[]>`SELECT d.id, d.name FROM flow_deliverables fd JOIN deliverables d ON d.id = fd.deliverable_id WHERE fd.flow_id = ${id}`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM deliverables WHERE client_id = ${f.client_id} AND status = 'ativo'`,
    sql<{ id: string; title: string; kind: string; editorial_state: string; approval_state: string; edited_at: Date | null; approved_at: Date | null; published_at: Date | null; script: string | null }[]>`SELECT * FROM content_assets WHERE flow_id = ${id} ORDER BY created_at`,
    sql<{ id: number; occurred_at: Date; recorded_at: Date; summary: string; reason: string | null; actor: string | null; task_id: string | null }[]>`
      SELECT oe.id, oe.occurred_at, oe.recorded_at, oe.summary, oe.reason, u.name AS actor, oe.task_id FROM operational_events oe LEFT JOIN users u ON u.id = oe.actor_id WHERE oe.flow_id = ${id} ORDER BY oe.occurred_at DESC, oe.id DESC LIMIT 40`,
    usersList(),
    computeAlerts(actor, { clientId: f.client_id }).then((a) => a.filter((x) => x.flowId === id)),
    sql<{ id: string; title: string }[]>`SELECT id, title FROM initiatives WHERE flow_id = ${id}`,
  ]);
  for (const t of tasks) t.blocker = fmtBlocker(t.blocker);
  const events = await listEvents(actor, { from: localToInstant(addDays(ref, -120)), to: localToInstant(addDays(ref, 180)), flowId: id, includeCancelled: true });
  const p = progMap.get(id)!;
  const health = ["concluido", "cancelado", "arquivado"].includes(f.status) ? { level: "sem_dados" as const, reasons: ["Encerrado"] } : healthOf(alerts, p.baselineCount > 0);
  const open = !["concluido", "cancelado", "arquivado"].includes(f.status);
  const crossesMonths = f.start_date && f.due_date && monthOf(f.start_date) !== monthOf(f.due_date);
  const openBaseline = tasks.filter((t) => t.in_baseline && !["concluida", "cancelada"].includes(t.status)).length;
  const editTasks = tasks.filter((t) => t.title.startsWith("EDIÇÃO") || t.title.startsWith("PUBLICAÇÃO"));

  return (
    <div className="page">
      <div className="crumbs"><Link href="/clientes">Clientes</Link> / <Link href={`/clientes/${f.client_id}`}>{f.client_name}</Link> / fluxos</div>
      <div className="page-head">
        <div>
          <h1>{f.name} <Demo on={f.is_demo || f.client_demo} /></h1>
          <p className="sub">{LIFECYCLE[f.lifecycle]} · <b>{FLOW_STATUS[f.status]}</b>{f.cycle_label ? ` · ciclo ${f.cycle_label}` : ""}{f.reference_date ? ` · referência ${fmtDate(f.reference_date, { year: true })}` : ""} · responsável {f.owner_name ?? "—"}</p>
          <p className="small muted">
            {f.service_name ? `Serviço: ${f.service_name} · ` : ""}
            Entregáveis: {deliverables.length ? deliverables.map((d) => d.name).join(", ") : "nenhum vinculado"}
            {f.plan_label ? ` · Trimestre: ${f.plan_label}` : ""}{initiative.length ? ` · Iniciativa: ${initiative.map((i) => i.title).join(", ")}` : ""}
            {f.parent_flow_id ? <> · Derivado de <Link href={`/fluxos/${f.parent_flow_id}`}>{f.parent_name}</Link></> : null}
            {children.length ? <> · Desdobramentos: {children.map((c, i) => <span key={c.id}>{i ? ", " : ""}<Link href={`/fluxos/${c.id}`}>{c.name}</Link></span>)}</> : null}
          </p>
        </div>
        <Health level={health.level} title={health.reasons.join(" • ")} />
      </div>

      {f.status === "em_espera" ? <div className="callout warn" style={{ marginBottom: 12 }}>Em espera planejada{f.wait_until ? ` até ${fmtDate(f.wait_until)}` : ""}: {f.wait_reason}. Alertas de inatividade suspensos.</div> : null}
      {f.status === "planejado" ? <div className="callout info" style={{ marginBottom: 12 }}>Em montagem: a base planejada ainda pode ser ajustada livremente. Ao iniciar a execução, mudanças na base passam a exigir motivo e geram nova versão.</div> : null}
      {f.status === "concluido" ? <div className="callout info" style={{ marginBottom: 12 }}>Concluído em {fmtDateTime(f.completed_at)}. Aceite: {f.acceptance_note}</div> : null}

      <div className="grid g-side">
        <div className="stack">
          <Card title="Evolução da instância" hint={`Base planejada v${f.baseline_version} · ${fmtDate(f.start_date, { year: true })} → ${fmtDate(f.due_date, { year: true })}${crossesMonths ? " · atravessa meses sem zerar" : ""}`}>
            <ProgressBar p={p} size="lg" />
            <div style={{ marginTop: 8 }}><ProgressNote p={p} /></div>
            <div className="row" style={{ marginTop: 10, gap: 24 }}>
              <span className="small">Horas estimadas: <b>{p.estHoursTotal ? `${p.estHoursTotal}h` : "—"}</b></span>
              <span className="small">Horas apontadas: <b><Hours v={p.actualHours} /></b></span>
              <span className="small muted">Horas apontadas não alteram o % concluído.</span>
            </div>
          </Card>

          <Card title="Etapas e tarefas" hint="Atualize status inline. Bloquear, cancelar e reabrir pedem motivo (abra a tarefa)." tight>
            {tasks.length === 0 ? <Empty title="Nenhuma tarefa" /> : <TaskList tasks={tasks} users={users} canManage={manager} actorId={actor.id} groupByStage context="flow" />}
            {open ? (
              <div className="card-b">
                <details className="panel"><summary>+ Adicionar tarefa {manager ? "" : "(demanda não planejada)"}</summary>
                  <ActionForm action={createTaskAction} className="form-grid" reset>
                    <input type="hidden" name="flowId" value={id} />
                    <Field label="Título" full><input name="title" required /></Field>
                    <Field label="Etapa"><input name="stage" list="stages" /><datalist id="stages">{[...new Set(tasks.map((t) => t.stage).filter(Boolean))].map((s) => <option key={s!} value={s!} />)}</datalist></Field>
                    {manager ? <Field label="Responsável"><select name="assigneeId"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field> : null}
                    <Field label="Prazo"><input type="date" name="dueDate" /></Field>
                    <Field label="Horas estimadas" help="Define o peso no progresso"><input name="estHours" inputMode="decimal" /></Field>
                    {manager ? <Field label="Prioridade"><select name="priority" defaultValue="normal">{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field> : null}
                    <Field label="Tarefa-mãe (subtarefa de…)"><select name="parentTaskId"><option value="">—</option>{tasks.filter((t) => !t.parent_task_id).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
                    {manager ? (
                      <>
                        <label className="check full"><input type="checkbox" name="inBaseline" defaultChecked={f.status === "planejado"} /> Faz parte da base planejada (conta no % vendido)</label>
                        {f.status !== "planejado" ? <Field label="Motivo/aprovação da mudança de escopo (se incluir na base)" full><input name="baselineReason" /></Field> : null}
                      </>
                    ) : <p className="small muted full">Será registrada como demanda não planejada: conta como esforço, sem alterar o escopo vendido.</p>}
                    <div><Submit>Adicionar</Submit></div>
                  </ActionForm>
                </details>
              </div>
            ) : null}
          </Card>

          {(f.lifecycle === "ciclico" || contents.length > 0) ? (
            <Card title="Conteúdos do ciclo" hint="Estado editorial independente: concluir a EDIÇÃO não publica. Publicação é um evento próprio com data." tight>
              {contents.length === 0 ? <Empty title="Nenhum conteúdo neste ciclo" /> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Conteúdo</th><th>Estado editorial</th><th>Edição concluída</th><th>Publicado</th><th>Tarefas</th></tr></thead>
                  <tbody>{contents.map((c) => (
                    <tr key={c.id}>
                      <td><b>{c.title}</b><div className="small muted">{c.kind}</div></td>
                      <td>
                        <ActionForm action={contentStateAction} className="row">
                          <input type="hidden" name="contentId" value={c.id} />
                          <select name="state" defaultValue={c.editorial_state} className="inline">{[...EDITORIAL_ORDER, "descartada"].map((s) => <option key={s} value={s}>{EDITORIAL_STATE[s]}</option>)}</select>
                          <Submit className="btn sm" pendingText="…">Atualizar</Submit>
                        </ActionForm>
                      </td>
                      <td className="small">{c.edited_at ? fmtDateTime(c.edited_at) : <span className="nodata">—</span>}</td>
                      <td className="small">{c.published_at ? fmtDateTime(c.published_at) : <span className="nodata">não publicado</span>}</td>
                      <td className="small">{editTasks.filter((t) => t.content_id === c.id).map((t) => <div key={t.id}><Link href={`/tarefas/${t.id}`}>{t.title.split(" — ")[0]}</Link> · {t.status.replace("_", " ")}</div>)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
              {manager && open ? (
                <div className="card-b">
                  <details className="panel"><summary>+ Novo conteúdo</summary>
                    <ActionForm action={createContentAction} className="form-grid" reset>
                      <input type="hidden" name="flowId" value={id} />
                      <Field label="Título" full><input name="title" required /></Field>
                      <Field label="Formato"><select name="kind"><option value="video">Vídeo</option><option value="card">Card</option><option value="carrossel">Carrossel</option><option value="stories">Stories</option><option value="outro">Outro</option></select></Field>
                      <Field label="Roteiro / briefing" full><textarea name="script" /></Field>
                      <label className="check full"><input type="checkbox" name="createTasks" defaultChecked /> Criar tarefas EDIÇÃO e PUBLICAÇÃO (subtarefa) vinculadas</label>
                      <Field label="Editor(a)"><select name="editorAssigneeId"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                      <Field label="Horas de edição"><input name="editHours" inputMode="decimal" /></Field>
                      <Field label="Prazo da edição"><input type="date" name="editDue" /></Field>
                      <Field label="Horas de publicação"><input name="publishHours" inputMode="decimal" /></Field>
                      <Field label="Prazo da publicação"><input type="date" name="publishDue" /></Field>
                      <label className="check full"><input type="checkbox" name="inBaseline" defaultChecked /> Incluir na base planejada</label>
                      {f.status !== "planejado" ? <Field label="Motivo (base já fixada)" full><input name="baselineReason" placeholder="Ex.: vídeo previsto no ciclo" /></Field> : null}
                      <div><Submit>Criar conteúdo</Submit></div>
                    </ActionForm>
                  </details>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card title="Histórico do fluxo" tight>
            {history.length === 0 ? <Empty title="Sem eventos" /> : (
              <ul className="timeline">{history.map((e) => (
                <li key={e.id}><span className="when">{fmtDateTime(e.occurred_at)}</span>
                  <div><b>{e.actor ?? "Sistema"}</b> — {e.summary}{e.task_id ? <> · <Link href={`/tarefas/${e.task_id}`}>abrir</Link></> : null}
                    {e.reason ? <div className="why">Motivo: {e.reason}</div> : null}
                    {Math.abs(e.recorded_at.getTime() - e.occurred_at.getTime()) > 3 * 3600000 ? <div className="retro">Registrado em {fmtDateTime(e.recorded_at)}</div> : null}</div></li>
              ))}</ul>
            )}
          </Card>
        </div>

        <div className="stack">
          {alerts.length ? <Card title="Saúde" tight><AlertList alerts={alerts} actor={actor} compact /></Card> : null}

          <Card title="Agenda vinculada" hint="O mesmo evento aparece na agenda geral e do squad. Remarcar aqui atualiza todas as visões." tight>
            {events.length === 0 ? <Empty title="Nenhum evento" /> : (
              <ul className="list">{events.map((e) => (
                <li key={e.id}>
                  <Link href={`/agenda/${e.id}`}><b style={e.status === "cancelado" ? { textDecoration: "line-through" } : undefined}>{e.title}</b></Link>
                  <div className="small muted">{EVENT_KIND[e.kind]} · {fmtDateTime(e.starts_at)} · {EVENT_STATUS[e.status]}{e.reschedule_count ? ` · remarcado ${e.reschedule_count}x` : ""}</div>
                  <div className="small">{e.participants.map((p) => p.name).join(", ")}</div>
                </li>
              ))}</ul>
            )}
            {manager && open ? (
              <div className="card-b">
                <details className="panel"><summary>+ Agendar produção / reunião</summary>
                  <ActionForm action={createEventAction} className="stack" reset>
                    <input type="hidden" name="flowId" value={id} />
                    <select name="kind" defaultValue="producao"><option value="producao">Produção / captação</option><option value="reuniao">Reunião</option><option value="entrega">Entrega / prazo</option></select>
                    <input name="title" placeholder="Título" defaultValue={`Captação ${f.client_name}`} required />
                    <div className="row"><input type="date" name="date" defaultValue={f.reference_date ?? ref} required style={{ width: 150 }} /><input type="time" name="startTime" defaultValue="14:00" style={{ width: 110 }} /><input type="time" name="endTime" defaultValue="17:00" style={{ width: 110 }} /></div>
                    <label className="small">Tarefa vinculada (prazo acompanha o evento)
                      <select name="taskId"><option value="">—</option>{tasks.filter((t) => !["concluida", "cancelada"].includes(t.status)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
                    <div className="small"><b>Participantes</b></div>
                    <div className="row">{users.map((u) => <label key={u.id} className="check"><input type="checkbox" name="participantIds" value={u.id} /> {u.name}</label>)}</div>
                    <input name="location" placeholder="Local" />
                    <label className="check"><input type="checkbox" name="force" /> Salvar mesmo com conflito de agenda</label>
                    <Submit>Agendar</Submit>
                  </ActionForm>
                </details>
              </div>
            ) : null}
          </Card>

          {manager ? (
            <Card title="Ações do fluxo">
              <div className="stack">
                {f.status === "planejado" ? <ActionForm action={activateFlowAction}><input type="hidden" name="flowId" value={id} /><Submit>Iniciar execução (fixar base v{f.baseline_version})</Submit></ActionForm> : null}
                {open ? (
                  <details className="panel" open={openBaseline === 0 && f.status === "ativo"}><summary>Concluir com aceite</summary>
                    <ActionForm action={completeFlowAction} className="stack">
                      <input type="hidden" name="flowId" value={id} />
                      <textarea name="acceptanceNote" placeholder="Aceite / critério cumprido (obrigatório)" required />
                      {openBaseline ? <label className="check"><input type="checkbox" name="force" /> Concluir mesmo com {openBaseline} tarefa(s) abertas</label> : null}
                      {f.lifecycle === "implantacao" || f.lifecycle === "projeto" ? (
                        <>
                          <label className="small">Criar acompanhamento contínuo a seguir (opcional)<input name="followUpName" placeholder={`Acompanhamento — ${f.name.replace(/^Implantação — /, "")}`} /></label>
                          <input type="hidden" name="followUpLifecycle" value="continuo" />
                        </>
                      ) : null}
                      <Submit>Concluir fluxo</Submit>
                    </ActionForm>
                  </details>
                ) : (
                  <details className="panel"><summary>Reabrir</summary>
                    <ActionForm action={reopenFlowAction} className="stack"><input type="hidden" name="flowId" value={id} /><input name="reason" placeholder="Motivo" required /><Submit className="btn">Reabrir fluxo</Submit></ActionForm>
                  </details>
                )}
                {open ? (
                  <details className="panel"><summary>{f.status === "em_espera" ? "Retomar" : "Colocar em espera planejada"}</summary>
                    <ActionForm action={flowWaitingAction} className="stack">
                      <input type="hidden" name="flowId" value={id} />
                      {f.status === "em_espera" ? <input type="hidden" name="waiting" value="false" /> : (
                        <>
                          <input type="hidden" name="waiting" value="true" />
                          <input name="reason" placeholder="Motivo (ex.: aguardando captação agendada)" required />
                          <label className="small">Até<input type="date" name="until" /></label>
                        </>
                      )}
                      <Submit className="btn">{f.status === "em_espera" ? "Retomar execução" : "Registrar espera"}</Submit>
                    </ActionForm>
                  </details>
                ) : null}
                <details className="panel"><summary>Editar dados / replanejar</summary>
                  <ActionForm action={updateFlowAction} className="stack">
                    <input type="hidden" name="flowId" value={id} />
                    <label className="small">Nome<input name="name" defaultValue={f.name} required /></label>
                    <label className="small">Rótulo do ciclo<input name="cycle_label" defaultValue={f.cycle_label ?? ""} /></label>
                    <div className="row">
                      <label className="small grow">Início<input type="date" name="start_date" defaultValue={f.start_date ?? ""} /></label>
                      <label className="small grow">Prazo<input type="date" name="due_date" defaultValue={f.due_date ?? ""} /></label>
                    </div>
                    <label className="small">Data de referência<input type="date" name="reference_date" defaultValue={f.reference_date ?? ""} /></label>
                    <label className="small">Responsável<select name="owner_id" defaultValue={f.owner_id ?? ""}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                    <input type="hidden" name="service_id" value={f.service_id ?? ""} />
                    <label className="small">Objetivo<textarea name="objective" defaultValue={f.objective ?? ""} /></label>
                    <label className="small">Motivo (obrigatório ao mudar prazo)<input name="reason" /></label>
                    <Submit className="btn">Salvar</Submit>
                  </ActionForm>
                </details>
                <details className="panel"><summary>Entregáveis executados</summary>
                  {allDeliverables.map((d) => {
                    const linked = deliverables.some((x) => x.id === d.id);
                    return (
                      <ActionForm key={d.id} action={linkDeliverableAction} className="row between">
                        <input type="hidden" name="flowId" value={id} /><input type="hidden" name="deliverableId" value={d.id} />
                        {linked ? <input type="hidden" name="unlink" value="true" /> : null}
                        <span className="small">{d.name}</span><Submit className="btn sm" pendingText="…">{linked ? "Desvincular" : "Vincular"}</Submit>
                      </ActionForm>
                    );
                  })}
                  {allDeliverables.length === 0 ? <p className="small muted">Nenhum entregável registrado no escopo.</p> : null}
                </details>
                {open ? (
                  <details className="panel"><summary>Cancelar / arquivar</summary>
                    <ActionForm action={closeFlowAction} className="stack">
                      <input type="hidden" name="flowId" value={id} />
                      <select name="status"><option value="cancelado">Cancelar</option><option value="arquivado">Arquivar</option></select>
                      <input name="reason" placeholder="Motivo" required />
                      <Submit className="btn danger">Confirmar</Submit>
                    </ActionForm>
                  </details>
                ) : null}
              </div>
            </Card>
          ) : null}
          {f.objective ? <Card title="Objetivo / critério"><p style={{ whiteSpace: "pre-wrap" }}>{f.objective}</p></Card> : null}
        </div>
      </div>
    </div>
  );
}
