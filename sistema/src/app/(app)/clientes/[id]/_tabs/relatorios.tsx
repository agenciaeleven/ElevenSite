import Link from "next/link";
import type { Actor } from "@/lib/auth-core";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { usersList } from "@/lib/queries";
import { DECISION_STATUS, REPORT_STATUS } from "@/lib/labels";
import { addDays, fmtDate, fmtDateTime, today, weekStart } from "@/lib/dates";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Empty, Field, StatusPill } from "@/components/ui";
import { createReportAction, decideAction, decisionResultAction, kpiObservationAction, proposeDecisionAction } from "@/app/actions";
import type { ClientHeader } from "../page";

export async function TabRelatorios({ actor, client }: { actor: Actor; client: ClientHeader }) {
  const edit = isManager(actor);
  const reports = await sql<{ id: string; title: string; kind: string; status: string; period_start: string; period_end: string; updated_at: Date }[]>`
    SELECT id, title, kind, status, period_start, period_end, updated_at FROM client_reports WHERE client_id = ${client.id} ORDER BY period_end DESC`;
  const kpis = await sql<{ id: string; name: string; unit: string | null; target: number | null; is_fictitious: boolean; obs: { observed_on: string; value: number; note: string | null }[] }[]>`
    SELECT k.id, k.name, k.unit, k.target, k.is_fictitious,
      coalesce((SELECT json_agg(json_build_object('observed_on', o.observed_on, 'value', o.value, 'note', o.note) ORDER BY o.observed_on DESC) FROM kpi_observations o WHERE o.kpi_id = k.id), '[]') AS obs
    FROM kpi_definitions k WHERE k.client_id = ${client.id} ORDER BY k.created_at`;
  const decisions = await sql<{ id: string; diagnosis: string | null; proposal: string; status: string; owner: string | null; decider: string | null; decided_at: Date | null; task_id: string | null; task_title: string | null; task_status: string | null; result_note: string | null; result_recorded_at: Date | null; report_id: string | null; report_title: string | null; kpi_name: string | null; created_at: Date }[]>`
    SELECT d.*, o.name AS owner, dd.name AS decider, t.title AS task_title, t.status AS task_status, r.title AS report_title, k.name AS kpi_name
    FROM decisions d LEFT JOIN users o ON o.id = d.owner_id LEFT JOIN users dd ON dd.id = d.decided_by LEFT JOIN tasks t ON t.id = d.task_id
    LEFT JOIN client_reports r ON r.id = d.report_id LEFT JOIN kpi_definitions k ON k.id = d.kpi_id
    WHERE d.client_id = ${client.id} ORDER BY d.created_at DESC`;
  const users = edit ? await usersList() : [];
  const ws = weekStart(today());
  return (
    <div className="stack">
      <div className="grid g-side">
        <Card title="Relatórios do cliente" hint="Gerados a partir de fatos registrados, revisados antes de compartilhar." tight>
          {reports.length === 0 ? <Empty title="Nenhum relatório ainda" /> : (
            <ul className="list">{reports.map((r) => (
              <li key={r.id} className="row between">
                <div><Link href={`/relatorios/${r.id}`}><b>{r.title}</b></Link><div className="small muted">{r.kind === "semanal" ? "Semanal de execução" : "Mensal de tráfego"} · atualizado {fmtDateTime(r.updated_at)}</div></div>
                <span className={`badge ${r.status === "rascunho" ? "b-atencao" : "b-normal"}`}>{REPORT_STATUS[r.status]}</span>
              </li>
            ))}</ul>
          )}
        </Card>
        {edit ? (
          <Card title="Gerar relatório">
            <ActionForm action={createReportAction} className="stack">
              <input type="hidden" name="clientId" value={client.id} />
              <Field label="Tipo"><select name="kind"><option value="semanal">Semanal de execução</option><option value="mensal_trafego">Mensal de tráfego (KPI → decisão)</option></select></Field>
              <div className="form-grid">
                <Field label="De"><input type="date" name="start" defaultValue={addDays(ws, -7)} required /></Field>
                <Field label="Até"><input type="date" name="end" defaultValue={addDays(ws, -1)} required /></Field>
              </div>
              <Submit>Gerar rascunho</Submit>
            </ActionForm>
          </Card>
        ) : null}
      </div>

      <Card title="Diagnóstico → decisão → ação → resultado" hint="Ação proposta só vira tarefa após aprovação; o resultado posterior fica ligado à decisão de origem." tight>
        {decisions.length === 0 ? <Empty title="Nenhuma decisão registrada" /> : (
          <ul className="list">{decisions.map((d) => (
            <li key={d.id}>
              <div className="row between top">
                <div className="grow">
                  <b>{d.proposal}</b> <span className={`badge ${d.status === "aprovada" ? "b-normal" : d.status === "recusada" ? "b-neutral" : "b-atencao"}`}>{DECISION_STATUS[d.status]}</span>
                  {d.diagnosis ? <div className="small"><span className="muted">Diagnóstico:</span> {d.diagnosis}</div> : null}
                  <div className="small muted">
                    {d.kpi_name ? `KPI: ${d.kpi_name} · ` : ""}{d.report_id ? <><Link href={`/relatorios/${d.report_id}`}>{d.report_title}</Link> · </> : null}
                    responsável: {d.owner ?? "—"}{d.decided_at ? ` · decidido por ${d.decider} em ${fmtDateTime(d.decided_at)}` : ""}
                  </div>
                  {d.task_id ? <div className="small">Ação: <Link href={`/tarefas/${d.task_id}`}>{d.task_title}</Link> <StatusPill status={d.task_status!} /></div> : null}
                  {d.result_note ? <div className="just"><b>Resultado posterior ({fmtDateTime(d.result_recorded_at)}):</b> {d.result_note}</div> : null}
                </div>
                {edit ? (
                  <div className="row">
                    {d.status === "proposta" ? (
                      <details className="disclose"><summary className="btn sm primary">Decidir</summary>
                        <ActionForm action={decideAction} className="stack" style={{ minWidth: 260 }}>
                          <input type="hidden" name="decisionId" value={d.id} />
                          <textarea name="note" placeholder="Justificativa" />
                          <label className="small">Prazo da ação<input type="date" name="dueDate" /></label>
                          <label className="small">Horas estimadas<input name="estHours" inputMode="decimal" /></label>
                          <div className="row"><Submit className="btn sm ok" name="verdict" value="aprovar">Aprovar e criar tarefa</Submit><Submit className="btn sm danger" name="verdict" value="recusar">Recusar</Submit></div>
                        </ActionForm>
                      </details>
                    ) : null}
                    {d.status === "aprovada" ? (
                      <details className="disclose"><summary className="btn sm">Registrar resultado</summary>
                        <ActionForm action={decisionResultAction} className="stack" style={{ minWidth: 260 }}>
                          <input type="hidden" name="decisionId" value={d.id} />
                          <textarea name="result" placeholder="Resultado observado, com métrica e fonte" required defaultValue={d.result_note ?? ""} />
                          <Submit className="btn sm primary">Salvar</Submit>
                        </ActionForm>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}</ul>
        )}
        {edit ? (
          <div className="card-b">
            <details className="panel"><summary>+ Propor decisão / intervenção</summary>
              <ActionForm action={proposeDecisionAction} className="form-grid" reset>
                <input type="hidden" name="clientId" value={client.id} />
                <Field label="KPI relacionado"><select name="kpiId"><option value="">—</option>{kpis.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>
                <Field label="Relatório de origem"><select name="reportId"><option value="">—</option>{reports.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>
                <Field label="Responsável pela ação"><select name="ownerId"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                <Field label="Diagnóstico" full><textarea name="diagnosis" /></Field>
                <Field label="Ação proposta" full><input name="proposal" required /></Field>
                <div><Submit>Propor</Submit></div>
              </ActionForm>
            </details>
          </div>
        ) : null}
      </Card>

      <Card title="Medições de KPI" hint="Inseridas manualmente no P0 (integrações em P2). Valores fictícios ficam rotulados." tight>
        {kpis.length === 0 ? <Empty title="Nenhum KPI — defina na aba Bússola" /> : (
          <ul className="list">{kpis.map((k) => (
            <li key={k.id}>
              <b>{k.name}</b> {k.is_fictitious ? <span className="badge b-demo">fictício</span> : null} <span className="small muted">meta {k.target ?? "a definir"} {k.unit ?? ""}</span>
              <div className="small">{k.obs.length ? k.obs.slice(0, 6).map((o) => `${fmtDate(o.observed_on)}: ${o.value}`).join(" · ") : <span className="nodata">sem medições</span>}</div>
              {edit ? (
                <ActionForm action={kpiObservationAction} className="row" reset>
                  <input type="hidden" name="kpiId" value={k.id} />
                  <input type="date" name="observedOn" defaultValue={today()} style={{ width: 150 }} required />
                  <input name="value" placeholder="Valor" inputMode="decimal" style={{ width: 110 }} required />
                  <input name="source" placeholder="Fonte" style={{ width: 160 }} />
                  <Submit className="btn sm">Registrar medição</Submit>
                </ActionForm>
              ) : null}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
