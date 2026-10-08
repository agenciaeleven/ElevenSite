import { requireActor } from "@/lib/session";
import { REQUIREMENTS, STATUS_LABEL, type ReqStatus } from "@/lib/requirements";
import { Card, Kpi } from "@/components/ui";

export const metadata = { title: "Backlog REQ-001–060" };

const CLS: Record<ReqStatus, string> = { testado: "b-normal", feito: "b-normal", parcial: "b-atencao", planejado: "b-neutral" };

export default async function BacklogPage() {
  await requireActor();
  const count = (s: ReqStatus) => REQUIREMENTS.filter((r) => r.status === s).length;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Backlog rastreável — REQ-001 a REQ-060</h1><p className="sub">Nenhum requisito foi descartado ao entregar o MVP. O mesmo registro está em <code>sistema/REQUISITOS_ELEVEN.md</code>.</p></div></div>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi label="Feito e testado" value={count("testado")} />
        <Kpi label="Feito" value={count("feito")} />
        <Kpi label="Parcial (base P0)" value={count("parcial")} />
        <Kpi label="Planejado" value={count("planejado")} />
      </div>
      <Card tight>
        <div className="table-wrap"><table>
          <thead><tr><th>ID</th><th>Requisito</th><th>Prioridade</th><th>Estado</th><th>Onde / entidades</th><th>Pendências</th></tr></thead>
          <tbody>{REQUIREMENTS.map((r) => (
            <tr key={r.id}>
              <td className="mono small"><b>{r.id}</b></td>
              <td>{r.text}</td>
              <td><span className="pill">{r.priority}</span></td>
              <td><span className={`badge ${CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>{r.tests ? <div className="small muted">{r.tests}</div> : null}</td>
              <td className="small">{r.where}</td>
              <td className="small muted">{r.pending ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
    </div>
  );
}
