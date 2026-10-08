"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string; count?: number; sep?: string };

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="nav" onClick={() => document.querySelector(".shell")?.classList.remove("nav-open")}>
      {items.map((i) => {
        const on = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <div key={i.href}>
            {i.sep ? <div className="sep">{i.sep}</div> : null}
            <Link href={i.href} className={on ? "active" : ""}>
              <span aria-hidden>{i.icon}</span> {i.label}
              {i.count ? <span className="count">{i.count}</span> : null}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
