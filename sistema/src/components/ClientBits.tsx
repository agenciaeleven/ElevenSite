"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copiar texto" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); }}>
      {done ? "✓ Copiado" : label}
    </button>
  );
}

export function PrintButton() {
  return <button type="button" className="btn" onClick={() => window.print()}>Imprimir / salvar PDF</button>;
}

export function NavToggle() {
  return (
    <button type="button" aria-label="Abrir menu" onClick={() => document.querySelector(".shell")?.classList.toggle("nav-open")}>☰ Menu</button>
  );
}
