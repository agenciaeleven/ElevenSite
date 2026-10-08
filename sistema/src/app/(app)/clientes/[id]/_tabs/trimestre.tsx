import Link from "next/link";
import type { Actor } from "@/lib/auth-core";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { flowProgress, templatesList } from "@/lib/queries";
import { INITIATIVE_KIND, INITIATIVE_STATUS, LIFECYCLE, SCOPE_CLASS } from "@/lib/labels";
import { addDays, fmtDate, fmtMonth, shiftMonth, today } from "@/lib/dates";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Empty, Field, ProgressBar } from "@/components/ui";
import { initiativeToFlowAction, saveInitiativeAction, savePlanAction } from "@/app/actions";
import type { ClientHeader } from "../page";

type Initiative = { id: string; title: string; kind: string; month_index: number | null; status: string; scope_check: string | null; conditional_note: string | null; flow_id: string | null; flow_name: string | null; objectives: { id: string; title: string; code: string | null }[] };

export async function TabTrimestre({ actor, client }: { actor: Actor; client: ClientHeader }) {
  const edit = isManager(actor);
  const plans = await sql<{ id: string; label: string; start_date: string; end_date: string; status: string; month1_focus: string | null; month2_focus: string | null; month3_focus: string | null; closing_notes: string | null; compass_version: number | null }[]>`
    SELECT p.*, c.version AS compass_version FROM quarterly_plans p LEFT JOIN strategic_compasses c ON c.id = p.compass_id WHERE p.client_id = ${client.id} ORDER BY p.start_date DESC`;
  const objectives = await sql<{ id: string; code: string | null; title: string }[]>`
    SELECT o.id, o.code, o.title FROM strategic_objectives o JOIN strategic_compasses c ON c.id = o.compass_id WHERE c.client_id = ${client.id} AND c.status = 'vigente' ORDER BY o.position`;
  const templates = edit ? await templatesList() : [];
  const qStart = today().slice(0, 8) + "01";
  return (
    <div className="stack">
      <div className="callout info">O Planejamento Trimestral referencia a Bússola vigente (sem copiá-la) e traz o foco prático de cada mês. Iniciativas propostas só viram execução depois de aprovadas e com verificação de escopo contratado.</div>
      {plans.length === 0 ? <Card><Empty title="Nenhum planejamento trimestral" /></Card> : null}
      {await Promise.all(plans.map(async (p) => {
        const inits = await sql<Initiative[]>`
          SELECT i.*, f.name AS flow_name,
            coalesce((SELECT json_agg(json_build_object('id', o.id, 'title', o.title, 'code', o.code)) FROM initiative_objectives io JOIN strategic_objectives o ON o.id = io.objective_id WHERE io.initiative_id = i.id), '[]') AS objectives
          FROM initiatives i LEFT JOIN flow_instances f ON f.id = i.flow_id WHERE i.plan_id = ${p.id} ORDER BY i.month_index NULLS LAST, i.created_at`;
        const prog = await flowProgress(inits.map((i) => i.flow_id).filter(Boolean) as string[]);
        const m0 = p.start_date.slice(0, 7);
        return (
          <Card key={p.id} title={p.label} hint={`${fmtDate(p.start_date, { year: true })} a ${fmtDate(p.end_date, { year: true })} · ${p.status.replace("_", " ")}${p.compass_version ? ` · Bússola v${p.compass_version}` : ""}`}>
            <div className="grid g3">
              {[1, 2, 3].map((m) => (
                <div key={m} className="card card-b" style={{ background: "var(--surface-2)" }}>
                  <h3>Mês {m} · {fmtMonth(shiftMonth(m0, m - 1), false)}</h3>
                  <p className="small" style={{ margin: "4px 0 10px" }}>{(p as Record<string, unknown>)[`month${m}_focus`] as string ?? <span className="nodata">foco não definido</span>}</p>
                  {inits.filter((i) => i.month_index === m).map((i) => <InitiativeCard key={i.id} i={i} edit={edit} clientId={client.id} planId={p.id} objectives={objectives} templates={templates} progress={i.flow_id ? prog.get(i.flow_id) : undefined} />)}
                  {!inits.some((i) => i.month_index === m) ? <p className="nodata">Sem iniciativas</p> : null}
                </div>
              ))}
            </div>
            {inits.some((i) => !i.month_index) ? <div style={{ marginTop: 10 }}><h3>Sem mês definido</h3>{inits.filter((i) => !i.month_index).map((i) => <InitiativeCard key={i.id} i={i} edit={edit} clientId={client.id} planId={p.id} objectives={objectives} templates={templates} />)}</div> : null}
            {edit ? (
              <div className="grid g2" style={{ marginTop: 12 }}>
                <details className="panel"><summary>+ Nova iniciativa / campanha / data sazonal</summary>
                  <ActionForm action={saveInitiativeAction} className="form-grid" reset>
                    <input type="hidden" name="planId" value={p.id} /><input type="hidden" name="clientId" value={client.id} />
                    <Field label="Título" full><input name="title" required /></Field>
                    <Field label="Tipo"><select name="kind">{Object.entries(INITIATIVE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    <Field label="Mês"><select name="monthIndex"><option value="1">Mês 1</option><option value="2">Mês 2</option><option value="3">Mês 3</option><option value="">—</option></select></Field>
                    <Field label="Status"><select name="status" defaultValue="proposta">{Object.entries(INITIATIVE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    <Field label="Escopo contratado"><select name="scopeCheck"><option value="">a verificar</option>{Object.entries(SCOPE_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    <Field label="Objetivos (vários)" full><div className="row">{objectives.map((o) => <label key={o.id} className="check"><input type="checkbox" name="objectiveIds" value={o.id} /> {o.code} {o.title}</label>)}</div></Field>
                    <Field label="Condição / observação" full><input name="conditionalNote" placeholder="Ex.: condicional — confirmar data" /></Field>
                    <div><Submit>Salvar iniciativa</Submit></div>
                  </ActionForm>
                </details>
                <details className="panel"><summary>Editar foco dos meses / encerramento</summary>
                  <ActionForm action={savePlanAction} className="stack">
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="clientId" value={client.id} />
                    <div className="form-grid">
                      <Field label="Rótulo"><input name="label" defaultValue={p.label} required /></Field>
                      <Field label="Início"><input type="date" name="startDate" defaultValue={p.start_date} required /></Field>
                      <Field label="Fim"><input type="date" name="endDate" defaultValue={p.end_date} required /></Field>
                      <Field label="Situação"><select name="status" defaultValue={p.status}><option value="em_planejamento">Em planejamento</option><option value="vigente">Vigente</option><option value="encerrado">Encerrado</option></select></Field>
                    </div>
                    <Field label="Foco do mês 1"><textarea name="month1" defaultValue={p.month1_focus ?? ""} /></Field>
                    <Field label="Foco do mês 2"><textarea name="month2" defaultValue={p.month2_focus ?? ""} /></Field>
                    <Field label="Foco do mês 3"><textarea name="month3" defaultValue={p.month3_focus ?? ""} /></Field>
                    <Field label="Conclusões do trimestre (alimentam o próximo)"><textarea name="closingNotes" defaultValue={p.closing_notes ?? ""} /></Field>
                    <Submit>Salvar</Submit>
                  </ActionForm>
                </details>
              </div>
            ) : null}
            {p.closing_notes ? <div className="note" style={{ marginTop: 10 }}><b>Conclusões:</b> {p.closing_notes}</div> : null}
          </Card>
        );
      }))}
      {edit ? (
        <Card title="Novo planejamento trimestral">
          <ActionForm action={savePlanAction} className="form-grid">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Rótulo"><input name="label" required placeholder="Ex.: 1º trimestre 2027" /></Field>
            <Field label="Início"><input type="date" name="startDate" defaultValue={qStart} required /></Field>
            <Field label="Fim"><input type="date" name="endDate" defaultValue={addDays(shiftMonth(qStart.slice(0, 7), 3) + "-01", -1)} required /></Field>
            <div style={{ alignSelf: "end" }}><Submit>Criar trimestre</Submit></div>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}

function InitiativeCard({ i, edit, clientId, planId, objectives, templates, progress }: { i: Initiative; edit: boolean; clientId: string; planId: string; objectives: { id: string; code: string | null; title: string }[]; templates: { id: string; name: string }[]; progress?: Parameters<typeof ProgressBar>[0]["p"] }) {
  return (
    <div className="card card-b" style={{ marginBottom: 8, padding: 10 }}>
      <div className="row between top">
        <b className="small">{i.title}</b>
        <span className={`badge ${i.status === "aprovada" || i.status === "em_execucao" ? "b-normal" : i.status === "descartada" ? "b-neutral" : "b-info"}`}>{INITIATIVE_STATUS[i.status]}</span>
      </div>
      <div className="small muted">{INITIATIVE_KIND[i.kind]}{i.scope_check ? ` · ${SCOPE_CLASS[i.scope_check]}` : " · escopo a verificar"}</div>
      {i.objectives.length ? <div className="small">Contribui para: {i.objectives.map((o) => o.code ?? o.title).join(", ")}</div> : null}
      {i.conditional_note ? <div className="small" style={{ color: "var(--warn)" }}>{i.conditional_note}</div> : null}
      {i.flow_id ? <div className="small" style={{ marginTop: 6 }}>→ <Link href={`/fluxos/${i.flow_id}`}>{i.flow_name}</Link>{progress ? <ProgressBar p={progress} /> : null}</div> : null}
      {edit ? (
        <div className="row" style={{ marginTop: 6 }}>
          <details className="disclose"><summary className="btn sm ghost">Editar</summary>
            <ActionForm action={saveInitiativeAction} className="stack" style={{ minWidth: 240 }}>
              <input type="hidden" name="id" value={i.id} /><input type="hidden" name="planId" value={planId} /><input type="hidden" name="clientId" value={clientId} />
              <input name="title" defaultValue={i.title} required />
              <select name="kind" defaultValue={i.kind}>{Object.entries(INITIATIVE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select name="monthIndex" defaultValue={String(i.month_index ?? "")}><option value="1">Mês 1</option><option value="2">Mês 2</option><option value="3">Mês 3</option><option value="">—</option></select>
              <select name="status" defaultValue={i.status}>{Object.entries(INITIATIVE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select name="scopeCheck" defaultValue={i.scope_check ?? ""}><option value="">escopo a verificar</option>{Object.entries(SCOPE_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <div>{objectives.map((o) => <label key={o.id} className="check"><input type="checkbox" name="objectiveIds" value={o.id} defaultChecked={i.objectives.some((x) => x.id === o.id)} /> {o.code ?? o.title}</label>)}</div>
              <input name="conditionalNote" defaultValue={i.conditional_note ?? ""} placeholder="Condição / observação" />
              <Submit className="btn sm primary">Salvar</Submit>
            </ActionForm>
          </details>
          {!i.flow_id && i.status === "aprovada" ? (
            <details className="disclose"><summary className="btn sm">Gerar execução</summary>
              <ActionForm action={initiativeToFlowAction} className="stack" style={{ minWidth: 240 }}>
                <input type="hidden" name="id" value={i.id} />
                <input name="name" defaultValue={i.title} />
                <select name="lifecycle" defaultValue={i.kind === "campanha" || i.kind === "sazonal" ? "projeto" : "implantacao"}>{Object.entries(LIFECYCLE).filter(([k]) => k !== "extra").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select name="templateId" defaultValue=""><option value="">Sem modelo</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <label className="small">Início<input type="date" name="startDate" /></label>
                <label className="small">Prazo<input type="date" name="dueDate" /></label>
                <Submit className="btn sm primary">Criar fluxo vinculado</Submit>
              </ActionForm>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
