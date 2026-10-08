import Link from "next/link";
import type { Actor } from "@/lib/auth-core";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { monthCommitment, usersList } from "@/lib/queries";
import { addDays, dateOfInstant, fmtDate, fmtDateTime, fmtMonth, monthOf, shiftMonth, today, weekStart } from "@/lib/dates";
import { BLOCK_REASON, PERIODICITY, SEVERITY, fmtBlocker } from "@/lib/labels";
import { healthOf } from "@/lib/services/alerts";
import { Card, Empty, Health, Hours, ProgressBar, ProgressNote } from "@/components/ui";
import { FlowTable } from "@/components/FlowTable";
import { TaskList, type TaskItem } from "@/components/TaskList";
import { AlertList } from "@/components/AlertList";
import { loadFlowsWithHealth } from "../data";
import type { ClientHeader } from "../page";

const GROUPS: { key: string; title: string; hint: string; test: (f: { lifecycle: string; status: string }) => boolean }[] = [
  { key: "rec", title: "Compromissos recorrentes", hint: "Ciclos de produção e rotinas mensais — cada ciclo com progresso próprio.", test: (f) => f.lifecycle === "ciclico" && !closed(f.status) },
  { key: "imp", title: "Implantações em andamento", hint: "Finitas: terminam com aceite e podem gerar acompanhamento.", test: (f) => f.lifecycle === "implantacao" && !closed(f.status) },
  { key: "proj", title: "Campanhas e projetos pontuais", hint: "Atravessam meses sem zerar.", test: (f) => f.lifecycle === "projeto" && !closed(f.status) },
  { key: "cont", title: "Operações monitoradas", hint: "Operação contínua; ajustes viram intervenções finitas.", test: (f) => (f.lifecycle === "continuo" || f.lifecycle === "extra") && !closed(f.status) },
  { key: "arq", title: "Encerrados / arquivo", hint: "Histórico preservado.", test: (f) => closed(f.status) },
];
function closed(s: string) {
  return ["concluido", "cancelado", "arquivado"].includes(s);
}

export async function TabVisao({ actor, client, lens }: { actor: Actor; client: ClientHeader; lens: string }) {
  const { flows, progress, alerts, flowHealth } = await loadFlowsWithHealth(actor, client.id);
  const hasData = flows.length > 0;
  const health = healthOf(alerts, hasData);
  const base = `/clientes/${client.id}?aba=visao`;
  return (
    <div className="stack">
      <div className="row between">
        <div className="lens" role="tablist" aria-label="Lente">
          <Link href={`${base}&lente=execucao`} className={lens === "execucao" ? "on" : ""}>Execução</Link>
          <Link href={`${base}&lente=evolucao`} className={lens === "evolucao" ? "on" : ""}>Evolução</Link>
          <Link href={`${base}&lente=saude`} className={lens === "saude" ? "on" : ""}>Saúde</Link>
        </div>
        <div className="row"><span className="small muted">Saúde do cliente:</span> <Health level={health.level} title={health.reasons.join(" • ")} /></div>
      </div>
      {lens === "evolucao" ? <Evolucao client={client} flows={flows} progress={progress} /> : lens === "saude" ? <Saude actor={actor} client={client} alerts={alerts} /> : <Execucao actor={actor} client={client} flows={flows} progress={progress} flowHealth={flowHealth} />}
    </div>
  );
}

async function Execucao({ actor, client, flows, progress, flowHealth }: { actor: Actor; client: ClientHeader; flows: Awaited<ReturnType<typeof loadFlowsWithHealth>>["flows"]; progress: Awaited<ReturnType<typeof loadFlowsWithHealth>>["progress"]; flowHealth: Awaited<ReturnType<typeof loadFlowsWithHealth>>["flowHealth"] }) {
  const deliverables = await sql<{ id: string; name: string; quantity: number | null; unit: string | null; periodicity: string; service_name: string | null; status: string; flows: { id: string; name: string; status: string }[]; produced: number; published: number }[]>`
    SELECT d.id, d.name, d.quantity, d.unit, d.periodicity, d.status, s.name AS service_name,
      coalesce((SELECT json_agg(json_build_object('id', f.id, 'name', f.name, 'status', f.status)) FROM flow_deliverables fd JOIN flow_instances f ON f.id = fd.flow_id WHERE fd.deliverable_id = d.id), '[]') AS flows,
      (SELECT count(*)::int FROM content_assets ca WHERE ca.deliverable_id = d.id AND ca.edited_at IS NOT NULL AND date_trunc('month', ca.edited_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')) AS produced,
      (SELECT count(*)::int FROM content_assets ca WHERE ca.deliverable_id = d.id AND ca.published_at IS NOT NULL AND date_trunc('month', ca.published_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')) AS published
    FROM deliverables d LEFT JOIN services s ON s.id = d.service_id WHERE d.client_id = ${client.id} AND d.status IN ('ativo','concluido') ORDER BY s.name, d.name`;
  const ref = today();
  const tasks = await sql<TaskItem[]>`
    SELECT t.id, t.title, t.status, t.priority, t.due_date, t.est_hours, t.assignee_id, u.name AS assignee_name, t.parent_task_id, t.in_baseline, t.is_extra,
           f.name AS flow_name, t.flow_id, t.waiting_until,
           (SELECT b.reason_category || coalesce(': ' || b.comment, '') FROM blockers b WHERE b.task_id = t.id AND b.resolved_at IS NULL LIMIT 1) AS blocker
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN flow_instances f ON f.id = t.flow_id
    WHERE t.client_id = ${client.id} AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada')
      AND (f.id IS NULL OR f.status NOT IN ('cancelado','arquivado','concluido'))
      AND (t.due_date IS NULL OR t.due_date <= ${addDays(ref, 14)}::date)
    ORDER BY t.due_date NULLS LAST, t.priority DESC LIMIT 40`;
  const users = isManager(actor) ? await usersList() : [];
  for (const t of tasks) t.blocker = fmtBlocker(t.blocker);
  return (
    <>
      <Card title="Entregáveis vendidos e serviços" hint="O que foi contratado e quais fluxos executam cada entregável. Contagem de conteúdos editados/publicados no mês corrente (eventos distintos)." tight
        actions={<Link className="btn sm" href={`/clientes/${client.id}?aba=escopo`}>Escopo contratado</Link>}>
        {deliverables.length === 0 ? <Empty title="Nenhum entregável registrado">O escopo vendido ainda não foi cadastrado.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Entregável</th><th>Serviço</th><th>Volume</th><th>Executado por</th><th className="num">Editados / publicados no mês</th></tr></thead>
            <tbody>{deliverables.map((d) => (
              <tr key={d.id}>
                <td><b>{d.name}</b>{d.status !== "ativo" ? <span className="pill" style={{ marginLeft: 6 }}>{d.status}</span> : null}</td>
                <td className="small">{d.service_name ?? "—"}</td>
                <td className="small">{d.quantity != null ? `${d.quantity} ${d.unit ?? ""}` : "—"} · {PERIODICITY[d.periodicity]}</td>
                <td className="small">{d.flows.length ? d.flows.map((f, i) => <span key={f.id}>{i ? ", " : ""}<Link href={`/fluxos/${f.id}`}>{f.name}</Link></span>) : <span className="nodata">nenhum fluxo vinculado</span>}</td>
                <td className="num small">{d.produced || d.published ? `${d.produced} / ${d.published}` : <span className="nodata">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {GROUPS.map((g) => {
        const list = flows.filter(g.test);
        if (!list.length) return null;
        return (
          <Card key={g.key} title={g.title} hint={g.hint} tight actions={g.key === "rec" ? <Link className="btn sm" href={`/clientes/${client.id}?aba=fluxos`}>+ Novo fluxo</Link> : undefined}>
            <FlowTable flows={list} progress={progress} health={flowHealth} />
          </Card>
        );
      })}
      {flows.length === 0 ? <Card><Empty title="Nenhum fluxo ainda"><Link href={`/clientes/${client.id}?aba=fluxos`}>Criar o primeiro fluxo</Link> a partir de um modelo ou do zero.</Empty></Card> : null}
      <Card title="Próximas tarefas (14 dias) e pendências" hint="Atualize status direto na lista. Bloquear, cancelar e reabrir exigem motivo (abra a tarefa)." tight>
        {tasks.length === 0 ? <Empty title="Nada pendente nos próximos 14 dias" /> : <TaskList tasks={tasks} users={users} canManage={isManager(actor)} actorId={actor.id} context="client" />}
      </Card>
    </>
  );
}

async function Evolucao({ client, flows, progress }: { client: ClientHeader; flows: Awaited<ReturnType<typeof loadFlowsWithHealth>>["flows"]; progress: Awaited<ReturnType<typeof loadFlowsWithHealth>>["progress"] }) {
  const cur = monthOf(today());
  const months = [shiftMonth(cur, -2), shiftMonth(cur, -1), cur, shiftMonth(cur, 1)];
  const commits = await Promise.all(months.map((m) => monthCommitment([client.id], m)));
  const ws = weekStart(today());
  const weeks = await sql<{ wk: string; done: number; hours: number | null }[]>`
    SELECT to_char(date_trunc('week', (t.completed_at AT TIME ZONE 'America/Sao_Paulo')), 'YYYY-MM-DD') AS wk, count(*)::int AS done, sum(t.est_hours) FILTER (WHERE t.in_baseline) AS hours
    FROM tasks t WHERE t.client_id = ${client.id} AND t.deleted_at IS NULL AND t.status = 'concluida' AND t.completed_at >= ${addDays(ws, -49)}::date
    GROUP BY 1 ORDER BY 1`;
  const [hrs] = await sql<{ month_hours: number | null; n: number }[]>`SELECT sum(hours) AS month_hours, count(*)::int AS n FROM time_entries WHERE client_id = ${client.id} AND to_char(occurred_on, 'YYYY-MM') = ${cur}`;
  const active = flows.filter((f) => !closed(f.status));
  const maxDone = Math.max(1, ...weeks.map((w) => w.done));
  return (
    <>
      <div className="grid g4">
        {months.map((m, i) => (
          <div key={m} className="card kpi">
            <div className="label">Compromissos de {fmtMonth(m, false)}</div>
            <div style={{ marginTop: 8 }}><ProgressBar p={commits[i].map.get(client.id)!} /></div>
            <div className="foot">{commits[i].map.get(client.id)!.baselineCount} tarefa(s) com prazo no mês</div>
          </div>
        ))}
      </div>
      <p className="small muted">Cumprimento por período (prazos do mês) é diferente do progresso da instância: um projeto que cruza meses mantém seu percentual sem zerar.</p>
      <Card title="Progresso por fluxo — realizado × esperado" hint="Esperado = soma dos pesos das tarefas com prazo até hoje (simplificação P0 por marcos)." tight>
        {active.length === 0 ? <Empty title="Sem fluxos ativos" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Fluxo</th><th style={{ minWidth: 220 }}>Progresso</th><th className="num">Diferença</th><th className="num">Horas estimadas</th><th className="num">Horas apontadas</th><th>Leitura</th></tr></thead>
            <tbody>{active.map((f) => {
              const p = progress.get(f.id)!;
              const v = p.state === "ok" ? p.weighted : p.provisional;
              const e = p.state === "ok" ? p.expected : p.expectedProvisional;
              const gap = v != null && e != null ? Math.round((v - e) * 10) / 10 : null;
              return (
                <tr key={f.id}>
                  <td><Link href={`/fluxos/${f.id}`}><b>{f.name}</b></Link></td>
                  <td><ProgressBar p={p} /></td>
                  <td className={`num ${gap != null && gap < -10 ? "late" : ""}`}>{gap == null ? "—" : `${gap > 0 ? "+" : ""}${gap} p.p.`}</td>
                  <td className="num">{p.estHoursTotal ? `${p.estHoursTotal}h` : <span className="nodata">sem estimativa</span>}</td>
                  <td className="num"><Hours v={p.actualHours} /></td>
                  <td className="small"><ProgressNote p={p} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
      <div className="grid g2">
        <Card title="Histórico de entregas (últimas 8 semanas)" hint="Tarefas efetivamente concluídas por semana (data em que ocorreram)." tight>
          {weeks.length === 0 ? <Empty title="Nenhuma conclusão registrada no período" /> : (
            <ul className="list">{weeks.map((w) => (
              <li key={w.wk} className="row">
                <span className="small mono" style={{ width: 90 }}>sem. {fmtDate(w.wk)}</span>
                <div className="grow"><div style={{ height: 10, width: `${(100 * w.done) / maxDone}%`, background: "var(--brand)", borderRadius: 6 }} /></div>
                <span className="small mono" style={{ width: 160, textAlign: "right" }}>{w.done} tarefa(s){w.hours ? ` · ${w.hours}h planejadas` : ""}</span>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="Consumo de capacidade no mês">
          <p>Horas apontadas para o cliente em {fmtMonth(cur, false)}: <b>{hrs.n ? `${hrs.month_hours}h` : "sem apontamento"}</b></p>
          <p className="small muted" style={{ marginTop: 8 }}>Horas consumidas medem esforço, não entrega: 100% de tarefas concluídas não prova resultado de negócio, e horas acima do estimado não aumentam o % concluído.</p>
          <p className="small" style={{ marginTop: 8 }}><Link href={`/clientes/${client.id}?aba=relatorios`}>Indicadores de resultado (KPIs) →</Link></p>
        </Card>
      </div>
    </>
  );
}

async function Saude({ actor, client, alerts }: { actor: Actor; client: ClientHeader; alerts: Awaited<ReturnType<typeof loadFlowsWithHealth>>["alerts"] }) {
  const blockers = await sql<{ id: string; task_id: string; title: string; reason_category: string; comment: string | null; release_owner: string | null; expected_resolution: string | null; opened_at: Date; opened_by: string | null; assignee: string | null }[]>`
    SELECT b.id, b.task_id, t.title, b.reason_category, b.comment, b.release_owner, b.expected_resolution, b.opened_at, ob.name AS opened_by, u.name AS assignee
    FROM blockers b JOIN tasks t ON t.id = b.task_id LEFT JOIN users ob ON ob.id = b.opened_by LEFT JOIN users u ON u.id = t.assignee_id
    WHERE b.client_id = ${client.id} AND b.resolved_at IS NULL ORDER BY b.opened_at`;
  const interventions = await sql<{ id: string; kind: string; text: string; author: string; responsible: string | null; due_date: string | null; created_at: Date; resolved_at: Date | null; task_id: string | null }[]>`
    SELECT mi.id, mi.kind, mi.text, a.name AS author, r.name AS responsible, mi.due_date, mi.created_at, mi.resolved_at, mi.task_id
    FROM manager_interventions mi JOIN users a ON a.id = mi.author_id LEFT JOIN users r ON r.id = mi.responsible_id WHERE mi.client_id = ${client.id} ORDER BY mi.created_at DESC LIMIT 10`;
  return (
    <>
      <Card title="Pendências detectadas pelas regras" hint="Fato detectado + justificativa (quando registrada). Saúde explicável — sem nota arbitrária." tight>
        <AlertList alerts={alerts} actor={actor} compact />
      </Card>
      <div className="grid g2">
        <Card title="Bloqueios abertos" tight>
          {blockers.length === 0 ? <Empty title="Nenhum bloqueio aberto" /> : (
            <ul className="list">{blockers.map((b) => (
              <li key={b.id}>
                <Link href={`/tarefas/${b.task_id}`}><b>{b.title}</b></Link>
                <div className="small">{BLOCK_REASON[b.reason_category]}{b.comment ? ` — ${b.comment}` : ""}</div>
                <div className="small muted">Responsável: {b.assignee ?? "—"} · liberação: {b.release_owner ?? "não informado"} · aberto {fmtDateTime(b.opened_at)} por {b.opened_by} · previsão {fmtDate(b.expected_resolution)}</div>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="Intervenções do líder" hint="Orientações, correções e encaminhamentos registrados." tight>
          {interventions.length === 0 ? <Empty title="Nenhuma intervenção registrada" /> : (
            <ul className="list">{interventions.map((i) => (
              <li key={i.id}>
                <div className="small"><b>{i.kind.replace("_", "-")}</b> · {i.author} · {fmtDateTime(i.created_at)} {i.resolved_at ? <span className="badge b-normal">resolvido</span> : null}</div>
                <div>{i.text}</div>
                <div className="small muted">{i.responsible ? `Responsável: ${i.responsible}` : ""}{i.due_date ? ` · prazo ${fmtDate(i.due_date)}` : ""}{i.task_id ? <> · <Link href={`/tarefas/${i.task_id}`}>tarefa</Link></> : null}</div>
              </li>
            ))}</ul>
          )}
        </Card>
      </div>
      <p className="small muted">Legenda: {(["critico", "atencao", "normal", "sem_dados"] as const).map((k) => SEVERITY[k]).join(" · ")} — cores sempre acompanhadas de ícone e texto. Última leitura: {fmtDateTime(new Date())}. {dateOfInstant(new Date()) !== today() ? "" : ""}</p>
    </>
  );
}
