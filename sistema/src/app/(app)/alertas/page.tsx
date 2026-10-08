import Link from "next/link";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { computeAlerts } from "@/lib/services/alerts";
import { squadsList, usersList, visibleClients } from "@/lib/queries";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { INTERVENTION_KIND } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AlertList } from "@/components/AlertList";
import { Card, Empty, Field, Kpi } from "@/components/ui";
import { interventionAction, resolveInterventionAction } from "../../actions";

export const metadata = { title: "Saúde e alertas" };

const RULES: Record<string, string> = {
  atraso: "Prazo vencido", bloqueio: "Bloqueios", inatividade: "Sem movimentação", sem_responsavel: "Sem responsável", sem_estimativa: "Sem estimativa",
  sobrecarga: "Sobrecarga", justificativa_pendente: "Motivo pendente", decisao_pendente: "Decisões",
};

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const manager = isManager(actor);
  const userId = manager ? sp.pessoa || null : actor.id;
  const all = await computeAlerts(actor, { squadId: sp.squad || null, clientId: sp.cliente || null, userId, includeAcked: sp.reconhecidos === "1" });
  const alerts = sp.regra ? all.filter((a) => a.rule === sp.regra) : all;
  const [squads, users, clients] = manager ? await Promise.all([squadsList(), usersList(), visibleClients(actor)]) : [[], [], []];
  const open = manager
    ? await sql<{ id: string; kind: string; text: string; author: string; responsible: string | null; subject: string | null; due_date: string | null; created_at: Date; task_id: string | null; task_title: string | null; client_name: string | null }[]>`
        SELECT mi.id, mi.kind, mi.text, a.name AS author, r.name AS responsible, s.name AS subject, mi.due_date, mi.created_at, mi.task_id, t.title AS task_title, c.name AS client_name
        FROM manager_interventions mi JOIN users a ON a.id = mi.author_id LEFT JOIN users r ON r.id = mi.responsible_id LEFT JOIN users s ON s.id = mi.subject_user_id
        LEFT JOIN tasks t ON t.id = mi.task_id LEFT JOIN clients c ON c.id = mi.client_id
        WHERE mi.resolved_at IS NULL AND (${actor.role === "admin"} OR mi.author_id = ${actor.id} OR mi.responsible_id = ${actor.id}) ORDER BY mi.due_date NULLS LAST, mi.created_at`
    : [];
  const count = (sev: string) => all.filter((a) => a.severity === sev).length;
  const qs = (patch: Record<string, string>) => `/alertas?${new URLSearchParams(Object.fromEntries(Object.entries({ ...sp, ...patch }).filter(([, v]) => v)) as Record<string, string>)}`;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{manager ? "Central de saúde e alertas" : "Minhas pendências"}</h1>
          <p className="sub">Regras determinísticas e explicáveis. Espera planejada, prazo futuro e aprovação pendente não geram culpa. {manager ? "Pergunte o motivo, registre a orientação e acompanhe até resolver." : ""}</p>
        </div>
        {manager ? <Link className="btn" href="/config#regras">Configurar regras</Link> : null}
      </div>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi label="Críticos" value={<span style={{ color: "var(--crit)" }}>▲ {count("critico")}</span>} />
        <Kpi label="Atenção" value={<span style={{ color: "var(--warn)" }}>● {count("atencao")}</span>} />
        <Kpi label="Configuração" value={<span style={{ color: "var(--info)" }}>ⓘ {count("info")}</span>} foot="Ex.: fluxos sem estimativa de horas" />
        <Kpi label="Encaminhamentos abertos" value={open.length} foot={manager ? "Orientações do líder ainda não resolvidas" : ""} />
      </div>
      <div className="tabs">
        <Link href={qs({ regra: "" })} className={!sp.regra ? "on" : ""}>Todos ({all.length})</Link>
        {Object.entries(RULES).map(([k, v]) => {
          const n = all.filter((a) => a.rule === k).length;
          return n ? <Link key={k} href={qs({ regra: k })} className={sp.regra === k ? "on" : ""}>{v} ({n})</Link> : null;
        })}
      </div>
      {manager ? (
        <form className="filters" method="get">
          {sp.regra ? <input type="hidden" name="regra" value={sp.regra} /> : null}
          <div className="field"><label>Squad</label><select name="squad" defaultValue={sp.squad ?? ""}><option value="">Todos</option>{squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="field"><label>Cliente</label><select name="cliente" defaultValue={sp.cliente ?? ""}><option value="">Todos</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label>Responsável</label><select name="pessoa" defaultValue={sp.pessoa ?? ""}><option value="">Todos</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <label className="check"><input type="checkbox" name="reconhecidos" value="1" defaultChecked={sp.reconhecidos === "1"} /> incluir reconhecidos/adiados</label>
          <button className="btn primary">Filtrar</button>
        </form>
      ) : null}
      <div className={manager ? "grid g-side" : ""}>
        <Card tight><AlertList alerts={alerts} actor={actor} /></Card>
        {manager ? (
          <div className="stack">
            <Card title="Encaminhamentos e one-on-ones abertos" tight>
              {open.length === 0 ? <Empty title="Nenhum encaminhamento aberto" /> : (
                <ul className="list">{open.map((i) => (
                  <li key={i.id}>
                    <div className="small"><b>{INTERVENTION_KIND[i.kind]}</b> · {i.author} · {fmtDateTime(i.created_at)}</div>
                    <div>{i.text}</div>
                    <div className="small muted">{i.subject ? `Com ${i.subject} · ` : ""}{i.responsible ? `responsável ${i.responsible}` : ""}{i.due_date ? ` · prazo ${fmtDate(i.due_date)}` : ""}{i.task_id ? <> · <Link href={`/tarefas/${i.task_id}`}>{i.task_title}</Link></> : null}{i.client_name ? ` · ${i.client_name}` : ""}</div>
                    <ActionForm action={resolveInterventionAction}><input type="hidden" name="id" value={i.id} /><Submit className="btn sm ghost">Marcar resolvido</Submit></ActionForm>
                  </li>
                ))}</ul>
              )}
            </Card>
            <Card title="Registrar one-on-one / orientação" hint="Fato, justificativa e decisão humana ficam separados e auditáveis.">
              <ActionForm action={interventionAction} className="stack" reset>
                <Field label="Tipo"><select name="kind" defaultValue="one_on_one">{Object.entries(INTERVENTION_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Com quem"><select name="subjectUserId"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                <Field label="Cliente (opcional)"><select name="clientId"><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Registro"><textarea name="text" required placeholder="Pontos discutidos, correções, combinados" /></Field>
                <div className="form-grid">
                  <Field label="Responsável pelo encaminhamento"><select name="responsibleId"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                  <Field label="Prazo"><input type="date" name="dueDate" /></Field>
                </div>
                <Submit>Registrar</Submit>
              </ActionForm>
            </Card>
            <div className="note">Assistência de IA (resumo de gargalos, sugestões) está planejada para P1 com evidências e aprovação humana — nenhuma síntese automática é simulada aqui.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
