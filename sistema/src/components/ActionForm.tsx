"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export type ActionResult = { ok?: string; error?: string; at?: number } | null;
type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Formulário com server action: mostra erro de regra de negócio inline e um aviso de sucesso discreto. */
export function ActionForm({ action, children, className, reset, confirm, id, style }: { action: Action; children: ReactNode; className?: string; reset?: boolean; confirm?: string; id?: string; style?: React.CSSProperties }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (state?.ok) {
      if (reset) ref.current?.reset();
      setToast(state.ok);
      const t = setTimeout(() => setToast(null), 2600);
      return () => clearTimeout(t);
    }
  }, [state, reset]);
  return (
    <form
      ref={ref}
      id={id}
      action={formAction}
      className={className}
      style={style}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state?.error ? <div className="form-error" role="alert">{state.error}</div> : null}
      {toast ? <div className="toast" role="status">✓ {toast}</div> : null}
    </form>
  );
}

export function Submit({ children, className = "btn primary", pendingText = "Salvando…", name, value }: { children: ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}

/** Select que envia o formulário ao mudar (ex.: status inline). */
export function AutoSelect({ name, defaultValue, options, className = "inline", ariaLabel }: { name: string; defaultValue: string; options: [string, string][]; className?: string; ariaLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <select name={name} defaultValue={defaultValue} className={className} aria-label={ariaLabel} disabled={pending} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
