import { useEffect, useRef, useState } from "react";

const SEEN_KEY = "lamplight-briefed";

/** Whether to open on the briefing: the first visit only, remembered in this browser. */
export function useBriefing(): [boolean, (show: boolean) => void] {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setShow(v);
    if (!v)
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* private window: show it again next time */
      }
  };
  return [show, set];
}

/** A house at night with one window lit: the picture of the idea. */
function House() {
  return (
    <svg viewBox="0 0 320 120" className="h-auto w-full max-w-sm" aria-hidden>
      <path d="M40 60 160 12l120 48v52H40z" fill="var(--room)" stroke="var(--wall)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M40 60h240M160 12v100M100 60v52M220 60v52" stroke="var(--line)" strokeWidth="1.5" />
      {(
        [
          [70, 84, "var(--ok)"],
          [130, 84, "var(--ok)"],
          [190, 84, "var(--warn)"],
          [250, 84, "var(--risk)"],
          [130, 40, "var(--ok)"],
          [190, 40, "var(--ok)"],
        ] as const
      ).map(([x, y, c], i) => (
        <circle key={i} className={c === "var(--risk)" ? "lamp-risk" : undefined} cx={x} cy={y} r="6" fill={c} />
      ))}
      <circle className="lamp-halo" cx="250" cy="84" r="16" fill="none" stroke="var(--risk)" strokeWidth="2" />
    </svg>
  );
}

/** The idea, on the first screen, over the example home, with the worst problem one click away. */
export function Briefing({ onTry, onHow, onScan, onClose }: { onTry: () => void; onHow: () => void; onScan: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
      const wrapTo = e.shiftKey ? (document.activeElement === f[0] ? f.at(-1) : null) : document.activeElement === f.at(-1) ? f[0] : null;
      if (wrapTo) {
        e.preventDefault();
        wrapTo.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--bg)_78%,transparent)] p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
      <div ref={ref} className="rise w-full max-w-2xl rounded-3xl border border-line px-5 py-6 shadow-[var(--shadow)] sm:px-8 sm:py-7" style={{ background: "var(--panel)" }}>
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-faint">Lamplight · your home network, lit up</p>
        <h1 id="briefing-title" className="mt-2 text-[clamp(1.7rem,4.6vw,2.5rem)] font-bold leading-[1.08] tracking-[-0.02em]">
          See every device in your home, and <span className="text-[var(--lamp)]">which one to fix tonight.</span>
        </h1>
        <div className="mt-4">
          <House />
        </div>
        <dl className="mt-4 grid gap-4 text-[14.5px] leading-relaxed sm:grid-cols-3">
          <div>
            <dt className="font-bold">The problem</dt>
            <dd className="mt-1 text-muted">A home has dozens of things on its Wi-Fi: cameras, TVs, printers, plugs. Nobody knows what half of them are, and network scanners answer in port numbers.</dd>
          </div>
          <div>
            <dt className="font-bold">The idea</dt>
            <dd className="mt-1 text-muted">Put every device on a floor plan of your house, in the room it lives in, lit by how risky it is, with the fix written as steps anyone can follow.</dd>
          </div>
          <div>
            <dt className="font-bold">Why it's different</dt>
            <dd className="mt-1 text-muted">It names devices by asking them six ways, proves the worst problems with safe read-only checks, never uses a password, and keeps every scan on your computer.</dd>
          </div>
        </dl>
        <p className="mt-4 text-[13.5px] text-muted">Behind this card is a made-up example home. Scan your own whenever you like; nothing leaves your computer.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button data-autofocus className="btn primary h-11 px-5 text-[15px]" onClick={onTry}>
            Show me tonight's worst problem →
          </button>
          <button className="btn h-11 px-4 text-[15px]" onClick={onHow}>
            How it works
          </button>
          <button className="btn h-11 px-4 text-[15px]" onClick={onScan}>
            Scan my home
          </button>
        </div>
        <button className="mt-4 text-[13px] text-faint underline-offset-4 hover:text-ink hover:underline" onClick={onClose}>
          Explore the example home <kbd className="ml-1 rounded border border-line px-1 font-mono text-[11px]">Esc</kbd>
        </button>
      </div>
    </div>
  );
}
