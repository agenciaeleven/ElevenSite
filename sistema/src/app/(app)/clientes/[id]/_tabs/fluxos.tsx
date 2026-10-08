import type { Actor } from "@/lib/auth-core";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { templatesList, usersList } from "@/lib/queries";
import { LIFECYCLE } from "@/lib/labels";
import { today } from "@/lib/dates";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Empty, Field } from "@/components/ui";
import { FlowTable } from "@/components/FlowTable";
import { createFlowAction } from "@/app/actions";
import { loadFlowsWithHealth } from "../data";
import type { ClientHeader } from "../page";

export async function TabFluxos({ actor, client }: { actor: Actor; client: ClientHeader }) {
  const { flows, progress, flowHealth } = await loadFlowsWithHealth(actor, client.id);
  const manager = isManager(actor);
  const [templates, users, services, deliverables, plans] = manager
    ? await Promise.all([
        templatesList(), usersList(),
        sql<{ id: string; name: string }[]>`SELECT id, name FROM services WHERE client_id = ${client.id} AND status = 'ativo' ORDER BY name`,
        sql<{ id: string; name: string }[]>`SELECT id, name FROM deliverables WHERE client_id = ${client.id} AND status = 'ativo' ORDER BY name`,
        sql<{ id: string; label: string }[]>`SELECT id, label FROM quarterly_plans WHERE client_id = ${client.id} AND status <> 'encerrado' ORDER BY start_date DESC`,
      ])
    : [[], [], [], [], []];
  return (
    <div className={manager ? "grid g-side" : "stack"}>
      <Card title="Todos os fluxos, ciclos e projetos" hint="Cada instância preserva progresso e histórico próprios. Ciclos novos não alteram ciclos anteriores." tight>
        {flows.length ? <FlowTable flows={flows} progress={progress} health={flowHealth} showHours /> : <Empty title="Nenhum fluxo cadastrado" />}
      </Card>
      {manager ? (
        <Card title="Novo fluxo / ciclo / projeto" hint="A partir de um modelo da biblioteca (tarefas, horas e prazos relativos) ou em branco.">
          <ActionForm action={createFlowAction} className="stack">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Nome"><input name="name" required placeholder="Ex.: Ciclo de captação — 19/10" /></Field>
            <div className="form-grid">
              <Field label="Tipo de execução"><select name="lifecycle" defaultValue="ciclico">{Object.entries(LIFECYCLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Modelo (opcional)"><select name="templateId" defaultValue=""><option value="">Em branco</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.steps} etapas{t.missing ? `, ${t.missing} sem horas` : ""})</option>)}</select></Field>
              <Field label="Data de referência" help="Ex.: data da captação. Prazos do modelo são relativos a ela."><input type="date" name="referenceDate" defaultValue={today()} /></Field>
              <Field label="Rótulo do ciclo"><input name="cycleLabel" placeholder="Ex.: 19/10/2026 ou Outubro/2026" /></Field>
              <Field label="Início"><input type="date" name="startDate" /></Field>
              <Field label="Prazo final"><input type="date" name="dueDate" /></Field>
              <Field label="Responsável pelo fluxo"><select name="ownerId" defaultValue={actor.id}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="Responsável padrão das tarefas"><select name="defaultAssigneeId" defaultValue=""><option value="">— atribuir depois</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="Serviço"><select name="serviceId" defaultValue=""><option value="">—</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Trimestre"><select name="planId" defaultValue=""><option value="">—</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
            </div>
            {deliverables.length ? (
              <Field label="Entregáveis que este fluxo executa" help="Um fluxo pode executar mais de um entregável.">
                <div className="row">{deliverables.map((d) => <label key={d.id} className="check"><input type="checkbox" name="deliverableIds" value={d.id} /> {d.name}</label>)}</div>
              </Field>
            ) : null}
            <Field label="Objetivo / critério de conclusão"><textarea name="objective" /></Field>
            <label className="check"><input type="checkbox" name="startNow" defaultChecked /> Iniciar execução agora (fixa a base planejada; mudanças posteriores exigem motivo)</label>
            <Submit>Criar fluxo</Submit>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
