import Link from "next/link";
import { ActionForm, AutoSelect } from "./ActionForm";
import { StatusPill } from "./ui";
import { TASK_STATUS } from "@/lib/labels";
import { fmtDate, today } from "@/lib/dates";
import { quickAssignAction, taskStatusAction } from "@/app/actions";

export type TaskItem = {
  id: string; title: string; status: string; priority?: string; due_date: string | null; est_hours: number | null; assignee_id: string | null; assignee_name: string | null;
  stage?: string | null; parent_task_id?: string | null; in_baseline?: boolean; is_extra?: boolean; client_name?: string | null; flow_name?: string | null; flow_id?: string | null;
  waiting_until?: string | null; content_id?: string | null; blocker?: string | null;
};

const OPEN_OPTS: [string, string][] = ["a_fazer", "em_andamento", "em_revisao", "concluida"].map((k) => [k, TASK_STATUS[k]]);

export function InlineStatus({ t, canEdit }: { t: TaskItem; canEdit: boolean }) {
  if (!canEdit || ["concluida", "cancelada"].includes(t.status)) return <StatusPill status={t.status} />;
  const opts = t.status === "bloqueada" ? ([["bloqueada", "Bloqueada"], ...OPEN_OPTS] as [string, string][]) : OPEN_OPTS;
  return (
    <ActionForm action={taskStatusAction}>
      <input type="hidden" name="taskId" value={t.id} />
      <AutoSelect name="status" defaultValue={t.status} options={opts} ariaLabel={`Status de ${t.title}`} className={`inline pill st-${t.status}`} />
    </ActionForm>
  );
}

export function TaskList({ tasks, users, canManage, actorId, groupByStage, context }: { tasks: TaskItem[]; users?: { id: string; name: string }[]; canManage: boolean; actorId: string; groupByStage?: boolean; context?: "client" | "flow" | "person" }) {
  const ref = today();
  const roots = tasks.filter((t) => !t.parent_task_id || !tasks.some((p) => p.id === t.parent_task_id));
  const children = (id: string) => tasks.filter((t) => t.parent_task_id === id);
  let lastStage: string | null | undefined = undefined;
  const row = (t: TaskItem, sub = false) => {
    const late = t.due_date && t.due_date < ref && !["concluida", "cancelada"].includes(t.status) && !(t.waiting_until && t.waiting_until >= ref);
    const canEdit = canManage || t.assignee_id === actorId || !t.assignee_id;
    return (
      <div key={t.id} className={`task-row ${sub ? "sub-task" : ""}`}>
        <div className="title">
          <Link href={`/tarefas/${t.id}`}>{t.title}</Link>
          {t.is_extra ? <span className="badge b-neutral" style={{ marginLeft: 6 }} title="Demanda não planejada: conta como esforço, não altera o escopo vendido">extra</span> : null}
          {t.in_baseline === false && !t.is_extra ? <span className="badge b-neutral" style={{ marginLeft: 6 }}>fora da base</span> : null}
          {t.priority === "urgente" || t.priority === "alta" ? <span className="badge b-atencao" style={{ marginLeft: 6 }}>{t.priority}</span> : null}
          <div className="sub">
            {context !== "client" && t.client_name ? `${t.client_name} · ` : ""}
            {context !== "flow" && t.flow_name ? <><Link href={`/fluxos/${t.flow_id}`} className="muted">{t.flow_name}</Link> · </> : null}
            {t.est_hours != null ? `${t.est_hours}h est.` : <span title="Sem peso no progresso ponderado">sem estimativa</span>}
            {t.waiting_until && t.waiting_until >= ref ? ` · em espera até ${fmtDate(t.waiting_until)}` : ""}
            {t.blocker ? ` · ${t.blocker}` : ""}
          </div>
        </div>
        <div className="hide-sm small">
          {canManage && users && !["concluida", "cancelada"].includes(t.status) ? (
            <ActionForm action={quickAssignAction}>
              <input type="hidden" name="taskId" value={t.id} />
              <AutoSelect name="assignee_id" defaultValue={t.assignee_id ?? ""} options={[["", "— sem responsável"], ...users.map((u) => [u.id, u.name] as [string, string])]} ariaLabel="Responsável" />
            </ActionForm>
          ) : (t.assignee_name ?? <span className="nodata">sem responsável</span>)}
        </div>
        <div><InlineStatus t={t} canEdit={canEdit} /></div>
        <div className={`small mono hide-sm ${late ? "late" : ""}`} title={late ? "Prazo vencido" : undefined}>{late ? "▲ " : ""}{fmtDate(t.due_date)}</div>
        <div className="hide-sm"><Link href={`/tarefas/${t.id}`} className="btn sm ghost">Abrir</Link></div>
      </div>
    );
  };
  return (
    <div>
      {roots.map((t) => {
        const header = groupByStage && t.stage !== lastStage ? <div className="stage-h">{t.stage ?? "Sem etapa"}</div> : null;
        lastStage = t.stage;
        return (
          <div key={t.id}>
            {header}
            {row(t)}
            {children(t.id).map((c) => row(c, true))}
          </div>
        );
      })}
    </div>
  );
}
