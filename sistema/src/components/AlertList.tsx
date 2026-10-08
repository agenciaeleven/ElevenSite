import Link from "next/link";
import type { Actor } from "@/lib/auth-core";
import type { Alert } from "@/lib/services/alerts";
import { isManager } from "@/lib/access";
import { fmtDate } from "@/lib/dates";
import { ActionForm, Submit } from "./ActionForm";
import { Demo, Empty, Health } from "./ui";
import { ackAlertAction, requestJustificationAction, unackAlertAction } from "@/app/actions";

export function AlertList({ alerts, actor, compact }: { alerts: Alert[]; actor: Actor; compact?: boolean }) {
  if (!alerts.length) return <Empty title="Nenhuma pendência pelas regras atuais">Regras configuráveis em Configurações → Regras de alerta.</Empty>;
  const manager = isManager(actor);
  return (
    <div>
      {alerts.map((a) => (
        <div key={a.key} className="alert-item">
          <Health level={a.severity} />
          <div>
            <div className="t"><Link href={a.href}>{a.title}</Link> <Demo on={a.isDemo} /></div>
            <div className="d">{a.detail}</div>
            <div className="m">
              {a.clientName ? <>{a.clientId ? <Link href={`/clientes/${a.clientId}?aba=visao&lente=saude`}>{a.clientName}</Link> : a.clientName}</> : "Interno"}
              {a.flowName ? <> · <Link href={`/fluxos/${a.flowId}`}>{a.flowName}</Link></> : null}
              {a.ownerName ? ` · responsável: ${a.ownerName}` : ""}
              {a.since ? ` · desde ${fmtDate(a.since)}` : ""}
            </div>
            {a.justification ? <div className="just"><b>Justificativa registrada:</b> {a.justification}</div> : null}
            {a.acked ? <div className="just"><b>Reconhecido pelo líder:</b> {a.acked.note}{a.acked.snooze_until ? ` (adiado até ${fmtDate(a.acked.snooze_until)})` : ""}</div> : null}
          </div>
          {manager && !compact ? (
            <div className="row no-print" style={{ justifyContent: "flex-end" }}>
              {a.taskId && a.ownerId && a.rule !== "sobrecarga" && a.rule !== "justificativa_pendente" ? (
                <details className="disclose">
                  <summary className="btn sm">Perguntar motivo</summary>
                  <ActionForm action={requestJustificationAction} className="stack" style={{ minWidth: 260 }}>
                    <input type="hidden" name="taskId" value={a.taskId} />
                    <textarea name="question" placeholder="Pergunta ao responsável (opcional)" />
                    <Submit className="btn sm primary">Enviar ao Meu Dia de {a.ownerName}</Submit>
                  </ActionForm>
                </details>
              ) : null}
              {a.acked ? (
                <ActionForm action={unackAlertAction}><input type="hidden" name="key" value={a.key} /><Submit className="btn sm ghost">Reativar</Submit></ActionForm>
              ) : (
                <details className="disclose">
                  <summary className="btn sm ghost">Reconhecer</summary>
                  <ActionForm action={ackAlertAction} className="stack" style={{ minWidth: 260 }}>
                    <input type="hidden" name="key" value={a.key} />
                    <textarea name="note" placeholder="Decisão/observação do líder (obrigatório)" required />
                    <label className="small">Adiar até (opcional)<input type="date" name="snooze" /></label>
                    <Submit className="btn sm primary">Registrar</Submit>
                  </ActionForm>
                </details>
              )}
              <Link className="btn sm" href={a.href}>Abrir</Link>
            </div>
          ) : (
            <Link className="btn sm no-print" href={a.href}>Abrir</Link>
          )}
        </div>
      ))}
    </div>
  );
}
