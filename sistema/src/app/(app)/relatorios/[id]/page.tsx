import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { clientScope, inScope, isManager } from "@/lib/access";
import { loadReport, reportText } from "@/lib/reports-view/load";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { REPORT_STATUS } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { CopyButton } from "@/components/ClientBits";
import { Card, Demo, Empty, Field } from "@/components/ui";
import { refreshReportAction, reportStatusAction, updateReportAction } from "../../../actions";

export const metadata = { title: "Relatório" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !isManager(actor)) notFound();
  const d = await loadReport(id);
  if (!d || !inScope(await clientScope(actor), d.r.client_id)) notFound();
  const { r, kpis, decisions } = d;
  const text = reportText(d);
  return (
    <div className="page">
      <div className="crumbs"><Link href="/relatorios">Relatórios</Link> / <Link href={`/clientes/${r.client_id}?aba=relatorios`}>{r.client_name}</Link> /</div>
      <div className="page-head">
        <div>
          <h1>{r.title} <Demo on={r.is_demo} /></h1>
          <p className="sub"><span className={`badge ${r.status === "rascunho" ? "b-atencao" : "b-normal"}`}>{REPORT_STATUS[r.status]}</span> · período {fmtDate(r.period_start, { year: true })} a {fmtDate(r.period_end, { year: true })} · preparado por {r.author ?? "—"}{r.reviewed_at ? ` · revisado por ${r.reviewer} em ${fmtDateTime(r.reviewed_at)}` : ""}</p>
        </div>
        <div className="row">
          <ActionForm action={reportStatusAction}><input type="hidden" name="reportId" value={id} /><input type="hidden" name="status" value="revisado" /><Submit className="btn ok">✓ Marcar como revisado</Submit></ActionForm>
          {r.status !== "rascunho" ? <ActionForm action={reportStatusAction}><input type="hidden" name="reportId" value={id} /><input type="hidden" name="status" value="compartilhado" /><Submit className="btn">Marcar como compartilhado</Submit></ActionForm> : null}
          <Link className="btn primary" href={`/imprimir/relatorio/${id}`} target="_blank">Versão para imprimir / PDF</Link>
        </div>
      </div>
      <div className="callout info" style={{ marginBottom: 12 }}>Revise antes de compartilhar. O sistema não envia nada automaticamente; use “Copiar texto” ou a versão de impressão. Notas internas nunca saem no material do cliente.</div>
      <div className="grid g-side">
        <ActionForm action={updateReportAction} className="stack">
          <input type="hidden" name="reportId" value={id} />
          <Card title="Entregas concluídas no período" hint="Somente tarefas efetivamente concluídas e conteúdos publicados deste cliente no período. Desmarque o que não deve ir ao cliente." tight
            actions={<span className="small muted">{r.completed_items.length} item(ns)</span>}>
            {r.completed_items.length === 0 ? <Empty title="Nenhuma conclusão registrada no período">Use “Recalcular itens” após registrar conclusões.</Empty> : (
              <ul className="list">{r.completed_items.map((it, i) => (
                <li key={i}><label className="check" style={{ alignItems: "flex-start" }}><input type="checkbox" name="include" value={i} defaultChecked={it.include} />
                  <span><b style={{ fontWeight: 500 }}>{it.text}</b> <span className="small muted">· {it.group} · {fmtDate(it.date)}</span>{it.evidence?.length ? <div className="small">{it.evidence.map((e, j) => <span key={j}>{j ? ", " : ""}{e.startsWith("http") ? <a href={e} target="_blank" rel="noreferrer">{e}</a> : e}</span>)}</div> : null}
                    {it.taskId ? <div className="small"><Link href={`/tarefas/${it.taskId}`}>abrir tarefa</Link></div> : null}</span></label></li>
              ))}</ul>
            )}
          </Card>
          <Card title="Texto do relatório">
            <div className="stack">
              <Field label="Resumo da semana/mês"><textarea name="summary" defaultValue={r.summary ?? ""} /></Field>
              <Field label="Resultados (com métrica e fonte; não afirmar resultado sem critério)"><textarea name="resultsText" defaultValue={r.results_text ?? ""} /></Field>
              {r.kind === "mensal_trafego" ? <Field label="Diagnóstico"><textarea name="diagnosis" defaultValue={r.diagnosis ?? ""} /></Field> : <input type="hidden" name="diagnosis" value={r.diagnosis ?? ""} />}
              <Field label="Próximos passos"><textarea name="nextSteps" defaultValue={r.next_steps ?? ""} /></Field>
              <Field label="Notas internas (NÃO vão para o cliente)"><textarea name="internalNotes" defaultValue={r.internal_notes ?? ""} style={{ background: "#fffbeb" }} /></Field>
              <Submit>Salvar rascunho</Submit>
            </div>
          </Card>
        </ActionForm>
        <div className="stack">
          {r.kind === "mensal_trafego" ? (
            <Card title="KPIs do período" hint="Registre medições na aba Relatórios e KPIs do cliente." tight>
              {kpis.length === 0 ? <Empty title="Sem medições no período" /> : <ul className="list">{kpis.map((k, i) => <li key={i} className="small"><b>{k.name}</b>: {k.value} {k.unit ?? ""} em {fmtDate(k.observed_on)} {k.target != null ? `(meta ${k.target})` : ""} {k.is_fictitious ? <span className="badge b-demo">fictício</span> : null}</li>)}</ul>}
              <div className="card-b"><Link className="small" href={`/clientes/${r.client_id}?aba=relatorios`}>Registrar medição ou propor decisão →</Link></div>
            </Card>
          ) : null}
          {decisions.length ? (
            <Card title="Decisões ligadas a este relatório" tight>
              <ul className="list">{decisions.map((dd) => <li key={dd.id} className="small"><b>{dd.proposal}</b> — {dd.status}{dd.diagnosis ? <div className="muted">Diagnóstico: {dd.diagnosis}</div> : null}{dd.result_note ? <div>Resultado: {dd.result_note}</div> : null}</li>)}</ul>
            </Card>
          ) : null}
          <Card title="Prévia para o cliente">
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, background: "var(--surface-2)", padding: 10, borderRadius: 8, margin: "0 0 8px", maxHeight: 420, overflow: "auto" }}>{text}</pre>
            <div className="row"><CopyButton text={text} /><ActionForm action={refreshReportAction}><input type="hidden" name="reportId" value={id} /><Submit className="btn ghost">Recalcular itens</Submit></ActionForm></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
