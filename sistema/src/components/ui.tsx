import Link from "next/link";
import type { ReactNode } from "react";
import { displayProgress, type Progress } from "@/lib/progress";
import { SEVERITY, SEVERITY_ICON, TASK_STATUS, type Severity } from "@/lib/labels";

export function ProgressBar({ p, size, showLabel = true }: { p: Progress; size?: "lg"; showLabel?: boolean }) {
  const d = displayProgress(p);
  if (d.value == null) return <span className="nodata" title="Sem tarefas planejadas">Sem dados suficientes</span>;
  return (
    <div className={`progress ${size ?? ""}`} title={d.label}>
      <div className="bar" role="progressbar" aria-valuenow={d.value} aria-valuemin={0} aria-valuemax={100} aria-label={d.label}>
        <div className={`fill ${d.provisional ? "prov" : ""}`} style={{ width: `${Math.min(100, d.value)}%` }} />
        {d.expected != null ? <div className="mark" style={{ left: `calc(${Math.min(100, d.expected)}% - 1px)` }} title={`Esperado para a data: ${d.expected}%`} /> : null}
      </div>
      {showLabel ? (
        <div className="meta">
          <span><b>{d.value}%</b>{d.provisional ? " provisório" : ""}</span>
          <span>{d.expected != null ? `esperado ${d.expected}%` : "sem cronograma"}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ProgressNote({ p }: { p: Progress }) {
  if (p.state === "sem_tarefas") return <p className="small muted">Nenhuma tarefa na base planejada.</p>;
  if (p.state === "sem_estimativa")
    return <p className="small" style={{ color: "var(--warn)" }}>ⓘ Progresso ponderado indisponível: {p.missingEstimates} tarefa(s) sem horas estimadas. Barra hachurada = provisório por contagem ({p.doneCount}/{p.baselineCount}).</p>;
  return <p className="small muted">Ponderado por horas estimadas: {p.estHoursDone}h de {p.estHoursTotal}h planejadas concluídas ({p.doneCount}/{p.baselineCount} tarefas). Marca preta = esperado pelos prazos até hoje.</p>;
}

export function Health({ level, title }: { level: Severity; title?: string }) {
  return <span className={`badge b-${level}`} title={title}>{SEVERITY_ICON[level]} {SEVERITY[level]}</span>;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill st-${status}`}>{TASK_STATUS[status] ?? status}</span>;
}

export function Demo({ on }: { on: boolean | null | undefined }) {
  return on ? <span className="badge b-demo" title="Dado de demonstração — fictício">Demo</span> : null;
}

export function Card({ title, hint, actions, children, tight, id }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; tight?: boolean; id?: string }) {
  return (
    <section className="card" id={id}>
      {title || actions ? (
        <div className="card-h">
          <div>
            <h2>{title}</h2>
            {hint ? <div className="hint">{hint}</div> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      <div className={`card-b ${tight ? "tight" : ""}`}>{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Kpi({ label, value, foot, href }: { label: string; value: ReactNode; foot?: ReactNode; href?: string }) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </>
  );
  return <div className="card kpi">{href ? <Link href={href}>{body}</Link> : body}</div>;
}

export function Tabs({ items, current }: { items: { key: string; label: ReactNode; href: string }[]; current: string }) {
  return (
    <nav className="tabs">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className={i.key === current ? "on" : ""}>{i.label}</Link>
      ))}
    </nav>
  );
}

export function Field({ label, help, children, full }: { label: string; help?: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label>{label}</label>
      {children}
      {help ? <span className="help">{help}</span> : null}
    </div>
  );
}

export function Hours({ v, none = "sem apontamento" }: { v: number | null | undefined; none?: string }) {
  return v == null ? <span className="nodata">{none}</span> : <span className="mono">{Number(v).toLocaleString("pt-BR")}h</span>;
}
