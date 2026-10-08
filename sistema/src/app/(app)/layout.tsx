import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { isManager } from "@/lib/access";
import { ROLE } from "@/lib/labels";
import { Nav, type NavItem } from "@/components/Nav";
import { NavToggle } from "@/components/ClientBits";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const manager = isManager(actor);
  const [{ demo }] = await sql<{ demo: boolean }[]>`SELECT EXISTS (SELECT 1 FROM clients WHERE is_demo AND deleted_at IS NULL) AS demo`;
  const [{ pending }] = await sql<{ pending: number }[]>`SELECT count(*)::int AS pending FROM justification_requests WHERE requested_to = ${actor.id} AND answered_at IS NULL`;
  const [{ blocks }] = manager
    ? await sql<{ blocks: number }[]>`SELECT count(*)::int AS blocks FROM blockers WHERE resolved_at IS NULL`
    : [{ blocks: 0 }];

  const items: NavItem[] = [
    ...(manager ? [{ href: "/", label: "Radar da agência", icon: "◎" }] : []),
    { href: "/meu-dia", label: "Meu Dia", icon: "☀", count: pending },
    { href: "/clientes", label: "Clientes", icon: "▦" },
    { href: "/agenda", label: "Agenda", icon: "▤" },
    { href: "/alertas", label: manager ? "Saúde e alertas" : "Minhas pendências", icon: "⚑", count: manager ? blocks : 0 },
    { href: "/squads", label: "Squads", icon: "◈", sep: "Equipe" },
    ...(manager ? [{ href: "/pessoas", label: "Pessoas", icon: "◍" }] : []),
    ...(manager ? [{ href: "/relatorios", label: "Relatórios", icon: "▧", sep: "Gestão" }] : []),
    ...(manager ? [{ href: "/config", label: "Configurações", icon: "⚙" }] : []),
    { href: "/backlog", label: "Backlog REQ-001–060", icon: "☰", sep: manager ? undefined : "Produto" },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Eleven<span>Sistema operacional</span></div>
        <Nav items={items} />
        <div className="me">
          <b>{actor.name}</b>
          {ROLE[actor.role]}
          <div className="row" style={{ marginTop: 6 }}>
            <a href="/conta">Minha conta</a>
            <form action={logoutAction}><button className="btn ghost sm" style={{ color: "#94a3b8", padding: 0 }}>Sair</button></form>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar no-print"><NavToggle /> <b>Sistema Eleven</b></div>
        {demo ? (
          <div className="demo-banner">
            <b>Ambiente com dados de DEMONSTRAÇÃO.</b> Itens marcados <span className="badge b-demo">Demo</span> são fictícios (status, horas, KPIs) e não representam a situação real da agência.
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
