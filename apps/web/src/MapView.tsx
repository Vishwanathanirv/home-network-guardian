import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";

export type Insets = { l: number; t: number; r: number; b: number };
export type MapHandle = {
  fit: () => void;
  zoomBy: (f: number) => void;
  /** Bring a point (in the content's own pixels) to the middle of the free space. */
  focus: (x: number, y: number) => void;
};
type Cam = { x: number; y: number; k: number };

/**
 * A pan-and-zoom surface like a maps app: drag to pan, wheel or pinch to zoom around the
 * pointer, two-finger scroll on a trackpad to pan. Anything marked data-device or a button
 * keeps its own pointer events, so devices can still be dragged between rooms.
 */
export function MapView({ w, h, insets, children, ref }: { w: number; h: number; insets: Insets; children: ReactNode; ref?: Ref<MapHandle> }) {
  const box = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, k: 1 });
  const [glide, setGlide] = useState(false);
  const touched = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; d: number } | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;

  const size = () => {
    const r = box.current?.getBoundingClientRect();
    return { vw: r?.width ?? 1, vh: r?.height ?? 1 };
  };
  const fitK = useCallback(() => {
    const { vw, vh } = size();
    return Math.max(0.15, Math.min((vw - insets.l - insets.r - 32) / w, (vh - insets.t - insets.b - 32) / h));
  }, [w, h, insets]);
  const clamp = useCallback(
    (c: Cam): Cam => {
      const { vw, vh } = size();
      const k = Math.min(4, Math.max(fitK() * 0.5, c.k));
      // Keep at least a corner of the house on screen.
      const m = 120;
      const x = Math.min(vw - m, Math.max(m - w * k, c.x));
      const y = Math.min(vh - m, Math.max(m - h * k, c.y));
      return { x, y, k };
    },
    [fitK, w, h],
  );
  const animate = (c: Cam) => {
    setGlide(true);
    setCam(clamp(c));
    window.setTimeout(() => setGlide(false), 360);
  };
  const fit = useCallback(() => {
    const { vw, vh } = size();
    const k = fitK();
    return { k, x: insets.l + (vw - insets.l - insets.r - w * k) / 2, y: insets.t + (vh - insets.t - insets.b - h * k) / 2 };
  }, [fitK, insets, w, h]);
  const zoomAt = (px: number, py: number, f: number, c = camRef.current) => {
    const k = Math.min(4, Math.max(fitK() * 0.5, c.k * f));
    const r = k / c.k;
    return { k, x: px - (px - c.x) * r, y: py - (py - c.y) * r };
  };

  useImperativeHandle(ref, () => ({
    fit: () => {
      touched.current = false;
      animate(fit());
    },
    zoomBy: (f) => {
      const { vw, vh } = size();
      touched.current = true;
      animate(zoomAt(insets.l + (vw - insets.l - insets.r) / 2, insets.t + (vh - insets.t - insets.b) / 2, f));
    },
    focus: (x, y) => {
      const { vw, vh } = size();
      const k = Math.min(2.2, Math.max(camRef.current.k, fitK() * 1.5));
      touched.current = true;
      animate({ k, x: insets.l + (vw - insets.l - insets.r) / 2 - x * k, y: insets.t + (vh - insets.t - insets.b) / 2 - y * k });
    },
  }));

  // Fit on load, and again when the window or the free space changes, until you move the map.
  useEffect(() => {
    const go = () => !touched.current && setCam(fit());
    go();
    const ro = new ResizeObserver(go);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [fit]);

  // Wheel: zoom with a mouse wheel or a pinch on a trackpad, pan with two-finger scrolling.
  useEffect(() => {
    const el = box.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      touched.current = true;
      const r = el.getBoundingClientRect();
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || mouseWheel) setCam(clamp(zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)))));
      else setCam((c) => clamp({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  const free = (t: EventTarget) => !(t as Element).closest?.("[data-device],button,a,input,select,textarea,[data-ui]");

  return (
    <div
      ref={box}
      className="vellum absolute inset-0 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
      style={{ backgroundPosition: `${cam.x}px ${cam.y}px`, backgroundSize: `${24 * cam.k}px ${24 * cam.k}px` }}
      onPointerDown={(e) => {
        if (!free(e.target)) return;
        box.current!.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        last.current = null;
      }}
      onPointerMove={(e) => {
        const p = pointers.current;
        if (!p.has(e.pointerId)) return;
        p.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pts = [...p.values()];
        const r = box.current!.getBoundingClientRect();
        const mx = pts.reduce((s, q) => s + q.x, 0) / pts.length - r.left;
        const my = pts.reduce((s, q) => s + q.y, 0) / pts.length - r.top;
        const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
        const prev = last.current;
        last.current = { x: mx, y: my, d };
        if (!prev) return;
        touched.current = true;
        setCam((c) => {
          let n = { ...c, x: c.x + mx - prev.x, y: c.y + my - prev.y };
          if (d && prev.d) n = zoomAt(mx, my, d / prev.d, n);
          return clamp(n);
        });
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        last.current = null;
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        last.current = null;
      }}
      onDoubleClick={(e) => {
        if (!free(e.target)) return;
        const r = box.current!.getBoundingClientRect();
        touched.current = true;
        animate(zoomAt(e.clientX - r.left, e.clientY - r.top, e.shiftKey ? 1 / 1.6 : 1.6));
      }}
    >
      <div className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`, transition: glide ? "transform 0.34s cubic-bezier(.2,.8,.2,1)" : undefined }}>
        {children}
      </div>
    </div>
  );
}
