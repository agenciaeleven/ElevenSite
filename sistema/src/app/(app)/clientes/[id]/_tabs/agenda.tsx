import Link from "next/link";
import type { Actor } from "@/lib/auth-core";
import { sql } from "@/lib/db";
import { listEvents } from "@/lib/services/agenda";
import { addDays, fmtDateTime, localToInstant, today } from "@/lib/dates";
import { EDITORIAL_STATE, EVENT_KIND, EVENT_STATUS } from "@/lib/labels";
import { Card, Empty } from "@/components/ui";
import type { ClientHeader } from "../page";

export async function TabAgenda({ actor, client }: { actor: Actor; client: ClientHeader }) {
  const events = await listEvents(actor, { from: localToInstant(addDays(today(), -30)), to: localToInstant(addDays(today(), 60)), clientId: client.id, includeCancelled: true });
  const contents = await sql<{ id: string; title: string; kind: string; editorial_state: string; flow_id: string | null; flow_name: string | null; edited_at: Date | null; published_at: Date | null; scheduled_for: Date | null }[]>`
    SELECT ca.id, ca.title, ca.kind, ca.editorial_state, ca.flow_id, f.name AS flow_name, ca.edited_at, ca.published_at, ca.scheduled_for
    FROM content_assets ca LEFT JOIN flow_instances f ON f.id = ca.flow_id WHERE ca.client_id = ${client.id} ORDER BY ca.created_at DESC`;
  return (
    <div className="grid g2">
      <Card title="Agenda do cliente (−30 a +60 dias)" hint="Mesmo evento exibido na agenda geral, do squad e no fluxo." tight actions={<Link className="btn sm" href={`/agenda?cliente=${client.id}`}>Abrir na agenda</Link>}>
        {events.length === 0 ? <Empty title="Nenhum evento" /> : (
          <ul className="list">{events.map((e) => (
            <li key={e.id}>
              <div className="row between">
                <Link href={`/agenda/${e.id}`}><b style={e.status === "cancelado" ? { textDecoration: "line-through" } : undefined}>{e.title}</b></Link>
                <span className="pill">{EVENT_STATUS[e.status]}</span>
              </div>
              <div className="small muted">{EVENT_KIND[e.kind]} · {fmtDateTime(e.starts_at)}{e.reschedule_count ? ` · remarcado ${e.reschedule_count}x` : ""}{e.flow_name ? ` · ${e.flow_name}` : ""}{e.participants.length ? ` · ${e.participants.map((p) => p.name).join(", ")}` : ""}</div>
              {e.cancel_reason ? <div className="small" style={{ color: "var(--crit)" }}>Cancelado: {e.cancel_reason}</div> : null}
            </li>
          ))}</ul>
        )}
      </Card>
      <Card title="Conteúdos individuais" hint="Estado editorial separado do status das tarefas: editado ≠ publicado." tight>
        {contents.length === 0 ? <Empty title="Nenhum conteúdo cadastrado">Crie conteúdos dentro de um ciclo de produção.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Conteúdo</th><th>Estado</th><th>Editado em</th><th>Publicado em</th></tr></thead>
            <tbody>{contents.map((c) => (
              <tr key={c.id}>
                <td><b>{c.title}</b><div className="small muted">{c.flow_name ? <Link href={`/fluxos/${c.flow_id}`}>{c.flow_name}</Link> : "sem ciclo"}</div></td>
                <td><span className="pill">{EDITORIAL_STATE[c.editorial_state]}</span></td>
                <td className="small">{fmtDateTime(c.edited_at)}</td>
                <td className="small">{c.published_at ? fmtDateTime(c.published_at) : <span className="nodata">não publicado</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
