import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { isManager } from "@/lib/access";
import { radar, squadsList, usersList, visibleClients } from "@/lib/queries";
import { flowProgress } from "@/lib/queries";
import { fmtDate, fmtMonth, monthOf, relativeDays, shiftMonth, today } from "@/lib/dates";
import { SERVICE_KIND, SEVERITY } from "@/lib/labels";
import { displayProgress } from "@/lib/progress";
import { Card, Demo, Empty, Health, Hours, Kpi, ProgressBar } from "@/components/ui";

export const metadata = { title: "Radar da agência" };

type SP = Promise<Record<string, string | undefined>>;

export default async function RadarPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireActor();
  if (!isManager(actor)) redirect("/meu-dia");
  const sp = await searchParams;
  const month = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : monthOf(today());
  const f = { month, squadId: sp.squad || null, leaderId: sp.lider || null, clientId: sp.cliente || null, serviceKind: sp.servico || null, health: sp.saude || null };
  const [data, squads, users, clients] = await Promise.all([radar(actor, f), squadsList(), usersList(), visibleClients(actor)]);
  const leaders = users.filter((u) => u.role !== "colaborador");
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/?${p.toString()}`;
  };
  const all = displayProgress(data.summary.all);

  // Fluxos sob risco: agrega alertas por fluxo
  const riskFlows = new Map<string, { name: string; client: string | null; clientId: string | null; sev: string; reasons: string[] }>();
  for (const a of data.alerts) {
    if (!a.flowId || a.severity === "info") continue;
    const cur = riskFlows.get(a.flowId) ?? { name: a.flowName ?? "", client: a.clientName, clientId: a.clientId, sev: a.severity, reasons: [] };
    if (a.severity === "critico") cur.sev = "critico";
    cur.reasons.push(a.title);
    riskFlows.set(a.flowId, cur);
  }
  const riskList = [...riskFlows.entries()].sort((x, y) => (x[1].sev === "critico" ? 0 : 1) - (y[1].sev === "critico" ? 0 : 1)).slice(0, 8);
  const riskProgress = await flowProgress(riskList.map(([id]) => id));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Radar da agência</h1>
          <p className="sub">O que foi vendido, o que está sendo entregue, quanto avançou, o que está parado e quem precisa agir.</p>
        </div>
        <div className="row">
          <Link className="btn sm" href={qs({ mes: shiftMonth(month, -1) })}>‹</Link>
          <b style={{ minWidth: 140, textAlign: "center" }}>{fmtMonth(month)}</b>
          <Link className="btn sm" href={qs({ mes: shiftMonth(month, 1) })}>›</Link>
          {month !== monthOf(today()) ? <Link className="btn sm" href={qs({ mes: monthOf(today()) })}>Mês atual</Link> : null}
        </div>
      </div>

      <form className="filters" method="get">
        <input type="hidden" name="mes" value={month} />
        <div className="field"><label>Squad</label>
          <select name="squad" defaultValue={f.squadId ?? ""}><option value="">Todos</option>{squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>Líder</label>
          <select name="lider" defaultValue={f.leaderId ?? ""}><option value="">Todos</option>{leaders.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="field"><label>Cliente</label>
          <select name="cliente" defaultValue={f.clientId ?? ""}><option value="">Todos</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>Serviço ativo</label>
          <select name="servico" defaultValue={f.serviceKind ?? ""}><option value="">Todos</option>{Object.entries(SERVICE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label>Saúde</label>
          <select name="saude" defaultValue={f.health ?? ""}><option value="">Todas</option>{(["critico", "atencao", "normal", "sem_dados"] as const).map((k) => <option key={k} value={k}>{SEVERITY[k]}</option>)}</select></div>
        <button className="btn primary">Filtrar</button>
        <Link className="btn ghost" href={`/?mes=${month}`}>Limpar</Link>
      </form>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi label="Clientes ativos" value={data.summary.activeClients} foot={`${data.summary.deliverables} entregáveis contratados no período`} href="/clientes" />
        <Kpi label="Compromissos do mês — realizado" value={all.value == null ? <small className="nodata">sem dados suficientes</small> : <>{all.value}%{all.provisional ? <small> provisório</small> : null}</>} foot={all.expected != null ? `Esperado pelos prazos até hoje: ${all.expected}%` : "Sem cronograma no período"} />
        <Kpi label="Prazos" value={<>{data.summary.overdue} <small>vencidos</small></>} foot={`${data.summary.upcoming} com prazo nos próximos 7 dias`} href="/alertas?regra=atraso" />
        <Kpi label="Fluxos em risco" value={<><span style={{ color: "var(--crit)" }}>{data.summary.flowsCritical}</span> <small>críticos</small> · {data.summary.flowsAttention} <small>atenção</small></>} foot={`${data.summary.blockers} bloqueio(s) · ${data.summary.decisionsWaiting.length} aguardando decisão`} href="/alertas" />
      </div>
      {all.provisional ? <p className="small" style={{ color: "var(--warn)", margin: "-6px 0 12px" }}>ⓘ Há tarefas sem horas estimadas no período: o percentual agregado é provisório (por contagem). Configure estimativas nos fluxos indicados.</p> : null}

      <Card title="Clientes — ordenados por risco" hint="Compromissos com prazo no mês selecionado, ponderados por horas estimadas. Marca preta = esperado pelos prazos até hoje. Projetos têm progresso próprio no painel do cliente." tight>
        {data.rows.length === 0 ? <Empty title="Nenhum cliente para os filtros selecionados" /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Cliente</th><th>Squad / líder</th><th style={{ minWidth: 180 }}>Compromissos do mês</th><th>Próxima entrega</th><th className="num">Sem movimento</th><th>Saúde</th><th className="num">Horas (est. / apont.)</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="click">
                    <td><Link href={`/clientes/${r.id}`}><b>{r.name}</b></Link> <Demo on={r.is_demo} />
                      <div className="small muted">{r.activeFlows} fluxo(s) em andamento</div></td>
                    <td className="small">{r.squads}<div className="muted">{r.leaders}</div></td>
                    <td><ProgressBar p={r.commitment} /></td>
                    <td className="small">{r.nextDue ? <>{r.nextDue.title}<div className="muted">{fmtDate(r.nextDue.due_date)} · {relativeDays(r.nextDue.due_date)}</div></> : <span className="nodata">nada agendado</span>}</td>
                    <td className="num small">{r.idleDays == null ? <span className="nodata">sem registros</span> : <span className={r.idleDays >= 2 ? "late" : ""}>{r.idleDays} dia(s) útil(eis)</span>}
                      {r.lastMove ? <div className="muted">últ. {fmtDate(r.lastMove)}</div> : null}</td>
                    <td><Health level={r.health.level} title={r.health.reasons.join(" • ")} />
                      <div className="small muted" style={{ maxWidth: 220 }}>{r.health.reasons[0]}</div></td>
                    <td className="num small">{r.estHours ? `${r.estHours}h` : <span className="nodata">sem estimativa</span>} / <Hours v={r.actualHours} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Fluxos e entregáveis sob risco" hint="Explicação concreta de cada risco — clique para agir." tight>
          {riskList.length === 0 ? <Empty title="Nenhum fluxo em risco pelas regras atuais" /> : (
            <ul className="list">
              {riskList.map(([id, r]) => (
                <li key={id}>
                  <div className="row between top">
                    <div className="grow">
                      <Link href={`/fluxos/${id}`}><b>{r.name}</b></Link> <span className="small muted">· {r.client}</span>
                      <div className="small muted">{r.reasons.slice(0, 2).join(" • ")}</div>
                    </div>
                    <Health level={r.sev as "critico"} />
                  </div>
                  <div style={{ marginTop: 6, maxWidth: 320 }}><ProgressBar p={riskProgress.get(id)!} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Aguardando decisão ou ação do líder" hint="Bloqueios sem encaminhamento, motivos pendentes e decisões propostas." tight actions={<Link className="btn sm" href="/alertas">Central de saúde</Link>}>
          {data.summary.decisionsWaiting.length === 0 ? <Empty title="Nada aguardando decisão" /> : (
            <ul className="list">
              {data.summary.decisionsWaiting.slice(0, 8).map((a) => (
                <li key={a.key}>
                  <div className="row between top">
                    <div className="grow"><Link href={a.href}><b>{a.title}</b></Link>
                      <div className="small muted">{a.clientName ?? "Interno"} · {a.detail}</div></div>
                    <Health level={a.severity} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Card title="Capacidade por squad — próximos 7 dias" hint="Capacidade estimada ≠ agenda vazia. Horas apontadas: últimos 7 dias; sem lançamento aparece “sem apontamento”, nunca 0h." tight>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Squad</th><th className="num">Pessoas</th><th className="num">Capacidade semanal definida</th><th className="num">Horas estimadas com prazo em 7 dias</th><th className="num">Uso estimado</th><th className="num">Horas apontadas (7 dias)</th></tr></thead>
              <tbody>
                {data.squads.map((s) => {
                  const cap = s.squad_cap ?? s.cap;
                  const pct = cap && s.open_est != null ? Math.round((100 * s.open_est) / cap) : null;
                  return (
                    <tr key={s.id}>
                      <td><Link href={`/squads/${s.id}`} className="sq"><span className="dot" style={{ background: s.color ?? "#999" }} /> <b>{s.name}</b></Link></td>
                      <td className="num">{s.members}</td>
                      <td className="num">{cap ? `${cap}h` : <span className="nodata">não definida</span>}</td>
                      <td className="num">{s.open_est != null ? `${s.open_est}h` : "0h"}{s.unestimated ? <div className="small muted">+{s.unestimated} sem estimativa</div> : null}</td>
                      <td className="num">{pct == null ? <span className="nodata">—</span> : <span className={pct > 100 ? "late" : ""}>{pct}%</span>}</td>
                      <td className="num">{s.logged_n ? `${s.logged}h` : <span className="nodata">sem apontamento</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>Atualizado em {new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Dados calculados a partir de tarefas, eventos e apontamentos registrados — nenhum percentual é digitado manualmente.</p>
    </div>
  );
}
