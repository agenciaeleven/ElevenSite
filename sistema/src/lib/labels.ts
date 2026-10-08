// Rótulos em português e paleta semântica — fonte única para toda a interface.
export const TASK_STATUS: Record<string, string> = {
  a_fazer: "A fazer",
  em_andamento: "Em andamento",
  bloqueada: "Bloqueada",
  em_revisao: "Em revisão",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
export const TASK_STATUS_ORDER = ["a_fazer", "em_andamento", "em_revisao", "bloqueada", "concluida", "cancelada"];

export const PRIORITY: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };

export const LIFECYCLE: Record<string, string> = {
  ciclico: "Cíclico / recorrente",
  implantacao: "Implantação",
  continuo: "Operação contínua",
  projeto: "Projeto / campanha",
  extra: "Demandas avulsas",
};
export const LIFECYCLE_SHORT: Record<string, string> = {
  ciclico: "Ciclo",
  implantacao: "Implantação",
  continuo: "Contínuo",
  projeto: "Projeto",
  extra: "Avulso",
};

export const FLOW_STATUS: Record<string, string> = {
  planejado: "Planejado",
  ativo: "Ativo",
  em_espera: "Em espera",
  concluido: "Concluído",
  cancelado: "Cancelado",
  arquivado: "Arquivado",
};

export const CLIENT_STATUS: Record<string, string> = { onboarding: "Onboarding", ativo: "Ativo", pausado: "Pausado", encerrado: "Encerrado" };

export const SERVICE_KIND: Record<string, string> = {
  conteudo: "Conteúdo / social media",
  trafego: "Tráfego pago",
  audiovisual: "Audiovisual",
  estrategia: "Estratégia",
  crm: "CRM",
  onboarding: "Onboarding",
  outro: "Outro",
};

export const PERIODICITY: Record<string, string> = {
  unico: "Único",
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
  trimestral: "Trimestral",
  sob_demanda: "Sob demanda",
};

export const BLOCK_REASON: Record<string, string> = {
  aguardando_cliente: "Aguardando cliente",
  aguardando_terceiro: "Aguardando terceiro",
  mudanca_prioridade: "Mudança de prioridade",
  falta_capacidade: "Falta de capacidade",
  dificuldade_tecnica: "Dificuldade técnica",
  falta_informacao: "Falta de informação/material",
  outro: "Outro",
};

export const EVENT_KIND: Record<string, string> = {
  producao: "Produção / captação",
  reuniao: "Reunião",
  entrega: "Entrega / prazo",
  indisponibilidade: "Indisponibilidade",
  feriado: "Feriado",
  outro: "Outro",
};
export const EVENT_STATUS: Record<string, string> = { agendado: "Agendado", realizado: "Realizado", cancelado: "Cancelado" };

export const EDITORIAL_STATE: Record<string, string> = {
  roteiro: "Roteiro",
  producao: "Produção",
  edicao: "Edição",
  aprovacao: "Aprovação",
  agendada: "Agendada",
  postada: "Postada",
  descartada: "Descartada",
};
export const EDITORIAL_ORDER = ["roteiro", "producao", "edicao", "aprovacao", "agendada", "postada"];

export const OPPORTUNITY_STATUS: Record<string, string> = {
  proposta: "Proposta",
  avaliando: "Avaliando",
  aprovada: "Aprovada / priorizada",
  recusada: "Recusada",
  arquivada: "Arquivada",
};

export const INITIATIVE_STATUS: Record<string, string> = {
  proposta: "Proposta",
  aprovada: "Aprovada",
  em_execucao: "Em execução",
  concluida: "Concluída",
  descartada: "Descartada",
};
export const INITIATIVE_KIND: Record<string, string> = {
  iniciativa: "Iniciativa",
  campanha: "Campanha",
  projeto: "Projeto",
  sazonal: "Data sazonal",
  marco: "Marco",
};

export const SCOPE_CLASS: Record<string, string> = {
  dentro_do_escopo: "Dentro do escopo",
  avaliar_escopo: "Avaliar escopo",
  escopo_adicional_aprovado: "Escopo adicional aprovado",
};

export const ROLE: Record<string, string> = { admin: "Direção / Admin", lider: "Líder de squad", colaborador: "Colaborador" };

export const INTERVENTION_KIND: Record<string, string> = {
  orientacao: "Orientação",
  correcao: "Correção",
  encaminhamento: "Encaminhamento",
  decisao: "Decisão",
  one_on_one: "One-on-one",
};

export const MANUAL_KIND: Record<string, string> = {
  complemento: "Complemento de atividade",
  demanda_extra: "Demanda não planejada",
  observacao: "Observação",
  plano: "Plano do dia",
};

export const DECISION_STATUS: Record<string, string> = { proposta: "Aguardando aprovação", aprovada: "Aprovada", recusada: "Recusada" };
export const REPORT_STATUS: Record<string, string> = { rascunho: "Rascunho", revisado: "Revisado", compartilhado: "Marcado como compartilhado" };

export type Severity = "critico" | "atencao" | "info" | "normal" | "sem_dados";
export const SEVERITY: Record<Severity, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  info: "Configuração",
  normal: "Normal",
  sem_dados: "Sem dados",
};
export const SEVERITY_ICON: Record<Severity, string> = { critico: "▲", atencao: "●", info: "ⓘ", normal: "✓", sem_dados: "–" };

/** "categoria: comentário" → rótulo legível. */
export function fmtBlocker(raw: string | null | undefined) {
  if (!raw) return null;
  const i = raw.indexOf(":");
  const cat = i >= 0 ? raw.slice(0, i) : raw;
  const rest = i >= 0 ? raw.slice(i + 1).trim() : "";
  return `${BLOCK_REASON[cat] ?? cat}${rest ? ` — ${rest}` : ""}`;
}
