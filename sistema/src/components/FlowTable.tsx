import Link from "next/link";
import type { Progress } from "@/lib/progress";
import { FLOW_STATUS, LIFECYCLE_SHORT, type Severity } from "@/lib/labels";
import { dateOfInstant, fmtDate } from "@/lib/dates";
import { Demo, Health, Hours, ProgressBar } from "./ui";

export type FlowRowData = {
  id: string; name: string; lifecycle: string; status: string; cycle_label: string | null; start_date: string | null; due_date: string | null;
  owner_name: string | null; service_name?: string | null; deliverables?: { id: string; name: string }[]; last_move: Date | null; is_demo?: boolean; wait_reason?: string | null; open_tasks?: number;
};

export function FlowTable({ flows, progress, health, showHours }: { flows: FlowRowData[]; progress: Map<string, Progress & { actualHours: number | null }>; health: (id: string, status: string) => { level: Severity; reasons: string[] }; showHours?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Fluxo / projeto</th><th>Tipo</th><th style={{ minWidth: 190 }}>Progresso da instância</th><th>Responsável</th><th>Período</th><th>Últ. movimentação</th><th>Saúde</th>{showHours ? <th className="num">Horas est. / apont.</th> : null}</tr>
        </thead>
        <tbody>
          {flows.map((f) => {
            const p = progress.get(f.id)!;
            const h = health(f.id, f.status);
            return (
              <tr key={f.id} className="click">
                <td>
                  <Link href={`/fluxos/${f.id}`}><b>{f.name}</b></Link> <Demo on={f.is_demo} />
                  {f.status !== "ativo" ? <span className="pill" style={{ marginLeft: 6 }}>{FLOW_STATUS[f.status]}</span> : null}
                  <div className="small muted">
                    {f.service_name ? `${f.service_name}` : "Sem serviço vinculado"}
                    {f.deliverables?.length ? ` · entrega: ${f.deliverables.map((d) => d.name).join(", ")}` : ""}
                    {f.wait_reason ? ` · espera: ${f.wait_reason}` : ""}
                  </div>
                </td>
                <td className="small">{LIFECYCLE_SHORT[f.lifecycle]}{f.cycle_label ? <div className="muted">{f.cycle_label}</div> : null}</td>
                <td><ProgressBar p={p} /></td>
                <td className="small">{f.owner_name ?? <span className="nodata">—</span>}</td>
                <td className="small mono">{fmtDate(f.start_date)} → {fmtDate(f.due_date)}</td>
                <td className="small">{f.last_move ? fmtDate(dateOfInstant(f.last_move)) : <span className="nodata">sem registro</span>}</td>
                <td><Health level={h.level} title={h.reasons.join(" • ")} /></td>
                {showHours ? <td className="num small">{p.estHoursTotal ? `${p.estHoursTotal}h` : <span className="nodata">sem estimativa</span>} / <Hours v={p.actualHours} /></td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
