import postgres from "postgres";

// Datas (DATE) são mantidas como string "AAAA-MM-DD" para evitar deslocamento de fuso.
// numeric é convertido para number (horas, metas) — precisão suficiente para o domínio.
function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada. Veja sistema/.env.example.");
  return postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idle_timeout: 20,
    onnotice: () => {},
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  });
}

type Sql = ReturnType<typeof createClient>;
const g = globalThis as unknown as { __elevenSql?: Sql };

export const sql: Sql = g.__elevenSql ?? (g.__elevenSql = createClient());
type Types = { date: string; numeric: number; bigint: number };
export type Tx = Sql | postgres.TransactionSql<Types>;
