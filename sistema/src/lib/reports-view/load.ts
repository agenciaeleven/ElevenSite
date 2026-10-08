import { sql } from "@/lib/db";
import type { ReportItem } from "@/lib/services/reports";

export type ReportFull = {
  id: string; client_id: string; client_name: string; kind: string; period_start: string; period_end: string; title: string; status: string; summary: string | null;
  completed_items: ReportItem[]; results_text: string | null; diagnosis: string | null; next_steps: string | null; internal_notes: string | null;
  reviewed_at: Date | null; reviewer: string | null; shared_at: Date | null; is_demo: boolean; author: string | null; updated_at: Date;
};

export async function loadReport(id: string) {
  const [r] = await sql<ReportFull[]>`
    SELECT r.*, c.name AS client_name, rv.name AS reviewer, a.name AS author FROM client_reports r JOIN clients c ON c.id = r.client_id
    LEFT JOIN users rv ON rv.id = r.reviewed_by LEFT JOIN users a ON a.id = r.created_by WHERE r.id = ${id}`;
  if (!r) return null;
  const kpis = await sql<{ name: string; unit: string | null; target: number | null; value: number; observed_on: string; is_fictitious: boolean; source: string | null }[]>`
    SELECT k.name, k.unit, k.target, o.value, o.observed_on, o.is_fictitious, o.source FROM kpi_observations o JOIN kpi_definitions k ON k.id = o.kpi_id
    WHERE k.client_id = ${r.client_id} AND (o.report_id = ${id} OR o.observed_on BETWEEN ${r.period_start}::date AND ${r.period_end}::date) ORDER BY k.name, o.observed_on`;
  const decisions = await sql<{ id: string; diagnosis: string | null; proposal: string; status: string; result_note: string | null }[]>`
    SELECT id, diagnosis, proposal, status, result_note FROM decisions WHERE report_id = ${id} ORDER BY created_at`;
  return { r, kpis, decisions };
}

/** Texto para copiar/colar: só conteúdo destinado ao cliente (sem notas internas). */
export function reportText(d: NonNullable<Awaited<ReturnType<typeof loadReport>>>) {
  const { r, kpis, decisions } = d;
  const lines = [r.title, ""];
  if (r.summary) lines.push(r.summary, "");
  const items = r.completed_items.filter((i) => i.include);
  lines.push("Entregas concluídas no período:");
  if (!items.length) lines.push("• Nenhuma entrega concluída registrada no período.");
  const groups = [...new Set(items.map((i) => i.group))];
  for (const g of groups) {
    lines.push(`${g}:`);
    for (const i of items.filter((x) => x.group === g)) lines.push(`• ${i.text} (${i.date.split("-").reverse().join("/")})${i.evidence?.length ? ` — ${i.evidence.join(", ")}` : ""}`);
  }
  if (kpis.length) {
    lines.push("", "Indicadores:");
    for (const k of kpis) lines.push(`• ${k.name}: ${k.value}${k.unit ? ` ${k.unit}` : ""} em ${k.observed_on.split("-").reverse().join("/")}${k.target != null ? ` (meta ${k.target})` : ""}${k.is_fictitious ? " [FICTÍCIO]" : ""}`);
  }
  if (r.results_text) lines.push("", "Resultados:", r.results_text);
  if (r.diagnosis) lines.push("", "Diagnóstico:", r.diagnosis);
  if (decisions.length) {
    lines.push("", "Decisões e próximas ações:");
    for (const dd of decisions) lines.push(`• ${dd.proposal} — ${dd.status === "aprovada" ? "aprovada" : dd.status === "recusada" ? "não seguiremos" : "em avaliação"}${dd.result_note ? ` | Resultado: ${dd.result_note}` : ""}`);
  }
  if (r.next_steps) lines.push("", "Próximos passos:", r.next_steps);
  return lines.join("\n");
}
