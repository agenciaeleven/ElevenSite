// Deve ser o primeiro import dos testes: aponta para o banco de teste e fixa "hoje".
if (!process.env.DATABASE_URL_TEST) throw new Error("Defina DATABASE_URL_TEST (banco descartável) para rodar os testes.");
if (process.env.DATABASE_URL_TEST === process.env.DATABASE_URL) throw new Error("DATABASE_URL_TEST não pode ser o banco principal.");
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.APP_TODAY = "2026-10-08";
process.env.APP_TIMEZONE = "America/Sao_Paulo";
