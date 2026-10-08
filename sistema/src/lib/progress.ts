// Regras de progresso (seção 6.1 da especificação). Funções puras e testadas.
//
// peso_i = horas_estimadas_i / soma_horas_estimadas_da_base_planejada
// progresso = 100 * Σ (peso_i * concluída_i)   — concluída_i ∈ {0,1} no P0
//
// • Base planejada: tarefas com in_baseline = true, exceto canceladas cuja decisão foi "remover_da_base".
//   Cancelada com "manter_na_base" continua no denominador como não concluída.
// • Sem horas estimadas em alguma tarefa da base → progresso ponderado INDISPONÍVEL.
//   Exibimos apenas "provisório por contagem", sempre rotulado.
// • Horas reais (apontadas) nunca entram neste cálculo.
// • Esperado para a data: soma dos pesos das tarefas da base com prazo ≤ data (simplificação P0 por marcos).

export type ProgressTask = {
  status: string;
  est_hours: number | null;
  in_baseline: boolean;
  cancel_scope_treatment?: string | null;
  due_date?: string | null;
};

export type Progress = {
  state: "ok" | "sem_estimativa" | "sem_tarefas";
  baselineCount: number;
  doneCount: number;
  missingEstimates: number;
  estHoursTotal: number;
  estHoursDone: number;
  /** 0–100, somente quando todas as tarefas da base têm estimativa > 0 */
  weighted: number | null;
  /** 0–100 por contagem — apenas como fallback rotulado "provisório" */
  provisional: number | null;
  /** esperado para a data de referência (mesma régua do valor principal) */
  expected: number | null;
  expectedProvisional: number | null;
  /** há tarefas da base sem prazo — esperado parcial */
  undatedCount: number;
};

export function inBaseline(t: ProgressTask) {
  if (!t.in_baseline) return false;
  if (t.status === "cancelada" && t.cancel_scope_treatment === "remover_da_base") return false;
  return true;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeProgress(tasks: ProgressTask[], refDate?: string): Progress {
  const base = tasks.filter(inBaseline);
  const done = base.filter((t) => t.status === "concluida");
  const missing = base.filter((t) => t.est_hours == null || Number(t.est_hours) <= 0);
  const estTotal = base.reduce((s, t) => s + (Number(t.est_hours) || 0), 0);
  const estDone = done.reduce((s, t) => s + (Number(t.est_hours) || 0), 0);
  const undated = base.filter((t) => !t.due_date).length;

  if (base.length === 0) {
    return { state: "sem_tarefas", baselineCount: 0, doneCount: 0, missingEstimates: 0, estHoursTotal: 0, estHoursDone: 0, weighted: null, provisional: null, expected: null, expectedProvisional: null, undatedCount: 0 };
  }

  const dueBy = refDate ? base.filter((t) => t.due_date && t.due_date <= refDate) : [];
  const hasSchedule = base.some((t) => t.due_date);
  const provisional = round1((100 * done.length) / base.length);
  const expectedProvisional = refDate && hasSchedule ? round1((100 * dueBy.length) / base.length) : null;

  if (missing.length > 0 || estTotal <= 0) {
    return { state: "sem_estimativa", baselineCount: base.length, doneCount: done.length, missingEstimates: missing.length, estHoursTotal: estTotal, estHoursDone: estDone, weighted: null, provisional, expected: null, expectedProvisional, undatedCount: undated };
  }

  const weighted = round1((100 * estDone) / estTotal);
  const expected = refDate && hasSchedule ? round1((100 * dueBy.reduce((s, t) => s + Number(t.est_hours), 0)) / estTotal) : null;
  return { state: "ok", baselineCount: base.length, doneCount: done.length, missingEstimates: 0, estHoursTotal: estTotal, estHoursDone: estDone, weighted, provisional, expected, expectedProvisional, undatedCount: undated };
}

/** Valor a exibir + rótulo explicando a régua. */
export function displayProgress(p: Progress): { value: number | null; expected: number | null; label: string; provisional: boolean } {
  if (p.state === "sem_tarefas") return { value: null, expected: null, label: "Sem dados suficientes", provisional: false };
  if (p.state === "ok") return { value: p.weighted, expected: p.expected, label: "Ponderado por horas estimadas", provisional: false };
  return {
    value: p.provisional,
    expected: p.expectedProvisional,
    label: `Provisório por contagem — ${p.missingEstimates} tarefa(s) sem estimativa`,
    provisional: true,
  };
}

/** Diferença realizado − esperado em pontos percentuais (para ordenação de risco). */
export function progressGap(p: Progress): number | null {
  const d = displayProgress(p);
  if (d.value == null || d.expected == null) return null;
  return round1(d.value - d.expected);
}
