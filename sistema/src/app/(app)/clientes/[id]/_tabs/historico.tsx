import Link from "next/link";
import { clientHistory } from "@/lib/queries";
import { fmtDateTime } from "@/lib/dates";
import { Card, Empty } from "@/components/ui";
import type { ClientHeader } from "../page";

export async function TabHistorico({ client }: { client: ClientHeader }) {
  const rows = await clientHistory(client.id, 150);
  return (
    <Card title="Cronologia auditável" hint="Quem fez, quando ocorreu, quando foi registrado e por quê. Registros retrospectivos aparecem sinalizados." tight>
      {rows.length === 0 ? <Empty title="Sem eventos registrados" /> : (
        <ul className="timeline">
          {rows.map((e) => {
            const retro = Math.abs(e.recorded_at.getTime() - e.occurred_at.getTime()) > 3 * 3600000;
            return (
              <li key={e.id}>
                <span className="when">{fmtDateTime(e.occurred_at)}</span>
                <div>
                  <b>{e.actor_name ?? "Sistema"}</b> — {e.summary}
                  {e.task_id ? <> · <Link href={`/tarefas/${e.task_id}`}>tarefa</Link></> : e.flow_id ? <> · <Link href={`/fluxos/${e.flow_id}`}>fluxo</Link></> : null}
                  {e.reason ? <div className="why">Motivo: {e.reason}</div> : null}
                  {retro ? <div className="retro">Registrado em {fmtDateTime(e.recorded_at)} (retrospectivo)</div> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
