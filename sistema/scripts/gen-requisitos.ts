// Gera REQUISITOS_ELEVEN.md a partir de src/lib/requirements.ts (fonte única).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REQUIREMENTS, STATUS_LABEL } from "../src/lib/requirements";

const count = (s: string) => REQUIREMENTS.filter((r) => r.status === s).length;
const lines = [
  "# REQUISITOS_ELEVEN — Registro rastreável REQ-001 a REQ-060",
  "",
  "Gerado por `npm run docs:requisitos` a partir de `src/lib/requirements.ts` (também exibido na tela **Backlog** do sistema).",
  "Nenhum requisito foi removido ao condensar o MVP. Estados: **Feito e testado** (com teste automatizado em `tests/`), **Feito**, **Parcial** (base P0 entregue, evolução pendente), **Planejado**.",
  "",
  `Resumo: ${count("testado")} feitos e testados · ${count("feito")} feitos · ${count("parcial")} parciais · ${count("planejado")} planejados.`,
  "",
  "| ID | Requisito | Prior. | Estado | Telas / entidades | Testes | Pendências |",
  "|---|---|---|---|---|---|---|",
  ...REQUIREMENTS.map((r) => `| ${r.id} | ${r.text} | ${r.priority} | ${STATUS_LABEL[r.status]} | ${r.where} | ${r.tests ?? "—"} | ${r.pending ?? "—"} |`),
  "",
  "## Referência dos testes de aceitação (tests/acceptance.test.ts)",
  "",
  "AT-01 cadastro→escopo→fluxo→Radar · AT-02 conclusão atualiza histórico/Meu Dia/progresso/saúde · AT-03 produção única e remarcação · AT-04 ciclos independentes · AT-05 editado ≠ publicado · AT-06 bloqueio/justificativa/inatividade sem falso culpado · AT-07 demanda extra sem inflar escopo · AT-08 implantação cruzando meses + acompanhamento · AT-09 KPI→decisão→tarefa→resultado · AT-09b oportunidade só executa após aprovação · AT-10/10b encerramento e replanejamento com motivo · AT-11/12 progresso ponderado e ausência de estimativa · AT-13 filtro por squad com atuação cruzada · AT-14 permissões no servidor · AT-15 relatório semanal sem dados internos · AT-16 cancelar exige motivo · AT-17 registro retrospectivo · AT-18 reabertura auditada · AT-19 dado real não herda demo. AT-20 (recarregar sem perder dados; voltar ao cliente pela tarefa) verificado manualmente no navegador.",
  "",
];
writeFileSync(join(__dirname, "..", "REQUISITOS_ELEVEN.md"), lines.join("\n"));
console.log("✔ REQUISITOS_ELEVEN.md gerado");
