// Testes de aceitação (seção 14) executados contra um PostgreSQL real (DATABASE_URL_TEST).
// O banco de teste é recriado do zero a cada execução.
import "./setup-env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "../src/lib/db";
import { migrate } from "../scripts/migrate";
import { hashPassword, type Actor } from "../src/lib/auth-core";
import { assertClientAccess, loadTaskForActor } from "../src/lib/access";
import { AppError, ForbiddenError } from "../src/lib/errors";
import * as clients from "../src/lib/services/clients";
import * as flows from "../src/lib/services/flows";
import * as tasks from "../src/lib/services/tasks";
import * as agenda from "../src/lib/services/agenda";
import * as daily from "../src/lib/services/daily";
import * as alerts from "../src/lib/services/alerts";
import * as reports from "../src/lib/services/reports";
import * as strategy from "../src/lib/services/strategy";
import * as people from "../src/lib/services/people";
import { flowProgress, radar } from "../src/lib/queries";
import { reportText, loadReport } from "../src/lib/reports-view/load";
import { dateOfInstant } from "../src/lib/dates";

let admin: Actor, lider: Actor, colab: Actor, outsider: Actor;
let squadA: string, squadB: string, c1: string, c2: string, tpl: string;

async function mkUser(name: string, role: string, ws: string): Promise<Actor> {
  const [u] = await sql<Actor[]>`INSERT INTO users (workspace_id, name, email, password_hash, role, weekly_capacity_hours) VALUES (${ws}, ${name}, ${name.toLowerCase() + "@teste.local"}, ${await hashPassword("senha-teste-123")}, ${role}, 40) RETURNING id, name, email, role, workspace_id, is_demo`;
  return u;
}

before(async () => {
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await migrate(false);
  const [w] = await sql<{ id: string }[]>`INSERT INTO workspaces (name) VALUES ('Teste') RETURNING id`;
  admin = await mkUser("Admin", "admin", w.id);
  lider = await mkUser("Lider", "lider", w.id);
  colab = await mkUser("Colab", "colaborador", w.id);
  outsider = await mkUser("Outsider", "colaborador", w.id);
  squadA = await people.saveSquad(admin, { name: "A", leaderId: lider.id });
  squadB = await people.saveSquad(admin, { name: "B" });
  await people.setSquadMember(admin, squadA, colab.id, true);
  await people.setSquadMember(admin, squadB, outsider.id, true);
  tpl = await people.saveTemplate(admin, { name: "Ciclo teste", lifecycle: "ciclico" });
  await people.saveTemplateStep(admin, { templateId: tpl, stage: "Roteiro", name: "Roteiro", estHours: 2, offsetDays: -3 });
  await people.saveTemplateStep(admin, { templateId: tpl, stage: "Produção", name: "Captação", estHours: 3, offsetDays: 0 });
  await people.saveTemplateStep(admin, { templateId: tpl, stage: "Pós", name: "Calendário", estHours: 5, offsetDays: 1 });
});

after(async () => {
  await sql.end();
});

test("AT-01: admin cadastra cliente → escopo → entregável → fluxo e tarefa; visível no painel e no Radar", async () => {
  c1 = await clients.createClient(admin, { name: "Cliente Um", status: "ativo", squadIds: [squadA] });
  c2 = await clients.createClient(admin, { name: "Cliente Dois", status: "ativo", squadIds: [squadB] });
  const ctr = await clients.saveContract(admin, { clientId: c1, title: "Contrato", startDate: "2026-10-01" });
  const sv = await clients.saveService(admin, { clientId: c1, contractId: ctr, name: "Conteúdo", kind: "conteudo" });
  const dl = await clients.saveDeliverable(admin, { clientId: c1, serviceId: sv, contractId: ctr, name: "Vídeos", quantity: 4, periodicity: "mensal", acceptanceCriteria: "Publicado" });
  const f = await flows.createFlow(admin, { clientId: c1, name: "Ciclo 10/10", lifecycle: "ciclico", templateId: tpl, referenceDate: "2026-10-10", serviceId: sv, deliverableIds: [dl], defaultAssigneeId: colab.id });
  const t = await tasks.createTask(admin, { flowId: f, title: "Extra do fluxo" });
  const [row] = await sql`SELECT count(*)::int AS n FROM tasks WHERE flow_id = ${f}`;
  assert.equal(row.n, 4);
  const [due] = await sql`SELECT due_date FROM tasks WHERE flow_id = ${f} AND title = 'Roteiro'`;
  assert.equal(due.due_date, "2026-10-07");
  const [extra] = await sql`SELECT in_baseline, is_extra FROM tasks WHERE id = ${t}`;
  assert.equal(extra.in_baseline, false, "tarefa adicionada a fluxo ativo não entra na base sem aprovação");
  const r = await radar(admin, { month: "2026-10" });
  const rc = r.rows.find((x) => x.id === c1);
  assert.ok(rc, "cliente aparece no Radar");
  assert.equal(rc!.commitment.baselineCount, 3);
  const [link] = await sql`SELECT count(*)::int AS n FROM flow_deliverables WHERE flow_id = ${f} AND deliverable_id = ${dl}`;
  assert.equal(link.n, 1);
});

test("AT-02 + AT-11: colaborador conclui tarefa → histórico, Meu Dia, progresso ponderado; horas reais não alteram %", async () => {
  const [f] = await sql<{ id: string }[]>`SELECT id FROM flow_instances WHERE name = 'Ciclo 10/10'`;
  const [t] = await sql<{ id: string }[]>`SELECT id FROM tasks WHERE flow_id = ${f.id} AND title = 'Calendário'`;
  const [t2] = await sql<{ id: string }[]>`SELECT id FROM tasks WHERE flow_id = ${f.id} AND title = 'Roteiro'`;
  await tasks.changeStatus(colab, t.id, "concluida");
  let p = (await flowProgress([f.id])).get(f.id)!;
  assert.equal(p.weighted, 50, "5h de 10h");
  await tasks.addTimeEntry(colab, { taskId: t.id, hours: 12, occurredOn: "2026-10-08" });
  p = (await flowProgress([f.id])).get(f.id)!;
  assert.equal(p.weighted, 50, "12h reais não mudam o percentual");
  assert.equal(p.actualHours, 12);
  const day = await daily.getDay(colab, colab.id, "2026-10-08");
  assert.ok(day.completed.some((x) => x.id === t.id), "aparece em Meu Dia como concluída");
  assert.ok(day.feed.some((e) => e.task_id === t.id && e.action === "status:concluida"), "feed automático");
  // A tarefa 'Roteiro' venceu em 07/10 → alerta de atraso para o líder até ser concluída
  let al = await alerts.computeAlerts(lider, { clientId: c1 });
  assert.ok(al.some((a) => a.key === `atraso:${t2.id}`));
  await tasks.changeStatus(colab, t2.id, "concluida");
  al = await alerts.computeAlerts(lider, { clientId: c1 });
  assert.ok(!al.some((a) => a.key === `atraso:${t2.id}`), "saúde atualizada sem relançar dado");
});

test("AT-03 + AT-16: produção única em agenda, squad e fluxo; remarcar atualiza todas as visões; cancelar exige motivo", async () => {
  const [f] = await sql<{ id: string }[]>`SELECT id FROM flow_instances WHERE name = 'Ciclo 10/10'`;
  const [cap] = await sql<{ id: string }[]>`SELECT id FROM tasks WHERE flow_id = ${f.id} AND title = 'Captação'`;
  const ev = await agenda.createEvent(lider, { kind: "producao", title: "Captação Cliente Um", flowId: f.id, taskId: cap.id, date: "2026-10-10", startTime: "14:00", endTime: "16:00", participantIds: [colab.id] });
  const range = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-31T00:00:00Z") };
  const general = await agenda.listEvents(lider, range);
  const bySquad = await agenda.listEvents(lider, { ...range, squadId: squadA });
  const byFlow = await agenda.listEvents(lider, { ...range, flowId: f.id });
  for (const l of [general, bySquad, byFlow]) assert.equal(l.filter((e) => e.id === ev).length, 1);
  await assert.rejects(agenda.rescheduleEvent(lider, ev, { date: "2026-10-12", startTime: "10:00", reason: "" }), AppError);
  await agenda.rescheduleEvent(lider, ev, { date: "2026-10-12", startTime: "10:00", endTime: "12:00", reason: "Cliente pediu" });
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM calendar_events WHERE title = 'Captação Cliente Um'`;
  assert.equal(n, 1, "remarcar não duplica");
  const [t] = await sql`SELECT due_date FROM tasks WHERE id = ${cap.id}`;
  assert.equal(t.due_date, "2026-10-12", "prazo da tarefa acompanha a remarcação");
  const [e] = await sql`SELECT reschedule_count FROM calendar_events WHERE id = ${ev}`;
  assert.equal(e.reschedule_count, 1);
  await assert.rejects(agenda.cancelEvent(lider, ev, " "), AppError);
  await agenda.cancelEvent(lider, ev, "Chuva");
  const [c] = await sql`SELECT status, cancel_reason FROM calendar_events WHERE id = ${ev}`;
  assert.equal(c.status, "cancelado");
  const [h] = await sql`SELECT count(*)::int AS n FROM operational_events WHERE entity_id = ${ev} AND action IN ('remarcou','cancelou_evento')`;
  assert.equal(h.n, 2, "histórico preservado");
});

test("AT-04: dois ciclos independentes — concluir no ciclo 1 não altera o ciclo 2", async () => {
  const a = await flows.createFlow(lider, { clientId: c1, name: "Ciclo 09/10", lifecycle: "ciclico", templateId: tpl, referenceDate: "2026-10-09" });
  const b = await flows.createFlow(lider, { clientId: c1, name: "Ciclo 19/10", lifecycle: "ciclico", templateId: tpl, referenceDate: "2026-10-19" });
  const [t] = await sql<{ id: string }[]>`SELECT id FROM tasks WHERE flow_id = ${a} AND title = 'Captação'`;
  await tasks.changeStatus(lider, t.id, "concluida");
  const p = await flowProgress([a, b]);
  assert.equal(p.get(a)!.weighted, 30);
  assert.equal(p.get(b)!.weighted, 0);
});

test("AT-05: edição concluída não publica; publicação é evento separado", async () => {
  const [f] = await sql<{ id: string }[]>`SELECT id FROM flow_instances WHERE name = 'Ciclo 09/10'`;
  await assert.rejects(flows.createContent(lider, { flowId: f.id, title: "Vídeo 1", createTasks: true, editHours: 2, publishHours: 0.5, inBaseline: true }), AppError, "base fixada exige motivo");
  const cid = await flows.createContent(lider, { flowId: f.id, title: "Vídeo 1", createTasks: true, editHours: 2, publishHours: 0.5, inBaseline: true, baselineReason: "Vídeo previsto no ciclo" });
  const [edit] = await sql<{ id: string }[]>`SELECT id FROM tasks WHERE content_id = ${cid} AND title LIKE 'EDIÇÃO%'`;
  await tasks.changeStatus(lider, edit.id, "concluida");
  let [c] = await sql`SELECT editorial_state, published_at FROM content_assets WHERE id = ${cid}`;
  assert.equal(c.published_at, null);
  assert.notEqual(c.editorial_state, "postada");
  await flows.setContentState(lider, cid, "aprovacao");
  [c] = await sql`SELECT edited_at, published_at FROM content_assets WHERE id = ${cid}`;
  assert.ok(c.edited_at);
  assert.equal(c.published_at, null);
  await flows.setContentState(lider, cid, "postada");
  [c] = await sql`SELECT published_at FROM content_assets WHERE id = ${cid}`;
  assert.ok(c.published_at);
  const [pub] = await sql`SELECT status FROM tasks WHERE content_id = ${cid} AND title LIKE 'PUBLICAÇÃO%'`;
  assert.equal(pub.status, "a_fazer", "status da tarefa de publicação é independente do estado editorial");
});

test("AT-06: bloqueio com motivo chega ao líder; inatividade não culpa quem aguarda legitimamente", async () => {
  const f = await flows.createFlow(lider, { clientId: c1, name: "Fluxo bloqueado", lifecycle: "projeto" });
  await sql`UPDATE flow_instances SET created_at = '2026-09-28' WHERE id = ${f}`;
  const t = await tasks.createTask(lider, { flowId: f, title: "Aprovação do cliente", assigneeId: colab.id, dueDate: "2026-10-06", estHours: 1, inBaseline: true, baselineReason: "setup" });
  await sql`UPDATE tasks SET start_date = '2026-10-01' WHERE id = ${t}`;
  await sql`UPDATE operational_events SET occurred_at = '2026-09-28' WHERE flow_id = ${f}`;
  let al = await alerts.computeAlerts(lider, { clientId: c1 });
  assert.ok(al.some((a) => a.key === `inatividade:${f}`), "sem movimentação e sem motivo → alerta");
  await tasks.blockTask(colab, t, { category: "aguardando_cliente", comment: "Aguardando aprovação do cliente", releaseOwner: "Cliente", expectedResolution: "2026-10-10" });
  al = await alerts.computeAlerts(lider, { clientId: c1 });
  const b = al.find((a) => a.rule === "bloqueio" && a.taskId === t);
  assert.ok(b, "líder vê o bloqueio");
  assert.match(b!.detail, /Aguardando cliente/);
  assert.match(b!.detail, /Liberação: Cliente/);
  assert.ok(!al.some((a) => a.key === `inatividade:${f}`), "espera legítima (bloqueio registrado) não gera inatividade");
  assert.ok(!al.some((a) => a.key === `atraso:${t}`), "bloqueada não aparece como atraso sem causa");
  await alerts.addIntervention(lider, { kind: "encaminhamento", text: "Ligar para o cliente", taskId: t, responsibleId: lider.id });
  // pedido de motivo
  const t2 = await tasks.createTask(lider, { flowId: f, title: "Outra", assigneeId: colab.id, dueDate: "2026-10-05" });
  await alerts.requestJustification(lider, t2, "Por que atrasou?");
  const day = await daily.getDay(colab, colab.id, "2026-10-08");
  assert.equal(day.requests.length, 1, "pedido aparece no Meu Dia do responsável");
  await assert.rejects(alerts.answerJustification(outsider, day.requests[0].id, { category: "outro", answer: "x", expectedResolution: null }), ForbiddenError);
  await alerts.answerJustification(colab, day.requests[0].id, { category: "falta_informacao", answer: "Sem briefing", expectedResolution: null });
  al = await alerts.computeAlerts(lider, { clientId: c1 });
  assert.match(al.find((a) => a.key === `atraso:${t2}`)!.justification!, /Falta de informação/);
});

test("AT-07: demanda não planejada no Meu Dia conta esforço sem aumentar o escopo vendido", async () => {
  const [f] = await sql<{ id: string }[]>`SELECT id FROM flow_instances WHERE name = 'Ciclo 10/10'`;
  const before = (await flowProgress([f.id])).get(f.id)!;
  await daily.addManualEntry(colab, { day: "2026-10-08", kind: "demanda_extra", description: "Ajuste urgente pedido no WhatsApp", clientId: c1, hours: 1.5, createAsTask: true });
  const [t] = await sql`SELECT is_extra, in_baseline, status, flow_id FROM tasks WHERE title = 'Ajuste urgente pedido no WhatsApp'`;
  assert.equal(t.is_extra, true);
  assert.equal(t.in_baseline, false);
  assert.equal(t.status, "concluida");
  const after = (await flowProgress([f.id])).get(f.id)!;
  assert.equal(after.baselineCount, before.baselineCount);
  const [h] = await sql`SELECT sum(hours) AS h FROM time_entries WHERE user_id = ${colab.id} AND occurred_on = '2026-10-08' AND task_id IS NOT NULL AND note LIKE 'Meu Dia%'`;
  assert.equal(Number(h.h), 1.5);
});

test("AT-08: implantação out→nov não zera; concluir abre acompanhamento sem manter o projeto aberto", async () => {
  const f = await flows.createFlow(lider, { clientId: c1, name: "Implantação funil", lifecycle: "implantacao", startDate: "2026-10-01", dueDate: "2026-11-20", status: "planejado" });
  const a = await tasks.createTask(lider, { flowId: f, title: "Mapa", estHours: 4, dueDate: "2026-10-05", inBaseline: true });
  const b = await tasks.createTask(lider, { flowId: f, title: "Go-live", estHours: 4, dueDate: "2026-11-10", inBaseline: true });
  await flows.activateFlow(lider, f);
  await tasks.changeStatus(lider, a, "concluida");
  const r1 = await radar(lider, { month: "2026-11" });
  assert.ok(r1.rows.find((x) => x.id === c1));
  const p = (await flowProgress([f], "2026-11-15")).get(f)!;
  assert.equal(p.weighted, 50, "percentual continua em novembro");
  await assert.rejects(flows.completeFlow(lider, f, { acceptanceNote: "" }), AppError);
  await assert.rejects(flows.completeFlow(lider, f, { acceptanceNote: "ok" }), /tarefa\(s\) da base ainda abertas/);
  await tasks.changeStatus(lider, b, "concluida");
  const follow = await flows.completeFlow(lider, f, { acceptanceNote: "Funil publicado e aceito", followUpName: "Acompanhamento do funil" });
  const [orig] = await sql`SELECT status, completed_at FROM flow_instances WHERE id = ${f}`;
  const [child] = await sql`SELECT lifecycle, parent_flow_id, status FROM flow_instances WHERE id = ${follow}`;
  assert.equal(orig.status, "concluido");
  assert.equal(child.lifecycle, "continuo");
  assert.equal(child.parent_flow_id, f);
  assert.equal(child.status, "ativo");
});

test("AT-09: KPI → diagnóstico → decisão; ação só vira tarefa após aprovação; resultado ligado à origem", async () => {
  const kpi = await reports.saveKpi(lider, { clientId: c1, name: "CPL", unit: "R$", target: 30 });
  const rep = await reports.createReport(lider, { clientId: c1, kind: "mensal_trafego", start: "2026-09-01", end: "2026-09-30" });
  await reports.addKpiObservation(lider, { kpiId: kpi, reportId: rep, observedOn: "2026-09-30", value: 42 });
  const d = await reports.proposeDecision(lider, { clientId: c1, reportId: rep, kpiId: kpi, diagnosis: "CPL alto", proposal: "Testar criativo B", ownerId: colab.id });
  const [none] = await sql`SELECT count(*)::int AS n FROM tasks WHERE title = 'Testar criativo B'`;
  assert.equal(none.n, 0, "proposta não gera tarefa");
  const taskId = await reports.decide(lider, d, true, { dueDate: "2026-10-20", estHours: 3 });
  const [t] = await sql`SELECT title, assignee_id, origin FROM tasks WHERE id = ${taskId}`;
  assert.equal(t.origin, "decisao");
  assert.equal(t.assignee_id, colab.id);
  await reports.recordDecisionResult(lider, d, "CPL caiu para 33 (fonte: gerenciador)");
  const [row] = await sql`SELECT report_id, kpi_id, task_id, result_note FROM decisions WHERE id = ${d}`;
  assert.equal(row.report_id, rep);
  assert.equal(row.task_id, taskId);
  assert.ok(row.result_note);
});

test("AT-09b: oportunidade não aprovada não gera execução; aprovada vira fluxo rastreável", async () => {
  const o = await strategy.createOpportunity(lider, { clientId: c1, title: "Podcast" });
  await assert.rejects(strategy.convertOpportunity(lider, o, { name: "Podcast", lifecycle: "projeto" }), /aprovadas/);
  await assert.rejects(strategy.setOpportunityStatus(lider, o, "aprovada", "ok", null), /escopo/);
  await strategy.setOpportunityStatus(lider, o, "aprovada", "Cabe no trimestre", "escopo_adicional_aprovado");
  const f = await strategy.convertOpportunity(lider, o, { name: "Podcast piloto", lifecycle: "projeto" });
  const [r] = await sql`SELECT converted_flow_id FROM strategic_opportunities WHERE id = ${o}`;
  assert.equal(r.converted_flow_id, f);
});

test("AT-10 + AT-10b: projeto pontual encerrado fica no histórico; replanejamento exige motivo e preserva o original", async () => {
  const f = await flows.createFlow(lider, { clientId: c1, name: "Campanha Dia X", lifecycle: "projeto", dueDate: "2026-10-30" });
  await assert.rejects(flows.updateFlow(lider, f, { due_date: "2026-11-15" }), /motivo/);
  await flows.updateFlow(lider, f, { due_date: "2026-11-15" }, "Cliente adiou o lançamento");
  const [ev] = await sql`SELECT before, after, reason FROM operational_events WHERE flow_id = ${f} AND action = 'replanejou'`;
  assert.equal(ev.before.due_date, "2026-10-30");
  assert.equal(ev.reason, "Cliente adiou o lançamento");
  const before = await sql`SELECT count(*)::int AS n FROM flow_instances WHERE client_id = ${c1}`;
  await flows.completeFlow(lider, f, { acceptanceNote: "Campanha encerrada", force: true });
  const afterCount = await sql`SELECT count(*)::int AS n FROM flow_instances WHERE client_id = ${c1}`;
  assert.equal(afterCount[0].n, before[0].n, "nenhuma recriação automática");
  const [st] = await sql`SELECT status FROM flow_instances WHERE id = ${f}`;
  assert.equal(st.status, "concluido");
});

test("AT-13: Radar filtrado por squad inclui atuação cruzada de colaboradores", async () => {
  // colaborador do squad A recebe tarefa no cliente do squad B
  const f = await flows.createFlow(admin, { clientId: c2, name: "Fluxo C2", lifecycle: "projeto" });
  await tasks.createTask(admin, { flowId: f, title: "Ajuda cruzada", assigneeId: colab.id, dueDate: "2026-10-15", estHours: 2, inBaseline: true, baselineReason: "setup" });
  const r = await radar(admin, { month: "2026-10", squadId: squadA });
  assert.ok(r.rows.some((x) => x.id === c1));
  assert.ok(r.rows.some((x) => x.id === c2), "cliente do squad B aparece pela atuação cruzada");
  const rb = await radar(admin, { month: "2026-10", squadId: squadB });
  assert.ok(!rb.rows.some((x) => x.id === c1), "cliente do squad A não aparece no filtro do B");
});

test("AT-14: colaborador não edita contrato/Bússola nem acessa cliente fora do escopo pela API", async () => {
  await assert.rejects(clients.saveContract(colab, { clientId: c1, title: "x" }), ForbiddenError);
  await assert.rejects(strategy.saveCompass(colab, c1, { diagnosis: "x" }), ForbiddenError);
  await assert.rejects(clients.createClient(lider, { name: "x" }), ForbiddenError);
  const [t] = await sql<{ id: string }[]>`SELECT id FROM tasks WHERE client_id = ${c1} LIMIT 1`;
  await assert.rejects(assertClientAccess(outsider, c1), ForbiddenError);
  await assert.rejects(loadTaskForActor(outsider, t.id), ForbiddenError);
  await assert.rejects(tasks.changeStatus(outsider, t.id, "em_andamento"), ForbiddenError);
  const r = await radar(outsider, { month: "2026-10" });
  assert.ok(!r.rows.some((x) => x.id === c1), "Radar do colaborador de outro squad não lista o cliente");
  // colaborador não altera prazo/responsável de tarefa planejada
  const [planned] = await sql<{ id: string }[]>`SELECT id FROM tasks WHERE client_id = ${c1} AND in_baseline AND assignee_id = ${colab.id} LIMIT 1`;
  await assert.rejects(tasks.updateTask(colab, planned.id, { due_date: "2026-12-01" }), ForbiddenError);
});

test("AT-15: relatório semanal lista só concluídas do cliente/período e não inclui notas internas", async () => {
  await sql`UPDATE clients SET internal_notes = 'NOTA-SECRETA' WHERE id = ${c1}`;
  const f = await flows.createFlow(admin, { clientId: c2, name: "Outro cliente", lifecycle: "projeto" });
  const other = await tasks.createTask(admin, { flowId: f, title: "Tarefa de outro cliente" });
  await tasks.changeStatus(admin, other, "concluida");
  const rep = await reports.createReport(lider, { clientId: c1, kind: "semanal", start: "2026-10-05", end: "2026-10-11" });
  await reports.updateReport(lider, rep, { summary: "Semana boa", resultsText: null, diagnosis: null, nextSteps: null, internalNotes: "INTERNO-NAO-MOSTRAR", includeIdx: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  const d = (await loadReport(rep))!;
  const texts = d.r.completed_items.map((i) => i.text);
  assert.ok(texts.includes("Calendário"));
  assert.ok(!texts.includes("Tarefa de outro cliente"));
  assert.ok(!texts.includes("Criativo"), "nada aberto entra");
  const txt = reportText(d);
  assert.ok(!txt.includes("INTERNO-NAO-MOSTRAR"));
  assert.ok(!txt.includes("NOTA-SECRETA"));
  await assert.rejects(reports.setReportStatus(lider, rep, "compartilhado"), /Revise/);
  await reports.setReportStatus(lider, rep, "revisado");
  await reports.setReportStatus(lider, rep, "compartilhado");
});

test("AT-17: registro retrospectivo preserva ocorrido_em e registrado_em", async () => {
  const t = await tasks.createTask(lider, { clientId: c1, title: "Feita ontem", assigneeId: colab.id, dueDate: "2026-10-07" });
  await tasks.changeStatus(colab, t, "concluida", { occurredOn: "2026-10-07" });
  const [row] = await sql<{ completed_at: Date; completed_recorded_at: Date }[]>`SELECT completed_at, completed_recorded_at FROM tasks WHERE id = ${t}`;
  assert.equal(dateOfInstant(row.completed_at), "2026-10-07");
  assert.notEqual(dateOfInstant(row.completed_recorded_at), "2026-10-07");
  const [ev] = await sql<{ occurred_at: Date; recorded_at: Date }[]>`SELECT occurred_at, recorded_at FROM operational_events WHERE task_id = ${t} AND action = 'status:concluida'`;
  assert.equal(dateOfInstant(ev.occurred_at), "2026-10-07");
  assert.ok(ev.recorded_at.getTime() > ev.occurred_at.getTime());
  const y = await daily.getDay(colab, colab.id, "2026-10-07");
  assert.ok(y.completed.some((x) => x.id === t), "aparece no dia em que ocorreu");
  await assert.rejects(tasks.changeStatus(colab, t, "concluida", { occurredOn: "2026-12-01" }));
});

test("AT-18: reabrir gera auditoria, preserva a conclusão anterior e recalcula", async () => {
  const [f] = await sql<{ id: string }[]>`SELECT id FROM flow_instances WHERE name = 'Ciclo 09/10'`;
  const [t] = await sql<{ id: string; completed_at: Date }[]>`SELECT id, completed_at FROM tasks WHERE flow_id = ${f.id} AND title = 'Captação'`;
  const before = (await flowProgress([f.id])).get(f.id)!;
  await assert.rejects(tasks.reopenTask(lider, t.id, ""), AppError);
  await tasks.reopenTask(lider, t.id, "Material corrompido, refazer");
  const [ev] = await sql`SELECT before, reason FROM operational_events WHERE task_id = ${t.id} AND action = 'reabriu'`;
  assert.ok(ev.before.completed_at, "conclusão anterior preservada no evento");
  assert.equal(ev.reason, "Material corrompido, refazer");
  const after = (await flowProgress([f.id])).get(f.id)!;
  assert.ok(after.estHoursDone < before.estHoursDone, "progresso recalculado");
  const [r] = await sql`SELECT reopened_count, status FROM tasks WHERE id = ${t.id}`;
  assert.equal(r.reopened_count, 1);
  assert.equal(r.status, "em_andamento");
});

test("AT-19: cliente real não herda dados fictícios; cancelamento exige tratamento no escopo", async () => {
  const real = await clients.createClient(admin, { name: "Cliente Real" });
  const [c] = await sql`SELECT is_demo FROM clients WHERE id = ${real}`;
  assert.equal(c.is_demo, false);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM tasks WHERE client_id = ${real}`;
  assert.equal(n, 0);
  const f = await flows.createFlow(admin, { clientId: real, name: "F", lifecycle: "projeto", status: "planejado" });
  const a = await tasks.createTask(admin, { flowId: f, title: "A", estHours: 5, inBaseline: true });
  const b = await tasks.createTask(admin, { flowId: f, title: "B", estHours: 5, inBaseline: true });
  await tasks.changeStatus(admin, a, "concluida");
  await assert.rejects(tasks.cancelTask(admin, b, "", "remover_da_base"), AppError);
  await assert.rejects(tasks.cancelTask(colab, b, "x", "remover_da_base"), ForbiddenError);
  await tasks.cancelTask(admin, b, "Cliente desistiu", "remover_da_base");
  assert.equal((await flowProgress([f])).get(f)!.weighted, 100);
});

test("AT-12 (integração): sem horas estimadas não há ponderado; alerta de configuração", async () => {
  const f = await flows.createFlow(lider, { clientId: c1, name: "Sem estimativa", lifecycle: "projeto", status: "planejado" });
  await tasks.createTask(lider, { flowId: f, title: "Sem horas", inBaseline: true });
  const p = (await flowProgress([f])).get(f)!;
  assert.equal(p.state, "sem_estimativa");
  assert.equal(p.weighted, null);
  const al = await alerts.computeAlerts(lider, { clientId: c1 });
  assert.ok(al.some((a) => a.key === `sem_estimativa:${f}` && a.severity === "info"));
});
