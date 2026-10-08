import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProgress, displayProgress } from "../src/lib/progress";

test("AT-11: 5h concluídas de 10h estimadas = 50%; horas reais não interferem", () => {
  const p = computeProgress([
    { status: "concluida", est_hours: 2, in_baseline: true },
    { status: "concluida", est_hours: 3, in_baseline: true },
    { status: "em_andamento", est_hours: 4, in_baseline: true },
    { status: "a_fazer", est_hours: 1, in_baseline: true },
  ]);
  assert.equal(p.state, "ok");
  assert.equal(p.weighted, 50);
  assert.equal(p.estHoursTotal, 10);
});

test("AT-12: sem horas estimadas não há cálculo ponderado; provisório rotulado", () => {
  const p = computeProgress([
    { status: "concluida", est_hours: null, in_baseline: true },
    { status: "a_fazer", est_hours: 3, in_baseline: true },
  ]);
  assert.equal(p.state, "sem_estimativa");
  assert.equal(p.weighted, null);
  assert.equal(p.missingEstimates, 1);
  const d = displayProgress(p);
  assert.equal(d.provisional, true);
  assert.match(d.label, /Provisório/);
});

test("sem tarefas: sem dados (não 0%)", () => {
  const p = computeProgress([]);
  assert.equal(p.state, "sem_tarefas");
  assert.equal(displayProgress(p).value, null);
});

test("extras fora da base não alteram o % vendido", () => {
  const p = computeProgress([
    { status: "concluida", est_hours: 5, in_baseline: true },
    { status: "a_fazer", est_hours: 5, in_baseline: true },
    { status: "concluida", est_hours: 20, in_baseline: false },
  ]);
  assert.equal(p.weighted, 50);
});

test("cancelada: removida da base sai do denominador; mantida conta como não concluída", () => {
  const removed = computeProgress([
    { status: "concluida", est_hours: 5, in_baseline: true },
    { status: "cancelada", est_hours: 5, in_baseline: true, cancel_scope_treatment: "remover_da_base" },
  ]);
  assert.equal(removed.weighted, 100);
  const kept = computeProgress([
    { status: "concluida", est_hours: 5, in_baseline: true },
    { status: "cancelada", est_hours: 5, in_baseline: true, cancel_scope_treatment: "manter_na_base" },
  ]);
  assert.equal(kept.weighted, 50);
});

test("esperado para a data usa prazos (marcos), não dias corridos", () => {
  const p = computeProgress(
    [
      { status: "concluida", est_hours: 2, in_baseline: true, due_date: "2026-10-05" },
      { status: "a_fazer", est_hours: 6, in_baseline: true, due_date: "2026-10-07" },
      { status: "a_fazer", est_hours: 2, in_baseline: true, due_date: "2026-10-20" },
    ],
    "2026-10-08",
  );
  assert.equal(p.weighted, 20);
  assert.equal(p.expected, 80);
});
