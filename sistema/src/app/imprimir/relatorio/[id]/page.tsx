import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { clientScope, inScope, isManager } from "@/lib/access";
import { loadReport } from "@/lib/reports-view/load";
import { fmtDate } from "@/lib/dates";
import { PrintButton } from "@/components/ClientBits";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relatório para impressão" };

/** Versão do cliente: sem notas internas, capacidade individual ou justificativas sensíveis. */
export default async function PrintReport({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!isManager(actor)) notFound();
  const d = await loadReport(id);
  if (!d || !inScope(await clientScope(actor), d.r.client_id)) notFound();
  const { r, kpis, decisions } = d;
  const items = r.completed_items.filter((i) => i.include);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <div className="no-print" style={{ padding: 12, borderBottom: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center" }}>
        <PrintButton /> <span className="small muted">{r.status === "rascunho" ? "⚠ Rascunho ainda não revisado." : "Revisado."} Use “Salvar como PDF” na janela de impressão.</span>
      </div>
      <article className="print-doc">
        {r.is_demo ? <p style={{ color: "var(--demo)", fontWeight: 600 }}>DOCUMENTO DE DEMONSTRAÇÃO — dados fictícios</p> : null}
        <p className="small muted">Agência Eleven</p>
        <h1>{r.title}</h1>
        <p className="muted">Período: {fmtDate(r.period_start, { year: true })} a {fmtDate(r.period_end, { year: true })}</p>
        {r.summary ? <><h2>Resumo</h2><p style={{ whiteSpace: "pre-wrap" }}>{r.summary}</p></> : null}
        <h2>Entregas concluídas</h2>
        {items.length === 0 ? <p>Nenhuma entrega concluída registrada no período.</p> : groups.map((g) => (
          <div key={g} style={{ marginBottom: 8 }}>
            <b>{g}</b>
            <ul>{items.filter((i) => i.group === g).map((i, k) => <li key={k}>{i.text} <span className="muted">({fmtDate(i.date)})</span>{i.evidence?.length ? <> — {i.evidence.join(", ")}</> : null}</li>)}</ul>
          </div>
        ))}
        {kpis.length ? (<><h2>Indicadores</h2><ul>{kpis.map((k, i) => <li key={i}>{k.name}: <b>{k.value}{k.unit ? ` ${k.unit}` : ""}</b> em {fmtDate(k.observed_on)}{k.target != null ? ` (meta ${k.target})` : ""}{k.is_fictitious ? " — valor fictício" : ""}{k.source ? ` · fonte: ${k.source}` : ""}</li>)}</ul></>) : null}
        {r.results_text ? <><h2>Resultados</h2><p style={{ whiteSpace: "pre-wrap" }}>{r.results_text}</p></> : null}
        {r.diagnosis ? <><h2>Diagnóstico</h2><p style={{ whiteSpace: "pre-wrap" }}>{r.diagnosis}</p></> : null}
        {decisions.length ? <><h2>Decisões e próximas ações</h2><ul>{decisions.map((dd) => <li key={dd.id}>{dd.proposal} — {dd.status === "aprovada" ? "aprovada" : dd.status === "recusada" ? "não seguiremos" : "em avaliação"}{dd.result_note ? `. Resultado: ${dd.result_note}` : ""}</li>)}</ul></> : null}
        {r.next_steps ? <><h2>Próximos passos</h2><p style={{ whiteSpace: "pre-wrap" }}>{r.next_steps}</p></> : null}
      </article>
    </div>
  );
}
