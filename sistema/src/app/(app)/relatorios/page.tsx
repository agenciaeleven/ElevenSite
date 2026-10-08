import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { clientScope, isManager, scopeIds } from "@/lib/access";
import { visibleClients } from "@/lib/queries";
import { addDays, fmtDateTime, today, weekStart } from "@/lib/dates";
import { REPORT_STATUS } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Demo, Empty, Field } from "@/components/ui";
import { createReportAction } from "../../actions";

export const metadata = { title: "Relatórios" };

export default async function ReportsPage() {
  const actor = await requireActor();
  if (!isManager(actor)) redirect("/meu-dia");
  const ids = scopeIds(await clientScope(actor));
  const reports = await sql<{ id: string; title: string; kind: string; status: string; client_name: string; updated_at: Date; is_demo: boolean; author: string | null }[]>`
    SELECT r.id, r.title, r.kind, r.status, c.name AS client_name, r.updated_at, r.is_demo, u.name AS author FROM client_reports r JOIN clients c ON c.id = r.client_id LEFT JOIN users u ON u.id = r.created_by
    WHERE (${ids}::uuid[] IS NULL OR r.client_id = ANY(${ids}::uuid[])) ORDER BY r.updated_at DESC LIMIT 100`;
  const clients = (await visibleClients(actor)).filter((c) => !c.is_internal);
  const ws = weekStart(today());
  return (
    <div className="page">
      <div className="page-head"><div><h1>Relatórios de acompanhamento</h1><p className="sub">Semanal de execução (P0) e mensal de tráfego com KPI → diagnóstico → decisão. Sempre revisados antes de compartilhar; o envio é manual (sem integração).</p></div></div>
      <div className="grid g-side">
        <Card tight>
          {reports.length === 0 ? <Empty title="Nenhum relatório gerado" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Relatório</th><th>Cliente</th><th>Situação</th><th>Atualizado</th></tr></thead>
              <tbody>{reports.map((r) => (
                <tr key={r.id} className="click">
                  <td><Link href={`/relatorios/${r.id}`}><b>{r.title}</b></Link> <Demo on={r.is_demo} /><div className="small muted">{r.kind === "semanal" ? "Semanal de execução" : "Mensal de tráfego"} · {r.author ?? "—"}</div></td>
                  <td className="small">{r.client_name}</td>
                  <td><span className={`badge ${r.status === "rascunho" ? "b-atencao" : "b-normal"}`}>{REPORT_STATUS[r.status]}</span></td>
                  <td className="small">{fmtDateTime(r.updated_at)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <Card title="Gerar relatório" hint="O rascunho lista somente tarefas concluídas e conteúdos publicados no período, do cliente escolhido.">
          <ActionForm action={createReportAction} className="stack">
            <Field label="Cliente"><select name="clientId" required>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Tipo"><select name="kind"><option value="semanal">Semanal de execução</option><option value="mensal_trafego">Mensal de tráfego</option></select></Field>
            <div className="form-grid">
              <Field label="De"><input type="date" name="start" defaultValue={addDays(ws, -7)} required /></Field>
              <Field label="Até"><input type="date" name="end" defaultValue={addDays(ws, -1)} required /></Field>
            </div>
            <p className="small muted">Dica: para a semana atual use de {ws.split("-").reverse().join("/")} até hoje.</p>
            <Submit>Gerar rascunho</Submit>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
