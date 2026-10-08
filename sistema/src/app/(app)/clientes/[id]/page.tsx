import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { sql } from "@/lib/db";
import { clientScope, inScope } from "@/lib/access";
import { CLIENT_STATUS } from "@/lib/labels";
import { Demo, Tabs } from "@/components/ui";
import { TabVisao } from "./_tabs/visao";
import { TabFluxos } from "./_tabs/fluxos";
import { TabAgenda } from "./_tabs/agenda";
import { TabHistorico } from "./_tabs/historico";
import { TabBussola } from "./_tabs/bussola";
import { TabTrimestre } from "./_tabs/trimestre";
import { TabRelatorios } from "./_tabs/relatorios";
import { TabEscopo } from "./_tabs/escopo";

export type ClientHeader = {
  id: string; name: string; status: string; segment: string | null; contact_name: string | null; contact_email: string | null; account_owner_id: string | null;
  owner_name: string | null; internal_notes: string | null; is_demo: boolean; is_internal: boolean; squads: { id: string; name: string; leader: string | null }[];
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c] = await sql<{ name: string }[]>`SELECT name FROM clients WHERE id = ${id}`.catch(() => []);
  return { title: c?.name ?? "Cliente" };
}

const TABS = [
  ["visao", "Visão geral"], ["fluxos", "Fluxos e projetos"], ["agenda", "Agenda e conteúdos"], ["historico", "Histórico"],
  ["bussola", "Bússola"], ["trimestre", "Trimestre"], ["relatorios", "Relatórios e KPIs"], ["escopo", "Escopo contratado"],
] as const;

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Permissão verificada no servidor: manipular a URL não expõe cliente fora do escopo (AT-14)
  if (!inScope(await clientScope(actor), id)) notFound();
  const [c] = await sql<ClientHeader[]>`
    SELECT c.*, u.name AS owner_name,
      coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'leader', l.name) ORDER BY s.name) FROM client_squads cs JOIN squads s ON s.id = cs.squad_id LEFT JOIN users l ON l.id = s.leader_id WHERE cs.client_id = c.id), '[]') AS squads
    FROM clients c LEFT JOIN users u ON u.id = c.account_owner_id WHERE c.id = ${id} AND c.deleted_at IS NULL`;
  if (!c) notFound();
  const [contract] = await sql<{ title: string; start_date: string | null; end_date: string | null; status: string }[]>`SELECT title, start_date, end_date, status FROM contracts WHERE client_id = ${id} ORDER BY status = 'vigente' DESC, created_at DESC LIMIT 1`;
  const tab = TABS.some(([k]) => k === sp.aba) ? (sp.aba as string) : "visao";

  return (
    <div className="page">
      <div className="crumbs"><Link href="/clientes">Clientes</Link> /</div>
      <div className="page-head">
        <div>
          <h1>{c.name} <Demo on={c.is_demo} /></h1>
          <p className="sub">
            {CLIENT_STATUS[c.status]}
            {c.segment ? ` · ${c.segment}` : ""}
            {" · "}
            {c.squads.length ? c.squads.map((s) => `${s.name}${s.leader ? ` (líder ${s.leader})` : ""}`).join(", ") : "sem squad"}
            {c.owner_name ? ` · conta: ${c.owner_name}` : ""}
          </p>
          <p className="small muted" style={{ marginTop: 2 }}>
            {contract ? <>Escopo: <b>{contract.title}</b> · {contract.status}{contract.start_date ? ` · desde ${contract.start_date.split("-").reverse().join("/")}` : ""}{contract.end_date ? ` até ${contract.end_date.split("-").reverse().join("/")}` : ""}</> : <>Escopo contratado não registrado — <Link href={`/clientes/${id}?aba=escopo`}>registrar</Link></>}
          </p>
        </div>
      </div>
      <Tabs current={tab} items={TABS.map(([k, l]) => ({ key: k, label: l, href: `/clientes/${id}?aba=${k}` }))} />
      {tab === "visao" ? <TabVisao actor={actor} client={c} lens={sp.lente ?? "execucao"} /> : null}
      {tab === "fluxos" ? <TabFluxos actor={actor} client={c} /> : null}
      {tab === "agenda" ? <TabAgenda actor={actor} client={c} /> : null}
      {tab === "historico" ? <TabHistorico client={c} /> : null}
      {tab === "bussola" ? <TabBussola actor={actor} client={c} /> : null}
      {tab === "trimestre" ? <TabTrimestre actor={actor} client={c} /> : null}
      {tab === "relatorios" ? <TabRelatorios actor={actor} client={c} /> : null}
      {tab === "escopo" ? <TabEscopo actor={actor} client={c} /> : null}
    </div>
  );
}
