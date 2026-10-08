import Link from "next/link";
import type { Actor } from "@/lib/auth-core";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { templatesList } from "@/lib/queries";
import { LIFECYCLE, OPPORTUNITY_STATUS, SCOPE_CLASS } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Empty, Field } from "@/components/ui";
import { convertOpportunityAction, createOpportunityAction, deleteFrontAction, deleteObjectiveAction, opportunityStatusAction, saveCompassAction, saveFrontAction, saveKpiAction, saveObjectiveAction } from "@/app/actions";
import type { ClientHeader } from "../page";

const num = (v: number | null, unit?: string | null) => (v == null ? <span className="nodata">a definir</span> : <>{Number(v).toLocaleString("pt-BR")}{unit ? ` ${unit}` : ""}</>);

export async function TabBussola({ actor, client }: { actor: Actor; client: ClientHeader }) {
  const edit = isManager(actor);
  const versions = await sql<{ id: string; version: number; status: string; diagnosis: string | null; audience: string | null; positioning: string | null; guidelines: string | null; hypotheses: string | null; created_at: Date; author: string | null }[]>`
    SELECT c.*, u.name AS author FROM strategic_compasses c LEFT JOIN users u ON u.id = c.created_by WHERE c.client_id = ${client.id} ORDER BY c.version DESC`;
  const cur = versions.find((v) => v.status === "vigente") ?? null;
  const objectives = cur ? await sql<{ id: string; code: string | null; title: string; description: string | null; fronts: { id: string; title: string }[] }[]>`
    SELECT o.id, o.code, o.title, o.description, coalesce((SELECT json_agg(json_build_object('id', f.id, 'title', f.title) ORDER BY f.position) FROM strategic_fronts f WHERE f.objective_id = o.id), '[]') AS fronts
    FROM strategic_objectives o WHERE o.compass_id = ${cur.id} ORDER BY o.position` : [];
  const kpis = await sql<{ id: string; name: string; unit: string | null; baseline: number | null; target: number | null; deadline: string | null; source: string | null; reliability: string | null; is_fictitious: boolean; objective_title: string | null; last_value: number | null; last_on: string | null }[]>`
    SELECT k.*, o.title AS objective_title,
      (SELECT value FROM kpi_observations ob WHERE ob.kpi_id = k.id ORDER BY observed_on DESC LIMIT 1) AS last_value,
      (SELECT observed_on FROM kpi_observations ob WHERE ob.kpi_id = k.id ORDER BY observed_on DESC LIMIT 1) AS last_on
    FROM kpi_definitions k LEFT JOIN strategic_objectives o ON o.id = k.objective_id WHERE k.client_id = ${client.id} ORDER BY k.created_at`;
  const opps = await sql<{ id: string; title: string; description: string | null; status: string; scope_check: string | null; decision_note: string | null; decided_at: Date | null; decider: string | null; converted_flow_id: string | null; objective_title: string | null; origin: string | null }[]>`
    SELECT op.*, u.name AS decider, o.title AS objective_title FROM strategic_opportunities op LEFT JOIN users u ON u.id = op.decided_by LEFT JOIN strategic_objectives o ON o.id = op.objective_id
    WHERE op.client_id = ${client.id} ORDER BY op.status = 'aprovada' DESC, op.status IN ('recusada','arquivada'), op.created_at`;
  const templates = edit ? await templatesList() : [];

  return (
    <div className="stack">
      <div className="callout info">A Bússola é direção estratégica viva e versionada — <b>não</b> é checklist operacional nem prova de escopo vendido. Objetivos não geram tarefas; oportunidades só viram execução depois de aprovadas.</div>
      <div className="grid g-side">
        <Card title={cur ? `Bússola v${cur.version}` : "Bússola ainda não criada"} hint={cur ? `Criada em ${fmtDateTime(cur.created_at)}${cur.author ? ` por ${cur.author}` : ""}` : "Diagnóstico, público, posicionamento, diretrizes e hipóteses."}>
          {cur ? (
            <div className="stack">
              {([["Diagnóstico", cur.diagnosis], ["Público", cur.audience], ["Posicionamento", cur.positioning], ["Diretrizes", cur.guidelines], ["Hipóteses", cur.hypotheses]] as const).map(([l, v]) => (
                <div key={l}><h3>{l}</h3><p style={{ whiteSpace: "pre-wrap" }}>{v ?? <span className="nodata">não preenchido</span>}</p></div>
              ))}
            </div>
          ) : <Empty title="Sem Bússola" />}
        </Card>
        {edit ? (
          <Card title={cur ? "Editar / nova versão" : "Criar Bússola"}>
            <ActionForm action={saveCompassAction} className="stack">
              <input type="hidden" name="clientId" value={client.id} />
              <Field label="Diagnóstico"><textarea name="diagnosis" defaultValue={cur?.diagnosis ?? ""} /></Field>
              <Field label="Público"><textarea name="audience" defaultValue={cur?.audience ?? ""} /></Field>
              <Field label="Posicionamento"><textarea name="positioning" defaultValue={cur?.positioning ?? ""} /></Field>
              <Field label="Diretrizes"><textarea name="guidelines" defaultValue={cur?.guidelines ?? ""} /></Field>
              <Field label="Hipóteses"><textarea name="hypotheses" defaultValue={cur?.hypotheses ?? ""} /></Field>
              {cur ? <label className="check"><input type="checkbox" name="newVersion" /> Salvar como nova versão (preserva v{cur.version} e copia objetivos)</label> : null}
              <Submit>{cur ? "Salvar" : "Criar Bússola v1"}</Submit>
            </ActionForm>
          </Card>
        ) : null}
      </div>

      {cur ? (
        <Card title="Objetivos macro e frentes" hint="Entidades distintas de metas (KPIs), iniciativas e tarefas.">
          {objectives.length === 0 ? <Empty title="Nenhum objetivo" /> : (
            <div className="grid g2">{objectives.map((o) => (
              <div key={o.id} className="card card-b">
                <div className="row between top"><h3>{o.code ? `${o.code}. ` : ""}{o.title}</h3>
                  {edit ? <ActionForm action={deleteObjectiveAction} confirm="Remover este objetivo?"><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="id" value={o.id} /><Submit className="btn sm ghost">Remover</Submit></ActionForm> : null}
                </div>
                {o.description ? <p className="small" style={{ marginTop: 4 }}>{o.description}</p> : null}
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {o.fronts.map((f) => (
                    <li key={f.id} className="small">{f.title} {edit ? <ActionForm action={deleteFrontAction} style={{ display: "inline" }}><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="id" value={f.id} /><Submit className="btn sm ghost" pendingText="…">×</Submit></ActionForm> : null}</li>
                  ))}
                </ul>
                {edit ? (
                  <ActionForm action={saveFrontAction} className="row" reset>
                    <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="objectiveId" value={o.id} />
                    <input name="title" placeholder="Nova frente / micro-objetivo" className="grow" style={{ width: "auto" }} required />
                    <Submit className="btn sm">Adicionar</Submit>
                  </ActionForm>
                ) : null}
              </div>
            ))}</div>
          )}
          {edit ? (
            <details className="panel" style={{ marginTop: 12 }}>
              <summary>+ Novo objetivo</summary>
              <ActionForm action={saveObjectiveAction} className="form-grid" reset>
                <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="compassId" value={cur.id} />
                <Field label="Código"><input name="code" placeholder="A, B, C…" /></Field>
                <Field label="Título"><input name="title" required /></Field>
                <Field label="Descrição" full><textarea name="description" /></Field>
                <div><Submit>Salvar objetivo</Submit></div>
              </ActionForm>
            </details>
          ) : null}
        </Card>
      ) : null}

      <Card title="Indicadores de resultado (KPIs)" hint="Meta, período, fonte e confiabilidade. Separados do percentual de entrega — nunca inventar linha de base." tight>
        {kpis.length === 0 ? <Empty title="Nenhum indicador definido" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Indicador</th><th>Objetivo</th><th className="num">Linha de base</th><th className="num">Meta</th><th>Prazo</th><th className="num">Última medição</th><th>Fonte / confiabilidade</th></tr></thead>
            <tbody>{kpis.map((k) => (
              <tr key={k.id}>
                <td><b>{k.name}</b> {k.is_fictitious ? <span className="badge b-demo">fictício</span> : null}</td>
                <td className="small">{k.objective_title ?? "—"}</td>
                <td className="num">{num(k.baseline, k.unit)}</td>
                <td className="num">{num(k.target, k.unit)}</td>
                <td className="small">{k.deadline ? fmtDate(k.deadline, { year: true }) : <span className="nodata">a definir</span>}</td>
                <td className="num">{k.last_value != null ? <>{num(k.last_value, k.unit)}<div className="small muted">{fmtDate(k.last_on)}</div></> : <span className="nodata">sem medição</span>}</td>
                <td className="small">{k.source ?? "—"} · {k.reliability ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {edit ? (
          <div className="card-b">
            <details className="panel"><summary>+ Novo indicador</summary>
              <ActionForm action={saveKpiAction} className="form-grid" reset>
                <input type="hidden" name="clientId" value={client.id} />
                <Field label="Nome"><input name="name" required /></Field>
                <Field label="Unidade"><input name="unit" placeholder="R$, seguidores, %" /></Field>
                <Field label="Objetivo"><select name="objectiveId"><option value="">—</option>{objectives.map((o) => <option key={o.id} value={o.id}>{o.code} {o.title}</option>)}</select></Field>
                <Field label="Linha de base" help="Deixe vazio se não houver"><input name="baseline" inputMode="decimal" /></Field>
                <Field label="Meta"><input name="target" inputMode="decimal" /></Field>
                <Field label="Prazo"><input type="date" name="deadline" /></Field>
                <Field label="Fonte"><input name="source" /></Field>
                <Field label="Confiabilidade"><input name="reliability" placeholder="alta, média, a definir" /></Field>
                <label className="check"><input type="checkbox" name="isFictitious" /> Dado fictício (demonstração)</label>
                <div><Submit>Salvar indicador</Submit></div>
              </ActionForm>
            </details>
          </div>
        ) : null}
      </Card>

      <Card title="Banco de oportunidades" hint="Proposta → avaliando → aprovada/priorizada, recusada ou arquivada. Nada entra no trabalho do time antes da decisão." tight>
        {opps.length === 0 ? <Empty title="Nenhuma oportunidade registrada" /> : (
          <ul className="list">{opps.map((o) => (
            <li key={o.id}>
              <div className="row between top">
                <div className="grow">
                  <b>{o.title}</b> <span className={`badge ${o.status === "aprovada" ? "b-normal" : o.status === "recusada" || o.status === "arquivada" ? "b-neutral" : "b-info"}`}>{OPPORTUNITY_STATUS[o.status]}</span>
                  {o.scope_check ? <span className="badge b-neutral" style={{ marginLeft: 4 }}>{SCOPE_CLASS[o.scope_check]}</span> : null}
                  <div className="small muted">{o.objective_title ? `Objetivo: ${o.objective_title}` : ""}{o.origin ? ` · origem: ${o.origin}` : ""}{o.decided_at ? ` · decidido por ${o.decider} em ${fmtDateTime(o.decided_at)}` : ""}</div>
                  {o.decision_note ? <div className="small">Decisão: {o.decision_note}</div> : null}
                  {o.converted_flow_id ? <div className="small">→ <Link href={`/fluxos/${o.converted_flow_id}`}>Execução criada</Link></div> : null}
                </div>
                {edit && !o.converted_flow_id ? (
                  <div className="row">
                    <details className="disclose"><summary className="btn sm">Decidir</summary>
                      <ActionForm action={opportunityStatusAction} className="stack" style={{ minWidth: 280 }}>
                        <input type="hidden" name="id" value={o.id} />
                        <select name="status" defaultValue={o.status}>{Object.entries(OPPORTUNITY_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                        <select name="scopeCheck" defaultValue={o.scope_check ?? ""}><option value="">Verificação de escopo…</option>{Object.entries(SCOPE_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                        <textarea name="note" placeholder="Justificativa da decisão" />
                        <Submit className="btn sm primary">Registrar</Submit>
                      </ActionForm>
                    </details>
                    {o.status === "aprovada" ? (
                      <details className="disclose"><summary className="btn sm primary">Converter em execução</summary>
                        <ActionForm action={convertOpportunityAction} className="stack" style={{ minWidth: 280 }}>
                          <input type="hidden" name="id" value={o.id} />
                          <input name="name" defaultValue={o.title} required />
                          <select name="lifecycle" defaultValue="projeto">{Object.entries(LIFECYCLE).filter(([k]) => k !== "extra").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                          <select name="templateId" defaultValue=""><option value="">Sem modelo</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                          <label className="small">Início<input type="date" name="startDate" /></label>
                          <label className="small">Prazo<input type="date" name="dueDate" /></label>
                          <Submit className="btn sm primary">Criar fluxo (em planejamento)</Submit>
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
            <details className="panel"><summary>+ Registrar oportunidade</summary>
              <ActionForm action={createOpportunityAction} className="form-grid" reset>
                <input type="hidden" name="clientId" value={client.id} />
                <Field label="Oportunidade"><input name="title" required /></Field>
                <Field label="Objetivo relacionado"><select name="objectiveId"><option value="">—</option>{objectives.map((o) => <option key={o.id} value={o.id}>{o.code} {o.title}</option>)}</select></Field>
                <Field label="Origem"><input name="origin" placeholder="Bússola, relatório, resultado de projeto…" /></Field>
                <Field label="Descrição" full><textarea name="description" /></Field>
                <div><Submit>Registrar</Submit></div>
              </ActionForm>
            </details>
          </div>
        ) : null}
      </Card>

      {versions.length > 1 ? (
        <Card title="Versões anteriores" tight>
          <ul className="list">{versions.filter((v) => v.status !== "vigente").map((v) => (
            <li key={v.id}><b>v{v.version}</b> · {v.status} · {fmtDateTime(v.created_at)} {v.author ? `· ${v.author}` : ""}<div className="small muted">{v.positioning ?? ""}</div></li>
          ))}</ul>
        </Card>
      ) : null}
    </div>
  );
}
