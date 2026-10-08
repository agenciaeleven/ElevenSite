import Link from "next/link";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { clientScope, scopeIds } from "@/lib/access";
import { squadsList, usersList } from "@/lib/queries";
import { CLIENT_STATUS } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Demo, Empty, Field } from "@/components/ui";
import { createClientAction } from "../../actions";

export const metadata = { title: "Clientes" };

export default async function ClientsPage() {
  const actor = await requireActor();
  const ids = scopeIds(await clientScope(actor));
  const rows = await sql<{ id: string; name: string; status: string; segment: string | null; is_demo: boolean; is_internal: boolean; squads: string | null; services: string | null; flows: number; open_tasks: number; created_at: Date }[]>`
    SELECT c.id, c.name, c.status, c.segment, c.is_demo, c.is_internal, c.created_at,
      (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM client_squads cs JOIN squads s ON s.id = cs.squad_id WHERE cs.client_id = c.id) AS squads,
      (SELECT string_agg(sv.name, ' · ' ORDER BY sv.name) FROM services sv WHERE sv.client_id = c.id AND sv.status = 'ativo') AS services,
      (SELECT count(*)::int FROM flow_instances f WHERE f.client_id = c.id AND f.status IN ('ativo','planejado','em_espera')) AS flows,
      (SELECT count(*)::int FROM tasks t WHERE t.client_id = c.id AND t.deleted_at IS NULL AND t.status NOT IN ('concluida','cancelada')) AS open_tasks
    FROM clients c WHERE c.deleted_at IS NULL AND (${ids}::uuid[] IS NULL OR c.id = ANY(${ids}::uuid[]))
    ORDER BY c.is_internal, c.status = 'encerrado', c.name`;
  const [squads, users] = actor.role === "admin" ? await Promise.all([squadsList(), usersList()]) : [[], []];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <p className="sub">{actor.role === "admin" ? "Toda a agência." : "Clientes dos seus squads e onde você tem tarefas."}</p>
        </div>
      </div>
      <div className={actor.role === "admin" ? "grid g-side" : ""}>
        <Card tight>
          {rows.length === 0 ? <Empty title="Nenhum cliente visível">Peça à direção para vincular você a um squad.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Cliente</th><th>Situação</th><th>Squads</th><th>Serviços ativos</th><th className="num">Fluxos</th><th className="num">Tarefas abertas</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="click">
                      <td><Link href={`/clientes/${c.id}`}><b>{c.name}</b></Link> <Demo on={c.is_demo} />{c.is_internal ? <span className="badge b-neutral">Interno</span> : null}
                        <div className="small muted">{c.segment ?? ""} · desde {fmtDate(c.created_at.toISOString(), { year: true })}</div></td>
                      <td><span className="pill">{CLIENT_STATUS[c.status]}</span></td>
                      <td className="small">{c.squads ?? <span className="nodata">sem squad</span>}</td>
                      <td className="small">{c.services ?? <span className="nodata">nenhum serviço registrado</span>}</td>
                      <td className="num">{c.flows}</td>
                      <td className="num">{c.open_tasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {actor.role === "admin" ? (
          <Card title="Cadastrar cliente" hint="Depois do cadastro, registre o escopo vendido (contrato, serviços e entregáveis).">
            <ActionForm action={createClientAction} className="stack">
              <Field label="Nome"><input name="name" required /></Field>
              <div className="form-grid">
                <Field label="Situação"><select name="status" defaultValue="onboarding">{Object.entries(CLIENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Segmento"><input name="segment" /></Field>
                <Field label="Contato"><input name="contactName" /></Field>
                <Field label="E-mail do contato"><input name="contactEmail" type="email" /></Field>
              </div>
              <Field label="Responsável pela conta"><select name="accountOwnerId"><option value="">—</option>{users.filter((u) => u.role !== "colaborador").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="Squads" help="Um cliente pode ser atendido por mais de um squad.">
                <div className="row">{squads.map((s) => <label key={s.id} className="check"><input type="checkbox" name="squadIds" value={s.id} /> {s.name}</label>)}</div>
              </Field>
              <Field label="Notas internas" help="Nunca aparecem em relatórios para o cliente."><textarea name="internalNotes" /></Field>
              <Submit>Cadastrar cliente</Submit>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
