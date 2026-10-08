"use server";
// Server actions: camada fina que lê o formulário, identifica o usuário e chama os serviços de domínio.
// Toda regra de permissão e negócio está nos serviços (src/lib/services) — nunca só na interface.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { authenticate, createSession, destroySession, type Actor } from "@/lib/auth-core";
import { getActor, SESSION_COOKIE } from "@/lib/session";
import type { ActionResult } from "@/components/ActionForm";
import * as tasks from "@/lib/services/tasks";
import * as flows from "@/lib/services/flows";
import * as clients from "@/lib/services/clients";
import * as agenda from "@/lib/services/agenda";
import * as daily from "@/lib/services/daily";
import * as alerts from "@/lib/services/alerts";
import * as reports from "@/lib/services/reports";
import * as strategy from "@/lib/services/strategy";
import * as people from "@/lib/services/people";
import { assertAdmin } from "@/lib/access";
import { today } from "@/lib/dates";

// ───────── Helpers de formulário ─────────
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
const req = (fd: FormData, k: string) => s(fd, k) ?? "";
const n = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (v == null) return null;
  const x = Number(v.replace(",", "."));
  if (!Number.isFinite(x)) throw new AppError(`Número inválido em “${k}”.`);
  return x;
};
const b = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true" || fd.get(k) === "1";
const all = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);

type Out = string | void | { redirect: string; ok?: string };

async function run(fn: (a: Actor) => Promise<Out>, ok = "Salvo."): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  let to: string | null = null;
  let msg = ok;
  try {
    const r = await fn(actor);
    if (r && typeof r === "object") {
      to = r.redirect;
      if (r.ok) msg = r.ok;
    } else if (typeof r === "string") msg = r;
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, at: Date.now() };
    console.error(e);
    return { error: "Erro inesperado ao salvar. Tente novamente; se persistir, avise a direção.", at: Date.now() };
  }
  revalidatePath("/", "layout");
  if (to) redirect(to);
  return { ok: msg, at: Date.now() };
}

// ───────── Sessão ─────────
export async function loginAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await authenticate(req(fd, "email"), req(fd, "password"));
  if (!actor) return { error: "E-mail ou senha inválidos." };
  const { token, expires } = await createSession(actor.id);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires, path: "/" });
  redirect(actor.role === "colaborador" ? "/meu-dia" : "/");
}

export async function logoutAction() {
  const jar = await cookies();
  await destroySession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function changePasswordAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    if (req(fd, "password") !== req(fd, "confirm")) throw new AppError("As senhas não conferem.");
    await people.resetPassword(a, a.id, req(fd, "password"));
  }, "Senha alterada.");
}

// ───────── Tarefas ─────────
export async function taskStatusAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.changeStatus(a, req(fd, "taskId"), req(fd, "status"), { occurredOn: s(fd, "occurredOn"), note: s(fd, "note") }), "Status atualizado.");
}
export async function completeTaskAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.changeStatus(a, req(fd, "taskId"), "concluida", { occurredOn: s(fd, "occurredOn"), note: s(fd, "note") }), "Tarefa concluída.");
}
export async function blockTaskAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.blockTask(a, req(fd, "taskId"), { category: req(fd, "category"), comment: s(fd, "comment"), releaseOwner: s(fd, "releaseOwner"), expectedResolution: s(fd, "expectedResolution"), link: s(fd, "link") }), "Bloqueio registrado e enviado ao líder.");
}
export async function resolveBlockerAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.resolveBlocker(a, req(fd, "blockerId"), req(fd, "resolution"), s(fd, "nextStatus") ?? "em_andamento"), "Bloqueio resolvido.");
}
export async function cancelTaskAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.cancelTask(a, req(fd, "taskId"), req(fd, "reason"), req(fd, "treatment") as "remover_da_base"), "Tarefa cancelada (histórico preservado).");
}
export async function reopenTaskAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.reopenTask(a, req(fd, "taskId"), req(fd, "reason")), "Tarefa reaberta.");
}
export async function waitingAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.setWaiting(a, req(fd, "taskId"), s(fd, "until"), s(fd, "reason")), "Espera atualizada.");
}
export async function baselineAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.setBaseline(a, req(fd, "taskId"), b(fd, "inBaseline"), req(fd, "reason")), "Base planejada alterada.");
}
export async function evidenceAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.addEvidence(a, req(fd, "taskId"), s(fd, "url"), s(fd, "note")), "Evidência anexada.");
}
export async function timeEntryAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.addTimeEntry(a, { taskId: s(fd, "taskId"), clientId: s(fd, "clientId"), hours: n(fd, "hours") ?? 0, occurredOn: s(fd, "occurredOn") ?? today(), note: s(fd, "note") }), "Horas apontadas.");
}
export async function checklistAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.updateChecklist(a, req(fd, "taskId"), { add: s(fd, "add") ?? undefined, toggle: s(fd, "toggle") != null ? Number(s(fd, "toggle")) : undefined, remove: s(fd, "remove") != null ? Number(s(fd, "remove")) : undefined }), "Checklist atualizado.");
}
export async function dependencyAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    if (s(fd, "remove")) await tasks.removeDependency(a, req(fd, "taskId"), req(fd, "remove"));
    else await tasks.addDependency(a, req(fd, "taskId"), req(fd, "dependsOn"));
  }, "Dependência atualizada.");
}
export async function updateTaskAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const patch: tasks.TaskPatch = {};
    for (const k of ["title", "description", "stage", "assignee_id", "priority", "start_date", "due_date", "scope_class", "done_criteria"] as const) if (fd.has(k)) (patch as Record<string, unknown>)[k] = s(fd, k);
    if (fd.has("est_hours")) patch.est_hours = n(fd, "est_hours");
    await tasks.updateTask(a, req(fd, "taskId"), patch, s(fd, "reason"));
  }, "Tarefa atualizada.");
}
export async function quickAssignAction(_: ActionResult, fd: FormData) {
  return run((a) => tasks.updateTask(a, req(fd, "taskId"), { assignee_id: s(fd, "assignee_id") }), "Responsável atualizado.");
}
export async function createTaskAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const id = await tasks.createTask(a, {
      clientId: s(fd, "clientId"), flowId: s(fd, "flowId"), parentTaskId: s(fd, "parentTaskId"), contentId: s(fd, "contentId"), title: req(fd, "title"), description: s(fd, "description"),
      stage: s(fd, "stage"), assigneeId: s(fd, "assigneeId"), priority: s(fd, "priority") ?? "normal", startDate: s(fd, "startDate"), dueDate: s(fd, "dueDate"),
      estHours: n(fd, "estHours"), inBaseline: b(fd, "inBaseline"), baselineReason: s(fd, "baselineReason"), isExtra: b(fd, "isExtra"), scopeClass: s(fd, "scopeClass"),
    });
    if (b(fd, "open")) return { redirect: `/tarefas/${id}` };
  }, "Tarefa criada.");
}
export async function deleteTaskAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await tasks.deleteTask(a, req(fd, "taskId"), req(fd, "reason"));
    return { redirect: s(fd, "back") ?? "/" };
  }, "Tarefa excluída.");
}

// ───────── Fluxos e conteúdos ─────────
export async function createFlowAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const id = await flows.createFlow(a, {
      clientId: req(fd, "clientId"), name: req(fd, "name"), lifecycle: req(fd, "lifecycle"), templateId: s(fd, "templateId"), serviceId: s(fd, "serviceId"),
      deliverableIds: all(fd, "deliverableIds"), referenceDate: s(fd, "referenceDate"), startDate: s(fd, "startDate"), dueDate: s(fd, "dueDate"), cycleLabel: s(fd, "cycleLabel"),
      ownerId: s(fd, "ownerId"), defaultAssigneeId: s(fd, "defaultAssigneeId"), objective: s(fd, "objective"), planId: s(fd, "planId"), status: b(fd, "startNow") ? "ativo" : "planejado",
    });
    return { redirect: `/fluxos/${id}` };
  });
}
export async function updateFlowAction(_: ActionResult, fd: FormData) {
  return run((a) => flows.updateFlow(a, req(fd, "flowId"), { name: req(fd, "name"), start_date: s(fd, "start_date"), due_date: s(fd, "due_date"), owner_id: s(fd, "owner_id"), objective: s(fd, "objective"), cycle_label: s(fd, "cycle_label"), reference_date: s(fd, "reference_date"), service_id: s(fd, "service_id") }, s(fd, "reason")), "Fluxo atualizado.");
}
export async function flowWaitingAction(_: ActionResult, fd: FormData) {
  return run((a) => flows.setFlowWaiting(a, req(fd, "flowId"), b(fd, "waiting"), s(fd, "reason"), s(fd, "until")), "Situação do fluxo atualizada.");
}
export async function activateFlowAction(_: ActionResult, fd: FormData) {
  return run((a) => flows.activateFlow(a, req(fd, "flowId")), "Execução iniciada; base planejada fixada.");
}
export async function completeFlowAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const follow = await flows.completeFlow(a, req(fd, "flowId"), { acceptanceNote: req(fd, "acceptanceNote"), force: b(fd, "force"), followUpName: s(fd, "followUpName"), followUpLifecycle: s(fd, "followUpLifecycle") });
    if (follow) return { redirect: `/fluxos/${follow}`, ok: "Concluído. Acompanhamento criado." };
  }, "Fluxo concluído.");
}
export async function reopenFlowAction(_: ActionResult, fd: FormData) {
  return run((a) => flows.reopenFlow(a, req(fd, "flowId"), req(fd, "reason")), "Fluxo reaberto.");
}
export async function closeFlowAction(_: ActionResult, fd: FormData) {
  return run((a) => flows.closeFlow(a, req(fd, "flowId"), req(fd, "status") as "cancelado", req(fd, "reason")), "Fluxo encerrado.");
}
export async function createContentAction(_: ActionResult, fd: FormData) {
  return run((a) => flows.createContent(a, { flowId: req(fd, "flowId"), title: req(fd, "title"), kind: s(fd, "kind") ?? "video", script: s(fd, "script"), createTasks: b(fd, "createTasks"), editorAssigneeId: s(fd, "editorAssigneeId"), editHours: n(fd, "editHours"), publishHours: n(fd, "publishHours"), editDue: s(fd, "editDue"), publishDue: s(fd, "publishDue"), inBaseline: b(fd, "inBaseline"), baselineReason: s(fd, "baselineReason") }), "Conteúdo criado.");
}
export async function contentStateAction(_: ActionResult, fd: FormData) {
  return run((a) => flows.setContentState(a, req(fd, "contentId"), req(fd, "state")), "Estado editorial atualizado.");
}
export async function linkDeliverableAction(_: ActionResult, fd: FormData) {
  return run((a) => clients.linkFlowDeliverable(a, req(fd, "flowId"), req(fd, "deliverableId"), !b(fd, "unlink")), "Vínculo atualizado.");
}

// ───────── Clientes e escopo ─────────
export async function createClientAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const id = await clients.createClient(a, { name: req(fd, "name"), status: s(fd, "status") ?? "onboarding", segment: s(fd, "segment"), contactName: s(fd, "contactName"), contactEmail: s(fd, "contactEmail"), accountOwnerId: s(fd, "accountOwnerId"), internalNotes: s(fd, "internalNotes"), squadIds: all(fd, "squadIds") });
    return { redirect: `/clientes/${id}?aba=escopo` };
  });
}
export async function updateClientAction(_: ActionResult, fd: FormData) {
  return run((a) => clients.updateClient(a, req(fd, "clientId"), { name: req(fd, "name"), status: s(fd, "status") ?? "ativo", segment: s(fd, "segment"), contactName: s(fd, "contactName"), contactEmail: s(fd, "contactEmail"), accountOwnerId: s(fd, "accountOwnerId"), internalNotes: s(fd, "internalNotes"), squadIds: a.role === "admin" ? all(fd, "squadIds") : undefined }), "Cliente atualizado.");
}
export async function archiveClientAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await clients.archiveClient(a, req(fd, "clientId"), req(fd, "reason"));
    return { redirect: "/clientes" };
  });
}
export async function saveContractAction(_: ActionResult, fd: FormData) {
  return run((a) => clients.saveContract(a, { id: s(fd, "id"), clientId: req(fd, "clientId"), title: req(fd, "title"), status: s(fd, "status") ?? "vigente", startDate: s(fd, "startDate"), endDate: s(fd, "endDate"), ownerId: s(fd, "ownerId"), handoffNotes: s(fd, "handoffNotes"), monthlyValue: n(fd, "monthlyValue"), reason: s(fd, "reason") }).then(() => undefined), "Contrato salvo.");
}
export async function acceptHandoffAction(_: ActionResult, fd: FormData) {
  return run((a) => clients.acceptHandoff(a, req(fd, "contractId"), s(fd, "note")), "Passagem de bastão aceita.");
}
export async function saveServiceAction(_: ActionResult, fd: FormData) {
  return run((a) => clients.saveService(a, { id: s(fd, "id"), clientId: req(fd, "clientId"), contractId: s(fd, "contractId"), name: req(fd, "name"), kind: req(fd, "kind"), status: s(fd, "status") ?? "ativo", startDate: s(fd, "startDate"), endDate: s(fd, "endDate") }).then(() => undefined), "Serviço salvo.");
}
export async function saveDeliverableAction(_: ActionResult, fd: FormData) {
  return run((a) => clients.saveDeliverable(a, { id: s(fd, "id"), clientId: req(fd, "clientId"), serviceId: s(fd, "serviceId"), contractId: s(fd, "contractId"), name: req(fd, "name"), quantity: n(fd, "quantity"), unit: s(fd, "unit"), periodicity: req(fd, "periodicity"), acceptanceCriteria: s(fd, "acceptanceCriteria"), referenceHours: n(fd, "referenceHours"), startDate: s(fd, "startDate"), endDate: s(fd, "endDate"), status: s(fd, "status") ?? "ativo", reason: s(fd, "reason") }).then(() => undefined), "Entregável salvo.");
}

// ───────── Agenda ─────────
export async function createEventAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await agenda.createEvent(a, { kind: req(fd, "kind"), title: req(fd, "title"), clientId: s(fd, "clientId"), flowId: s(fd, "flowId"), taskId: s(fd, "taskId"), squadId: s(fd, "squadId"), date: req(fd, "date"), startTime: s(fd, "startTime"), endTime: s(fd, "endTime"), allDay: b(fd, "allDay"), location: s(fd, "location"), participantIds: all(fd, "participantIds"), force: b(fd, "force") });
  }, "Evento agendado.");
}
export async function rescheduleEventAction(_: ActionResult, fd: FormData) {
  return run((a) => agenda.rescheduleEvent(a, req(fd, "eventId"), { date: req(fd, "date"), startTime: s(fd, "startTime"), endTime: s(fd, "endTime"), reason: req(fd, "reason"), force: b(fd, "force") }), "Evento remarcado em todas as visões.");
}
export async function cancelEventAction(_: ActionResult, fd: FormData) {
  return run((a) => agenda.cancelEvent(a, req(fd, "eventId"), req(fd, "reason")), "Evento cancelado (histórico preservado).");
}
export async function eventDoneAction(_: ActionResult, fd: FormData) {
  return run((a) => agenda.markEventDone(a, req(fd, "eventId"), all(fd, "attended")), "Evento registrado como realizado.");
}
export async function meetingNotesAction(_: ActionResult, fd: FormData) {
  return run((a) => agenda.saveMeetingNotes(a, req(fd, "eventId"), req(fd, "notes")), "Ata salva.");
}
export async function meetingItemAction(_: ActionResult, fd: FormData) {
  return run((a) => agenda.addMeetingItem(a, req(fd, "eventId"), { kind: req(fd, "kind"), text: req(fd, "text"), ownerId: s(fd, "ownerId"), dueDate: s(fd, "dueDate") }), "Item registrado.");
}
export async function meetingItemToTaskAction(_: ActionResult, fd: FormData) {
  return run((a) => agenda.meetingItemToTask(a, req(fd, "itemId")).then(() => undefined), "Encaminhamento convertido em tarefa.");
}

// ───────── Meu Dia ─────────
export async function manualEntryAction(_: ActionResult, fd: FormData) {
  return run((a) => daily.addManualEntry(a, { day: s(fd, "day") ?? today(), kind: req(fd, "kind"), description: req(fd, "description"), clientId: s(fd, "clientId"), taskId: s(fd, "taskId"), hours: n(fd, "hours"), link: s(fd, "link"), createAsTask: b(fd, "createAsTask") }), "Registro adicionado ao seu dia.");
}
export async function deleteManualEntryAction(_: ActionResult, fd: FormData) {
  return run((a) => daily.deleteManualEntry(a, req(fd, "id")), "Registro removido.");
}
export async function closeDayAction(_: ActionResult, fd: FormData) {
  return run((a) => {
    const reasons = all(fd, "reasonTask").map((taskId) => ({ taskId, reason: s(fd, `reason_${taskId}`) ?? "" }));
    return daily.closeDay(a, req(fd, "day"), s(fd, "summary"), reasons);
  }, "Fechamento do dia salvo.");
}

// ───────── Saúde / líder ─────────
export async function ackAlertAction(_: ActionResult, fd: FormData) {
  return run((a) => alerts.ackAlert(a, req(fd, "key"), s(fd, "note"), s(fd, "snooze")), "Alerta reconhecido.");
}
export async function unackAlertAction(_: ActionResult, fd: FormData) {
  return run((a) => alerts.unackAlert(a, req(fd, "key")), "Alerta reativado.");
}
export async function requestJustificationAction(_: ActionResult, fd: FormData) {
  return run((a) => alerts.requestJustification(a, req(fd, "taskId"), s(fd, "question")), "Pedido de motivo enviado ao Meu Dia do responsável.");
}
export async function answerJustificationAction(_: ActionResult, fd: FormData) {
  return run((a) => alerts.answerJustification(a, req(fd, "requestId"), { category: req(fd, "category"), answer: s(fd, "answer"), expectedResolution: s(fd, "expectedResolution"), alsoBlock: b(fd, "alsoBlock"), releaseOwner: s(fd, "releaseOwner") }), "Motivo enviado ao líder.");
}
export async function interventionAction(_: ActionResult, fd: FormData) {
  return run((a) => alerts.addIntervention(a, { kind: req(fd, "kind"), text: req(fd, "text"), taskId: s(fd, "taskId"), blockerId: s(fd, "blockerId"), clientId: s(fd, "clientId"), subjectUserId: s(fd, "subjectUserId"), responsibleId: s(fd, "responsibleId"), dueDate: s(fd, "dueDate") }), "Intervenção registrada.");
}
export async function resolveInterventionAction(_: ActionResult, fd: FormData) {
  return run((a) => alerts.resolveIntervention(a, req(fd, "id")), "Encaminhamento resolvido.");
}

// ───────── Relatórios, KPIs e decisões ─────────
export async function createReportAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const id = await reports.createReport(a, { clientId: req(fd, "clientId"), kind: (s(fd, "kind") ?? "semanal") as "semanal", start: req(fd, "start"), end: req(fd, "end") });
    return { redirect: `/relatorios/${id}` };
  });
}
export async function updateReportAction(_: ActionResult, fd: FormData) {
  return run((a) => reports.updateReport(a, req(fd, "reportId"), { summary: s(fd, "summary"), resultsText: s(fd, "resultsText"), diagnosis: s(fd, "diagnosis"), nextSteps: s(fd, "nextSteps"), internalNotes: s(fd, "internalNotes"), includeIdx: all(fd, "include").map(Number) }), "Relatório salvo (rascunho).");
}
export async function refreshReportAction(_: ActionResult, fd: FormData) {
  return run((a) => reports.refreshReportItems(a, req(fd, "reportId")), "Itens recalculados a partir das tarefas concluídas.");
}
export async function reportStatusAction(_: ActionResult, fd: FormData) {
  return run((a) => reports.setReportStatus(a, req(fd, "reportId"), req(fd, "status") as "revisado"), "Status do relatório atualizado.");
}
export async function saveKpiAction(_: ActionResult, fd: FormData) {
  return run((a) => reports.saveKpi(a, { id: s(fd, "id"), clientId: req(fd, "clientId"), objectiveId: s(fd, "objectiveId"), name: req(fd, "name"), unit: s(fd, "unit"), baseline: n(fd, "baseline"), target: n(fd, "target"), deadline: s(fd, "deadline"), source: s(fd, "source"), reliability: s(fd, "reliability"), isFictitious: b(fd, "isFictitious") }).then(() => undefined), "Indicador salvo.");
}
export async function kpiObservationAction(_: ActionResult, fd: FormData) {
  return run((a) => reports.addKpiObservation(a, { kpiId: req(fd, "kpiId"), reportId: s(fd, "reportId"), observedOn: req(fd, "observedOn"), value: n(fd, "value") ?? NaN, source: s(fd, "source"), note: s(fd, "note") }), "Medição registrada.");
}
export async function proposeDecisionAction(_: ActionResult, fd: FormData) {
  return run((a) => reports.proposeDecision(a, { clientId: req(fd, "clientId"), reportId: s(fd, "reportId"), kpiId: s(fd, "kpiId"), diagnosis: s(fd, "diagnosis"), proposal: req(fd, "proposal"), ownerId: s(fd, "ownerId") }).then(() => undefined), "Decisão proposta (aguarda aprovação).");
}
export async function decideAction(_: ActionResult, fd: FormData) {
  return run((a) => reports.decide(a, req(fd, "decisionId"), req(fd, "verdict") === "aprovar", { note: s(fd, "note"), dueDate: s(fd, "dueDate"), estHours: n(fd, "estHours"), flowId: s(fd, "flowId") }).then(() => undefined), "Decisão registrada.");
}
export async function decisionResultAction(_: ActionResult, fd: FormData) {
  return run((a) => reports.recordDecisionResult(a, req(fd, "decisionId"), req(fd, "result")), "Resultado registrado.");
}

// ───────── Estratégia ─────────
export async function saveCompassAction(_: ActionResult, fd: FormData) {
  return run((a) => strategy.saveCompass(a, req(fd, "clientId"), { diagnosis: s(fd, "diagnosis"), audience: s(fd, "audience"), positioning: s(fd, "positioning"), guidelines: s(fd, "guidelines"), hypotheses: s(fd, "hypotheses"), newVersion: b(fd, "newVersion") }).then(() => undefined), "Bússola salva.");
}
export async function saveObjectiveAction(_: ActionResult, fd: FormData) {
  return run((a) => strategy.saveObjective(a, { id: s(fd, "id"), compassId: req(fd, "compassId"), clientId: req(fd, "clientId"), code: s(fd, "code"), title: req(fd, "title"), description: s(fd, "description") }).then(() => undefined), "Objetivo salvo.");
}
export async function deleteObjectiveAction(_: ActionResult, fd: FormData) {
  return run((a) => strategy.deleteObjective(a, req(fd, "clientId"), req(fd, "id")), "Objetivo removido.");
}
export async function saveFrontAction(_: ActionResult, fd: FormData) {
  return run((a) => strategy.saveFront(a, { clientId: req(fd, "clientId"), objectiveId: req(fd, "objectiveId"), title: req(fd, "title"), description: s(fd, "description") }), "Frente adicionada.");
}
export async function deleteFrontAction(_: ActionResult, fd: FormData) {
  return run((a) => strategy.deleteFront(a, req(fd, "clientId"), req(fd, "id")), "Frente removida.");
}
export async function createOpportunityAction(_: ActionResult, fd: FormData) {
  return run((a) => strategy.createOpportunity(a, { clientId: req(fd, "clientId"), objectiveId: s(fd, "objectiveId"), title: req(fd, "title"), description: s(fd, "description"), origin: s(fd, "origin") }).then(() => undefined), "Oportunidade registrada (não entra no trabalho do time antes da decisão).");
}
export async function opportunityStatusAction(_: ActionResult, fd: FormData) {
  return run((a) => strategy.setOpportunityStatus(a, req(fd, "id"), req(fd, "status"), s(fd, "note"), s(fd, "scopeCheck")), "Oportunidade atualizada.");
}
export async function convertOpportunityAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const id = await strategy.convertOpportunity(a, req(fd, "id"), { name: req(fd, "name"), lifecycle: req(fd, "lifecycle"), templateId: s(fd, "templateId"), startDate: s(fd, "startDate"), dueDate: s(fd, "dueDate") });
    return { redirect: `/fluxos/${id}` };
  });
}
export async function savePlanAction(_: ActionResult, fd: FormData) {
  return run((a) => strategy.savePlan(a, { id: s(fd, "id"), clientId: req(fd, "clientId"), label: req(fd, "label"), startDate: req(fd, "startDate"), endDate: req(fd, "endDate"), status: s(fd, "status") ?? "em_planejamento", month1: s(fd, "month1"), month2: s(fd, "month2"), month3: s(fd, "month3"), closingNotes: s(fd, "closingNotes") }).then(() => undefined), "Planejamento salvo.");
}
export async function saveInitiativeAction(_: ActionResult, fd: FormData) {
  return run((a) => strategy.saveInitiative(a, { id: s(fd, "id"), planId: req(fd, "planId"), clientId: req(fd, "clientId"), title: req(fd, "title"), kind: s(fd, "kind") ?? "iniciativa", monthIndex: n(fd, "monthIndex"), status: s(fd, "status") ?? "proposta", scopeCheck: s(fd, "scopeCheck"), conditionalNote: s(fd, "conditionalNote"), objectiveIds: all(fd, "objectiveIds") }).then(() => undefined), "Iniciativa salva.");
}
export async function initiativeToFlowAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const id = await strategy.initiativeToFlow(a, req(fd, "id"), { name: s(fd, "name"), lifecycle: req(fd, "lifecycle"), templateId: s(fd, "templateId"), startDate: s(fd, "startDate"), dueDate: s(fd, "dueDate"), existingFlowId: s(fd, "existingFlowId") });
    return { redirect: `/fluxos/${id}` };
  });
}

// ───────── Pessoas, squads e configuração ─────────
export async function createUserAction(_: ActionResult, fd: FormData) {
  return run((a) => people.createUser(a, { name: req(fd, "name"), email: req(fd, "email"), password: req(fd, "password"), role: req(fd, "role"), jobTitle: s(fd, "jobTitle"), weeklyCapacity: n(fd, "weeklyCapacity"), squadIds: all(fd, "squadIds") }).then(() => undefined), "Usuário criado.");
}
export async function updateUserAction(_: ActionResult, fd: FormData) {
  return run((a) => people.updateUser(a, req(fd, "userId"), { name: req(fd, "name"), role: req(fd, "role"), jobTitle: s(fd, "jobTitle"), weeklyCapacity: n(fd, "weeklyCapacity"), active: b(fd, "active"), squadIds: all(fd, "squadIds") }), "Usuário atualizado.");
}
export async function resetPasswordAction(_: ActionResult, fd: FormData) {
  return run((a) => people.resetPassword(a, req(fd, "userId"), req(fd, "password")), "Senha redefinida.");
}
export async function saveSquadAction(_: ActionResult, fd: FormData) {
  return run((a) => people.saveSquad(a, { id: s(fd, "id"), name: req(fd, "name"), color: s(fd, "color"), leaderId: s(fd, "leaderId"), weeklyCapacity: n(fd, "weeklyCapacity") }).then(() => undefined), "Squad salvo.");
}
export async function squadMemberAction(_: ActionResult, fd: FormData) {
  return run((a) => people.setSquadMember(a, req(fd, "squadId"), req(fd, "userId"), !b(fd, "remove"), n(fd, "allocationPct")), "Equipe do squad atualizada.");
}
export async function saveTemplateAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const id = await people.saveTemplate(a, { id: s(fd, "id"), name: req(fd, "name"), lifecycle: req(fd, "lifecycle"), description: s(fd, "description"), active: fd.has("active") ? b(fd, "active") : true });
    if (!s(fd, "id")) return { redirect: `/config/modelos/${id}` };
  }, "Modelo salvo.");
}
export async function saveTemplateStepAction(_: ActionResult, fd: FormData) {
  return run((a) => people.saveTemplateStep(a, { id: s(fd, "id"), templateId: req(fd, "templateId"), stage: s(fd, "stage"), name: req(fd, "name"), roleHint: s(fd, "roleHint"), estHours: n(fd, "estHours"), offsetDays: n(fd, "offsetDays"), position: n(fd, "position"), doneCriteria: s(fd, "doneCriteria") }).then(() => undefined), "Etapa salva.");
}
export async function deleteTemplateStepAction(_: ActionResult, fd: FormData) {
  return run((a) => people.deleteTemplateStep(a, req(fd, "id")), "Etapa removida.");
}
export async function alertRuleAction(_: ActionResult, fd: FormData) {
  return run((a) => people.saveAlertRule(a, req(fd, "key"), b(fd, "enabled"), n(fd, "threshold")), "Regra atualizada.");
}
export async function removeDemoAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    assertAdmin(a);
    if (req(fd, "confirm") !== "REMOVER") throw new AppError("Digite REMOVER para confirmar.");
    const { removeDemoData } = await import("@/lib/services/demo");
    await removeDemoData();
  }, "Dados de demonstração removidos. Usuários demo foram desativados.");
}
