import { requireActor } from "@/lib/session";
import { ROLE } from "@/lib/labels";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Card, Field } from "@/components/ui";
import { changePasswordAction } from "../../actions";

export const metadata = { title: "Minha conta" };

export default async function AccountPage() {
  const actor = await requireActor();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Minha conta</h1><p className="sub">{actor.name} · {actor.email} · {ROLE[actor.role]}</p></div></div>
      <div style={{ maxWidth: 420 }}>
        <Card title="Alterar senha">
          <ActionForm action={changePasswordAction} className="stack" reset>
            <Field label="Nova senha"><input name="password" type="password" minLength={8} required autoComplete="new-password" /></Field>
            <Field label="Confirme"><input name="confirm" type="password" minLength={8} required autoComplete="new-password" /></Field>
            <Submit>Alterar senha</Submit>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
