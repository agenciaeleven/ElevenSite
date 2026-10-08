// Utilitários de data. Datas de calendário circulam como "AAAA-MM-DD" (string).
export const TZ = process.env.APP_TIMEZONE || "America/Sao_Paulo";

export function isoInTz(d: Date, tz = TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hoje no fuso da agência. APP_TODAY permite fixar a data em testes/demonstrações. */
export function today(): string {
  return process.env.APP_TODAY || isoInTz(new Date());
}

function toUTC(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fromUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86400000);
}

export function isWeekend(iso: string) {
  const w = toUTC(iso).getUTCDay();
  return w === 0 || w === 6;
}

/** Dias úteis decorridos de `from` (exclusivo) até `to` (inclusivo). Feriados: P1. */
export function businessDaysBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let n = 0;
  let cur = from;
  while (cur < to) {
    cur = addDays(cur, 1);
    if (!isWeekend(cur)) n++;
  }
  return n;
}

export function addBusinessDays(iso: string, n: number): string {
  let cur = iso;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (!isWeekend(cur)) left--;
  }
  return cur;
}

export function monthOf(iso: string) {
  return iso.slice(0, 7);
}

export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = fromUTC(new Date(Date.UTC(y, m, 0)));
  return { start, end };
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return fromUTC(d).slice(0, 7);
}

/** Segunda-feira da semana de `iso`. */
export function weekStart(iso: string) {
  const w = toUTC(iso).getUTCDay();
  return addDays(iso, w === 0 ? -6 : 1 - w);
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function fmtMonth(month: string, cap = true) {
  const [y, m] = month.split("-").map(Number);
  const name = MONTHS[m - 1];
  return `${cap ? name[0].toUpperCase() + name.slice(1) : name} de ${y}`;
}

export function fmtDate(iso: string | null | undefined, opts: { weekday?: boolean; year?: boolean } = {}) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  const base = `${d}/${m}${opts.year ? `/${y}` : ""}`;
  return opts.weekday ? `${WEEKDAYS[toUTC(iso.slice(0, 10)).getUTCDay()]} ${base}` : base;
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function fmtTime(d: Date | string | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(date);
}

export function dateOfInstant(d: Date | string) {
  return isoInTz(typeof d === "string" ? new Date(d) : d);
}

/** Converte data+hora locais (fuso da agência) em Date UTC. */
export function localToInstant(date: string, time = "00:00"): Date {
  // Descobre o deslocamento do fuso naquele dia (America/Sao_Paulo não tem horário de verão desde 2019).
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" }).formatToParts(guess);
  const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = off.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const offsetMin = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  return new Date(guess.getTime() - offsetMin * 60000);
}

export function relativeDays(iso: string | null | undefined, ref = today()) {
  if (!iso) return "";
  const n = diffDays(ref, iso.slice(0, 10));
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  if (n === -1) return "ontem";
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}
