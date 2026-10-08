import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { LIFECYCLE } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Field } from "@/components/ui";
import { deleteTemplateStepAction, saveTemplateAction, saveTemplateStepAction } from "../../../../actions";

export const metadata = { title: "Modelo de fluxo" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!isManager(actor)) redirect("/meu-dia");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [t] = await sql<{ id: string; name: string; lifecycle: string; description: string | null; active: boolean }[]>`SELECT * FROM flow_templates WHERE id = ${id}`;
  if (!t) notFound();
  const steps = await sql<{ id: string; position: number; stage: string | null; name: string; role_hint: string | null; est_hours: number | null; offset_days: number | null; done_criteria: string | null }[]>`SELECT * FROM flow_template_steps WHERE template_id = ${id} ORDER BY position`;
  const total = steps.reduce((a, s) => a + (s.est_hours ?? 0), 0);
  const [{ uses }] = await sql<{ uses: number }[]>`SELECT count(*)::int AS uses FROM flow_instances WHERE template_id = ${id}`;
  return (
    <div className="page">
      <div className="crumbs"><Link href="/config">Configurações</Link> / modelos</div>
      <div className="page-head"><div><h1>{t.name}</h1><p className="sub">{LIFECYCLE[t.lifecycle]} · {steps.length} etapas · {total}h planejadas · usado em {uses} fluxo(s). Alterações valem para novos fluxos; instâncias existentes mantêm sua base.</p></div></div>
      <div className="grid g-side">
        <Card title="Etapas e tarefas do modelo" hint="Peso = horas da etapa ÷ total. Prazo relativo: dias em relação à data de referência (negativo = antes)." tight>
          <div className="table-wrap"><table>
            <thead><tr><th className="num">#</th><th>Etapa</th><th>Tarefa</th><th>Função</th><th className="num">Horas</th><th className="num">Peso</th><th className="num">Prazo (dias)</th><th /></tr></thead>
            <tbody>{steps.map((s) => (
              <tr key={s.id}>
                <td colSpan={8} style={{ padding: 0 }}>
                  <ActionForm action={saveTemplateStepAction} className="row" style={{ padding: "6px 12px", flexWrap: "nowrap" }}>
                    <input type="hidden" name="id" value={s.id} /><input type="hidden" name="templateId" value={id} />
                    <input name="position" defaultValue={s.position} style={{ width: 50 }} />
                    <input name="stage" defaultValue={s.stage ?? ""} style={{ width: 120 }} placeholder="Etapa" />
                    <input name="name" defaultValue={s.name} required style={{ minWidth: 200 }} />
                    <input name="roleHint" defaultValue={s.role_hint ?? ""} style={{ width: 110 }} placeholder="Função" />
                    <input name="estHours" defaultValue={s.est_hours ?? ""} style={{ width: 64, borderColor: s.est_hours == null ? "var(--warn)" : undefined }} placeholder="h" inputMode="decimal" />
                    <span className="small mono" style={{ width: 52, textAlign: "right" }}>{s.est_hours != null && total ? `${Math.round((1000 * s.est_hours) / total) / 10}%` : "—"}</span>
                    <input name="offsetDays" defaultValue={s.offset_days ?? ""} style={{ width: 64 }} placeholder="dias" />
                    <Submit className="btn sm" pendingText="…">Salvar</Submit>
                  </ActionForm>
                  <ActionForm action={deleteTemplateStepAction} style={{ padding: "0 12px 6px" }}><input type="hidden" name="id" value={s.id} /><Submit className="btn sm ghost" pendingText="…">remover etapa</Submit></ActionForm>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="card-b">
            <ActionForm action={saveTemplateStepAction} className="form-grid" reset>
              <input type="hidden" name="templateId" value={id} />
              <Field label="Etapa"><input name="stage" /></Field>
              <Field label="Tarefa"><input name="name" required /></Field>
              <Field label="Função sugerida"><input name="roleHint" /></Field>
              <Field label="Horas estimadas"><input name="estHours" inputMode="decimal" /></Field>
              <Field label="Prazo relativo (dias)"><input name="offsetDays" inputMode="numeric" /></Field>
              <Field label="Critério de pronto"><input name="doneCriteria" /></Field>
              <div><Submit>Adicionar etapa</Submit></div>
            </ActionForm>
          </div>
        </Card>
        <Card title="Dados do modelo">
          <ActionForm action={saveTemplateAction} className="stack">
            <input type="hidden" name="id" value={id} />
            <Field label="Nome"><input name="name" defaultValue={t.name} required /></Field>
            <Field label="Tipo"><select name="lifecycle" defaultValue={t.lifecycle}>{Object.entries(LIFECYCLE).filter(([k]) => k !== "extra").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Descrição"><textarea name="description" defaultValue={t.description ?? ""} /></Field>
            <label className="check"><input type="checkbox" name="active" defaultChecked={t.active} /> Disponível para novos fluxos</label>
            <Submit>Salvar</Submit>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
