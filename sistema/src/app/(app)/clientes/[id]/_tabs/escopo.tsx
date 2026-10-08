import type { Actor } from "@/lib/auth-core";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { squadsList, usersList } from "@/lib/queries";
import { CLIENT_STATUS, PERIODICITY, SERVICE_KIND } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Empty, Field } from "@/components/ui";
import { acceptHandoffAction, archiveClientAction, saveContractAction, saveDeliverableAction, saveServiceAction, updateClientAction } from "@/app/actions";
import type { ClientHeader } from "../page";

export async function TabEscopo({ actor, client }: { actor: Actor; client: ClientHeader }) {
  const admin = actor.role === "admin";
  const manager = isManager(actor);
  const contracts = await sql<{ id: string; title: string; status: string; start_date: string | null; end_date: string | null; version: number; owner_name: string | null; owner_id: string | null; handoff_notes: string | null; handoff_accepted_at: Date | null; accepter: string | null; monthly_value: number | null }[]>`
    SELECT c.*, u.name AS owner_name, a.name AS accepter FROM contracts c LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN users a ON a.id = c.handoff_accepted_by WHERE c.client_id = ${client.id} ORDER BY c.created_at DESC`;
  const services = await sql<{ id: string; name: string; kind: string; status: string; start_date: string | null; end_date: string | null; contract_id: string | null }[]>`SELECT * FROM services WHERE client_id = ${client.id} ORDER BY status, name`;
  const deliverables = await sql<{ id: string; name: string; quantity: number | null; unit: string | null; periodicity: string; acceptance_criteria: string | null; reference_hours: number | null; start_date: string | null; end_date: string | null; status: string; service_id: string | null; service_name: string | null }[]>`
    SELECT d.*, s.name AS service_name FROM deliverables d LEFT JOIN services s ON s.id = d.service_id WHERE d.client_id = ${client.id} ORDER BY d.status, s.name, d.name`;
  const [users, squads] = manager ? await Promise.all([usersList(), squadsList()]) : [[], []];
  const scopeHistory = await sql<{ id: number; occurred_at: Date; summary: string; reason: string | null; actor: string | null }[]>`
    SELECT oe.id, oe.occurred_at, oe.summary, oe.reason, u.name AS actor FROM operational_events oe LEFT JOIN users u ON u.id = oe.actor_id
    WHERE oe.client_id = ${client.id} AND oe.action IN ('registrou_escopo','alterou_escopo','aceitou_handoff') ORDER BY oe.occurred_at DESC LIMIT 20`;

  return (
    <div className="stack">
      <div className="callout info">Escopo comercial = o que foi efetivamente vendido (quantidade, periodicidade, vigência, critério de aceite). É transversal à Bússola e ao trimestre: uma oportunidade estratégica não prova que algo foi vendido. {admin ? "" : "Somente a direção altera o escopo."}</div>

      <Card title="Contrato e passagem de bastão" tight>
        {contracts.length === 0 ? <Empty title="Nenhum contrato registrado" /> : (
          <ul className="list">{contracts.map((c) => (
            <li key={c.id}>
              <div className="row between top">
                <div>
                  <b>{c.title}</b> <span className="pill">{c.status}</span> <span className="small muted">versão {c.version}</span>
                  <div className="small muted">Vigência {fmtDate(c.start_date, { year: true })} → {c.end_date ? fmtDate(c.end_date, { year: true }) : "indeterminada"} · dono: {c.owner_name ?? "—"}{admin && c.monthly_value != null ? ` · valor mensal R$ ${c.monthly_value.toLocaleString("pt-BR")}` : ""}</div>
                  {c.handoff_notes ? <div className="small">Handoff: {c.handoff_notes}</div> : null}
                  <div className="small">{c.handoff_accepted_at ? <span className="badge b-normal">✓ Passagem de bastão aceita por {c.accepter} em {fmtDateTime(c.handoff_accepted_at)}</span> : <span className="badge b-atencao">Passagem de bastão aguardando aceite da operação</span>}</div>
                </div>
                <div className="row">
                  {manager && !c.handoff_accepted_at ? (
                    <ActionForm action={acceptHandoffAction}><input type="hidden" name="contractId" value={c.id} /><Submit className="btn sm ok">Aceitar passagem</Submit></ActionForm>
                  ) : null}
                  {admin ? (
                    <details className="disclose"><summary className="btn sm">Editar</summary>
                      <ContractForm clientId={client.id} c={c} users={users} />
                    </details>
                  ) : null}
                </div>
              </div>
            </li>
          ))}</ul>
        )}
        {admin ? <div className="card-b"><details className="panel" open={contracts.length === 0}><summary>+ Registrar contrato / escopo</summary><ContractForm clientId={client.id} users={users} /></details></div> : null}
      </Card>

      <Card title="Serviços ativos" hint="Compromissos mantidos durante a vigência; podem ter rotinas e vários projetos simultâneos." tight>
        {services.length === 0 ? <Empty title="Nenhum serviço" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Serviço</th><th>Tipo</th><th>Situação</th><th>Vigência</th>{admin ? <th /> : null}</tr></thead>
            <tbody>{services.map((s) => (
              <tr key={s.id}>
                <td><b>{s.name}</b></td><td className="small">{SERVICE_KIND[s.kind]}</td><td><span className="pill">{s.status}</span></td>
                <td className="small">{fmtDate(s.start_date, { year: true })} → {s.end_date ? fmtDate(s.end_date, { year: true }) : "—"}</td>
                {admin ? <td><details className="disclose"><summary className="btn sm ghost">Editar</summary><ServiceForm clientId={client.id} s={s} contracts={contracts} /></details></td> : null}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {admin ? <div className="card-b"><details className="panel"><summary>+ Novo serviço</summary><ServiceForm clientId={client.id} contracts={contracts} /></details></div> : null}
      </Card>

      <Card title="Entregáveis contratados" hint="Quantidade, periodicidade, vigência e critério de aceite. Horas de referência opcionais." tight>
        {deliverables.length === 0 ? <Empty title="Nenhum entregável" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Entregável</th><th>Serviço</th><th>Volume</th><th>Critério de aceite</th><th className="num">Horas ref.</th><th>Situação</th>{admin ? <th /> : null}</tr></thead>
            <tbody>{deliverables.map((d) => (
              <tr key={d.id}>
                <td><b>{d.name}</b><div className="small muted">{fmtDate(d.start_date, { year: true })} → {d.end_date ? fmtDate(d.end_date, { year: true }) : "—"}</div></td>
                <td className="small">{d.service_name ?? "—"}</td>
                <td className="small">{d.quantity != null ? `${d.quantity} ${d.unit ?? ""}` : "—"} · {PERIODICITY[d.periodicity]}</td>
                <td className="small">{d.acceptance_criteria ?? <span className="nodata">não definido</span>}</td>
                <td className="num">{d.reference_hours ?? "—"}</td>
                <td><span className="pill">{d.status}</span></td>
                {admin ? <td><details className="disclose"><summary className="btn sm ghost">Editar</summary><DeliverableForm clientId={client.id} d={d} services={services} contracts={contracts} /></details></td> : null}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {admin ? <div className="card-b"><details className="panel" open={deliverables.length === 0 && services.length > 0}><summary>+ Novo entregável</summary><DeliverableForm clientId={client.id} services={services} contracts={contracts} /></details></div> : null}
      </Card>

      {manager ? (
        <div className="grid g2">
          <Card title="Dados do cliente">
            <ActionForm action={updateClientAction} className="stack">
              <input type="hidden" name="clientId" value={client.id} />
              <Field label="Nome"><input name="name" defaultValue={client.name} required /></Field>
              <div className="form-grid">
                <Field label="Situação"><select name="status" defaultValue={client.status}>{Object.entries(CLIENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Segmento"><input name="segment" defaultValue={client.segment ?? ""} /></Field>
                <Field label="Contato"><input name="contactName" defaultValue={client.contact_name ?? ""} /></Field>
                <Field label="E-mail"><input name="contactEmail" defaultValue={client.contact_email ?? ""} /></Field>
              </div>
              <Field label="Responsável pela conta"><select name="accountOwnerId" defaultValue={client.account_owner_id ?? ""}><option value="">—</option>{users.filter((u) => u.role !== "colaborador").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              {admin ? <Field label="Squads"><div className="row">{squads.map((s) => <label key={s.id} className="check"><input type="checkbox" name="squadIds" value={s.id} defaultChecked={client.squads.some((x) => x.id === s.id)} /> {s.name}</label>)}</div></Field> : null}
              <Field label="Notas internas" help="Nunca aparecem em relatórios para o cliente."><textarea name="internalNotes" defaultValue={client.internal_notes ?? ""} /></Field>
              <Submit>Salvar dados</Submit>
            </ActionForm>
            {admin ? (
              <details className="panel" style={{ marginTop: 12 }}><summary>Arquivar cliente</summary>
                <ActionForm action={archiveClientAction} className="stack" confirm="Arquivar este cliente? Ele sai das listas, mas o histórico é preservado.">
                  <input type="hidden" name="clientId" value={client.id} />
                  <input name="reason" placeholder="Motivo" required />
                  <Submit className="btn danger">Arquivar</Submit>
                </ActionForm>
              </details>
            ) : null}
          </Card>
          <Card title="Histórico de escopo" tight>
            {scopeHistory.length === 0 ? <Empty title="Sem alterações registradas" /> : (
              <ul className="timeline">{scopeHistory.map((e) => (
                <li key={e.id}><span className="when">{fmtDateTime(e.occurred_at)}</span><div><b>{e.actor}</b> — {e.summary}{e.reason ? <div className="why">Motivo: {e.reason}</div> : null}</div></li>
              ))}</ul>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function ContractForm({ clientId, c, users }: { clientId: string; c?: { id: string; title: string; status: string; start_date: string | null; end_date: string | null; owner_id: string | null; handoff_notes: string | null; monthly_value: number | null }; users: { id: string; name: string; role: string }[] }) {
  return (
    <ActionForm action={saveContractAction} className="form-grid" reset={!c}>
      <input type="hidden" name="clientId" value={clientId} />
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <Field label="Título"><input name="title" defaultValue={c?.title} required /></Field>
      <Field label="Situação"><select name="status" defaultValue={c?.status ?? "vigente"}><option value="rascunho">Rascunho</option><option value="vigente">Vigente</option><option value="encerrado">Encerrado</option></select></Field>
      <Field label="Início"><input type="date" name="startDate" defaultValue={c?.start_date ?? ""} /></Field>
      <Field label="Fim"><input type="date" name="endDate" defaultValue={c?.end_date ?? ""} /></Field>
      <Field label="Dono do contrato"><select name="ownerId" defaultValue={c?.owner_id ?? ""}><option value="">—</option>{users.filter((u) => u.role !== "colaborador").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      <Field label="Valor mensal (R$)" help="Visível só para a direção"><input name="monthlyValue" inputMode="decimal" defaultValue={c?.monthly_value ?? ""} /></Field>
      <Field label="Notas de passagem de bastão (comercial → operação)" full><textarea name="handoffNotes" defaultValue={c?.handoff_notes ?? ""} /></Field>
      {c ? <Field label="Motivo da alteração" full><input name="reason" placeholder="Registrado no histórico de escopo" /></Field> : null}
      <div><Submit>{c ? "Salvar nova versão" : "Registrar contrato"}</Submit></div>
    </ActionForm>
  );
}

function ServiceForm({ clientId, s, contracts }: { clientId: string; s?: { id: string; name: string; kind: string; status: string; start_date: string | null; end_date: string | null; contract_id: string | null }; contracts: { id: string; title: string }[] }) {
  return (
    <ActionForm action={saveServiceAction} className="form-grid" reset={!s}>
      <input type="hidden" name="clientId" value={clientId} />
      {s ? <input type="hidden" name="id" value={s.id} /> : null}
      <Field label="Nome"><input name="name" defaultValue={s?.name} required /></Field>
      <Field label="Tipo"><select name="kind" defaultValue={s?.kind ?? "conteudo"}>{Object.entries(SERVICE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Situação"><select name="status" defaultValue={s?.status ?? "ativo"}><option value="ativo">Ativo</option><option value="pausado">Pausado</option><option value="encerrado">Encerrado</option></select></Field>
      <Field label="Contrato"><select name="contractId" defaultValue={s?.contract_id ?? contracts[0]?.id ?? ""}><option value="">—</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
      <Field label="Início"><input type="date" name="startDate" defaultValue={s?.start_date ?? ""} /></Field>
      <Field label="Fim"><input type="date" name="endDate" defaultValue={s?.end_date ?? ""} /></Field>
      <div><Submit>Salvar serviço</Submit></div>
    </ActionForm>
  );
}

function DeliverableForm({ clientId, d, services, contracts }: { clientId: string; d?: { id: string; name: string; quantity: number | null; unit: string | null; periodicity: string; acceptance_criteria: string | null; reference_hours: number | null; start_date: string | null; end_date: string | null; status: string; service_id: string | null }; services: { id: string; name: string }[]; contracts: { id: string; title: string }[] }) {
  return (
    <ActionForm action={saveDeliverableAction} className="form-grid" reset={!d}>
      <input type="hidden" name="clientId" value={clientId} />
      {d ? <input type="hidden" name="id" value={d.id} /> : null}
      <input type="hidden" name="contractId" value={contracts[0]?.id ?? ""} />
      <Field label="Entregável"><input name="name" defaultValue={d?.name} required /></Field>
      <Field label="Serviço"><select name="serviceId" defaultValue={d?.service_id ?? ""}><option value="">—</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Quantidade"><input name="quantity" inputMode="decimal" defaultValue={d?.quantity ?? ""} /></Field>
      <Field label="Unidade"><input name="unit" defaultValue={d?.unit ?? ""} placeholder="vídeos, relatórios…" /></Field>
      <Field label="Periodicidade"><select name="periodicity" defaultValue={d?.periodicity ?? "mensal"}>{Object.entries(PERIODICITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Horas de referência"><input name="referenceHours" inputMode="decimal" defaultValue={d?.reference_hours ?? ""} /></Field>
      <Field label="Início"><input type="date" name="startDate" defaultValue={d?.start_date ?? ""} /></Field>
      <Field label="Fim"><input type="date" name="endDate" defaultValue={d?.end_date ?? ""} /></Field>
      <Field label="Situação"><select name="status" defaultValue={d?.status ?? "ativo"}><option value="ativo">Ativo</option><option value="pausado">Pausado</option><option value="concluido">Concluído</option><option value="encerrado">Encerrado</option></select></Field>
      <Field label="Critério de aceite" full><input name="acceptanceCriteria" defaultValue={d?.acceptance_criteria ?? ""} /></Field>
      {d ? <Field label="Motivo da alteração" full><input name="reason" /></Field> : null}
      <div><Submit>Salvar entregável</Submit></div>
    </ActionForm>
  );
}
