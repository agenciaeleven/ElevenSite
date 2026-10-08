import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { templatesList } from "@/lib/queries";
import { LIFECYCLE } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Field } from "@/components/ui";
import { alertRuleAction, removeDemoAction, saveTemplateAction } from "../../actions";

export const metadata = { title: "Configurações" };

export default async function ConfigPage() {
  const actor = await requireActor();
  if (!isManager(actor)) redirect("/meu-dia");
  const templates = await templatesList();
  const rules = await sql<{ key: string; name: string; description: string | null; enabled: boolean; threshold: number | null }[]>`SELECT * FROM alert_rules ORDER BY name`;
  const [{ demo }] = await sql<{ demo: number }[]>`SELECT count(*)::int AS demo FROM clients WHERE is_demo AND deleted_at IS NULL`;
  const unit: Record<string, string> = { inatividade: "dias úteis", bloqueio: "dias", sobrecarga: "% da capacidade", sem_responsavel: "dias à frente", decisao_pendente: "dias", atraso: "—" };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Configurações</h1><p className="sub">Regras editáveis sem programação: biblioteca de fluxos (etapas, horas e prazos) e limites dos alertas.</p></div></div>
      <div className="stack">
        <Card title="Biblioteca de fluxos (modelos)" hint="Horas estimadas definem o peso do progresso ponderado. Etapas sem horas deixam o progresso “provisório”." tight>
          <div className="table-wrap"><table>
            <thead><tr><th>Modelo</th><th>Tipo</th><th className="num">Etapas</th><th className="num">Horas planejadas</th><th>Situação</th></tr></thead>
            <tbody>{templates.map((t) => (
              <tr key={t.id} className="click"><td><Link href={`/config/modelos/${t.id}`}><b>{t.name}</b></Link></td><td className="small">{LIFECYCLE[t.lifecycle]}</td><td className="num">{t.steps}</td><td className="num">{t.hours ?? 0}h</td>
                <td>{t.missing ? <span className="badge b-info">ⓘ {t.missing} etapa(s) sem horas</span> : <span className="badge b-normal">✓ completo</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <div className="card-b">
            <details className="panel"><summary>+ Novo modelo</summary>
              <ActionForm action={saveTemplateAction} className="form-grid">
                <Field label="Nome"><input name="name" required /></Field>
                <Field label="Tipo de execução"><select name="lifecycle">{Object.entries(LIFECYCLE).filter(([k]) => k !== "extra").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Descrição" full><textarea name="description" /></Field>
                <div><Submit>Criar e editar etapas</Submit></div>
              </ActionForm>
            </details>
          </div>
        </Card>

        <Card title="Regras de alerta" hint="Aplicadas a cada leitura (P0). Motor agendado com notificações é P1." id="regras" tight>
          <div className="table-wrap"><table>
            <thead><tr><th>Regra</th><th>Descrição</th><th>Limite</th><th /></tr></thead>
            <tbody>{rules.map((r) => (
              <tr key={r.key}>
                <td><b>{r.name}</b></td>
                <td className="small">{r.description}</td>
                <td colSpan={2}>
                  {actor.role === "admin" ? (
                    <ActionForm action={alertRuleAction} className="row">
                      <input type="hidden" name="key" value={r.key} />
                      <label className="check"><input type="checkbox" name="enabled" defaultChecked={r.enabled} /> ativa</label>
                      {r.threshold != null || ["inatividade", "bloqueio", "sobrecarga", "sem_responsavel", "decisao_pendente"].includes(r.key) ? <><input name="threshold" defaultValue={r.threshold ?? ""} style={{ width: 70 }} inputMode="decimal" /><span className="small muted">{unit[r.key] ?? ""}</span></> : null}
                      <Submit className="btn sm">Salvar</Submit>
                    </ActionForm>
                  ) : <span className="small">{r.enabled ? "ativa" : "desativada"}{r.threshold != null ? ` · ${r.threshold} ${unit[r.key] ?? ""}` : ""}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>

        {actor.role === "admin" ? (
          <Card title="Dados de demonstração">
            {demo ? (
              <>
                <p>Há {demo} cliente(s) de demonstração. Remova-os antes do uso real com clientes-piloto. Os usuários <code>@eleven.demo</code> serão desativados.</p>
                <p className="small" style={{ color: "var(--warn)", margin: "6px 0 10px" }}>Antes, crie seu usuário admin real (Pessoas → Novo usuário, perfil Direção) — se você estiver logado como direcao@eleven.demo, perderá o acesso.</p>
                <ActionForm action={removeDemoAction} className="row" confirm="Remover todos os dados de demonstração? Esta ação não pode ser desfeita.">
                  <input name="confirm" placeholder="Digite REMOVER" style={{ width: 180 }} required />
                  <Submit className="btn danger">Remover dados de demonstração</Submit>
                </ActionForm>
              </>
            ) : <p className="muted">Nenhum dado de demonstração ativo. Para recriar em um ambiente de testes: <code>npm run db:seed-demo</code>.</p>}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
