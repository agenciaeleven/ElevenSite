import { redirect } from "next/navigation";
import { getActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { ActionForm, Submit } from "@/components/ActionForm";
import { loginAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getActor()) redirect("/");
  const [demo] = await sql`SELECT 1 FROM users WHERE is_demo AND active LIMIT 1`;
  return (
    <main className="login">
      <div className="box">
        <h1 style={{ fontSize: 22 }}>Sistema Eleven</h1>
        <p className="muted" style={{ marginTop: 4, marginBottom: 18 }}>Execução, evolução e saúde da operação.</p>
        <ActionForm action={loginAction} className="stack">
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <Submit pendingText="Entrando…">Entrar</Submit>
        </ActionForm>
        {demo ? (
          <div className="note" style={{ marginTop: 16 }}>
            <b>Ambiente com dados de demonstração.</b> Senha <code>eleven-demo</code> para: <code>direcao@eleven.demo</code> (direção), <code>victoria@eleven.demo</code> (líder Fox), <code>pedro@eleven.demo</code> (líder Hornets), <code>tarcisio@eleven.demo</code> (colaborador).
          </div>
        ) : null}
      </div>
    </main>
  );
}
