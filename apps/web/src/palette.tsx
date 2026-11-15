import { useEffect, useRef, useState } from "react";
import { KIND_NAME, type DeviceReport } from "@lamplight/core";
import { displayName, keyOf, usePlaces } from "./lib";
import { Glyph } from "./sheets";

export type Action = { id: string; t: string; hint?: string; run: () => void };

/** Ctrl K: jump to any device or do anything, by typing. */
export function Palette({ open, onClose, actions, devices, onPick }: { open: boolean; onClose: () => void; actions: Action[]; devices: DeviceReport[]; onPick: (ip: string) => void }) {
  const places = usePlaces();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ("");
      setI(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);
  if (!open) return null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const items = [
    ...actions.filter((a) => match(`${a.t} ${a.hint ?? ""}`)).map((a) => ({ key: a.id, label: a.t, sub: a.hint, run: a.run, d: undefined as DeviceReport | undefined })),
    ...devices
      .filter((d) => match([displayName(d, places[keyOf(d)]), d.ip, d.mac, d.vendor, d.details?.model, d.details?.name, KIND_NAME[d.kind]].filter(Boolean).join(" ")))
      .map((d) => ({ key: d.ip, label: displayName(d, places[keyOf(d)]), sub: `${KIND_NAME[d.kind]}, ${d.ip}`, run: () => onPick(d.ip), d })),
  ].slice(0, 40);
  const go = (n: number) => {
    const it = items[n];
    if (!it) return;
    onClose();
    it.run();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/50 px-3 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-ui>
      <div className="glass rise w-full max-w-[34rem] overflow-hidden rounded-2xl" role="dialog" aria-modal="true" aria-label="Go to">
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setI((x) => Math.min(items.length - 1, x + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setI((x) => Math.max(0, x - 1));
            } else if (e.key === "Enter") go(i);
            else if (e.key === "Escape") onClose();
          }}
          placeholder="Go to a device or do something…"
          aria-label="Go to a device or do something"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[i] ? `pal-${items[i].key}` : undefined}
          className="h-14 w-full border-b border-line bg-transparent px-4 text-[16px] outline-none placeholder:text-faint"
        />
        <ul id="palette-list" role="listbox" className="scroll-y max-h-[50vh] p-1.5">
          {items.map((it, n) => (
            <li key={it.key} id={`pal-${it.key}`} role="option" aria-selected={n === i}>
              <button className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left ${n === i ? "bg-panel-2" : ""}`} onMouseMove={() => setI(n)} onClick={() => go(n)}>
                {it.d ? <Glyph d={it.d} size={30} /> : <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-accent text-[13px] font-bold text-panel">›</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{it.label}</span>
                  {it.sub && <span className="block truncate text-[12.5px] text-muted">{it.sub}</span>}
                </span>
              </button>
            </li>
          ))}
          {!items.length && <li className="px-3 py-4 text-[14px] text-muted">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
