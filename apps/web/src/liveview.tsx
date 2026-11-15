import { useEffect, useRef, useState } from "react";
import { type DeviceReport, type Port } from "@lamplight/core";
import { peek, useLive, type Fetched } from "./live";

/** Snapshot paths many cameras expose; the first that returns a picture wins. */
const SNAPSHOT_PATHS = ["/snapshot.cgi", "/snap.jpg", "/jpg/image.jpg", "/image/jpeg.cgi", "/cgi-bin/snapshot.cgi", "/axis-cgi/jpg/image.cgi", "/ISAPI/Streaming/channels/101/picture", "/Streaming/channels/1/picture", "/onvifsnapshot/media_service/snapshot", "/tmpfs/auto.jpg", "/webcapture.jpg?command=snap&channel=1", "/image.jpg", "/video.jpg"];

const schemeFor = (p: Port) => (p.port === 443 || p.port === 8443 || p.port === 5001 ? "https" : "http") as "http" | "https";

type Source = { port: number; scheme: "http" | "https"; path: string; label: string };

/** Where we can try to look at this device: its own web pages, and camera snapshot paths. */
function sourcesFor(d: DeviceReport): Source[] {
  const web = d.ports.filter((p) => p.proto === "tcp" && (d.details?.web?.some((w) => w.port === p.port) || [80, 443, 8080, 8443, 8000, 8008, 5000, 5001, 8123, 1400, 49152].includes(p.port)));
  const pages: Source[] = web.map((p) => ({ port: p.port, scheme: schemeFor(p), path: "/", label: `Page on port ${p.port}` }));
  if (d.kind !== "camera") return pages;
  const camPorts = d.ports.filter((p) => p.proto === "tcp" && [80, 8080, 8000, 81, 8081].includes(p.port));
  const shots = camPorts.flatMap((p) => SNAPSHOT_PATHS.map((path) => ({ port: p.port, scheme: schemeFor(p), path, label: `Snapshot ${path}` })));
  return [...shots, ...pages];
}

const open = (ip: string, s: Source) => `${s.scheme}://${ip}:${s.port}${s.path}`;

export function LiveView({ d }: { d: DeviceReport }) {
  const lv = useLive();
  const live = lv.status !== "off";
  const sources = sourcesFor(d);
  const webPages = sources.filter((s) => s.path === "/");
  const [img, setImg] = useState<{ src: string; from: Source } | null>(null);
  const [page, setPage] = useState<(Fetched & { from: Source }) | null>(null);
  const [state, setState] = useState<"idle" | "looking" | "none">("idle");
  const [live2, setLive2] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Try each source in turn; the first picture becomes the view, else the first page that answers.
  async function look() {
    setState("looking");
    setImg(null);
    setPage(null);
    let firstPage: (Fetched & { from: Source }) | null = null;
    for (const s of sources) {
      const r = await peek(d.ip, s.port, s.scheme, s.path);
      if ("error" in r) continue;
      if (r.dataUrl) {
        setImg({ src: r.dataUrl, from: s });
        setPage(null);
        setState("idle");
        return;
      }
      if (!firstPage && r.status < 400 && s.path === "/") firstPage = { ...r, from: s };
    }
    setPage(firstPage);
    setState(firstPage ? "idle" : "none");
  }

  // Refresh a camera snapshot every couple of seconds, like a slow live feed.
  useEffect(() => {
    clearTimeout(timer.current);
    if (!live2 || !img) return;
    const tick = async () => {
      const r = await peek(d.ip, img.from.port, img.from.scheme, img.from.path);
      if (!("error" in r) && r.dataUrl) setImg({ src: r.dataUrl, from: img.from });
      timer.current = setTimeout(tick, 2500);
    };
    timer.current = setTimeout(tick, 2500);
    return () => clearTimeout(timer.current);
  }, [live2, img, d.ip]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!sources.length) return <p className="text-[14px] text-muted">This device has no web page or video to look at.</p>;

  return (
    <div className="space-y-3">
      {!live ? (
        <div className="rounded-xl bg-panel-2 p-3 text-[13.5px] text-muted">
          A web page can't reach your devices, but the scanner on your computer can.{" "}
          <a href="/live" className="font-semibold text-accent">
            Turn on live mode
          </a>{" "}
          to peek at this {d.kind === "camera" ? "camera" : "device"} from here. You can still open its page directly:
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn primary" disabled={state === "looking"} onClick={look}>
            {state === "looking" ? "Looking…" : d.kind === "camera" ? "Try to view this camera" : "Load its page"}
          </button>
          {img && d.kind === "camera" && (
            <button className="btn" aria-pressed={live2} onClick={() => setLive2(!live2)}>
              {live2 ? "Stop refreshing" : "Keep it live"}
            </button>
          )}
        </div>
      )}

      {img && (
        <figure className="overflow-hidden rounded-xl border border-line bg-black">
          <img src={img.src} alt={`Snapshot from ${d.ip}`} className="max-h-[60vh] w-full object-contain" />
          <figcaption className="flex items-center justify-between gap-2 bg-panel px-3 py-2 text-[12.5px]">
            <span className={d.kind === "camera" ? "font-semibold text-risk" : "text-muted"}>{d.kind === "camera" ? "This camera is open — no password needed to see it." : "Image from the device"}</span>
            {live2 && <span className="flex items-center gap-1.5 text-ok"><span className="h-2 w-2 animate-pulse rounded-full bg-ok" />live</span>}
          </figcaption>
        </figure>
      )}

      {page && !img && (
        <div className="rounded-xl border border-line p-3">
          <div className="font-semibold">{page.title || "Its web page"}</div>
          <div className="mt-0.5 text-[13px] text-muted">
            Answered {page.status}
            {page.server ? `, runs ${page.server}` : ""}. {d.kind === "camera" ? "The camera served a page, not a picture — it probably wants a password to view the video." : "Open it to see the full page."}
          </div>
          <a className="btn mt-2.5 inline-flex" href={open(d.ip, page.from)} target="_blank" rel="noreferrer">
            Open the full page
          </a>
        </div>
      )}

      {state === "none" && <p className="text-[13.5px] text-muted">Nothing answered that could be shown here. The device may need a password, or only stream video (RTSP), which a browser can't play. Try opening its page below.</p>}

      {webPages.length > 0 && (
        <div>
          <h4 className="text-[12px] font-bold text-faint">Open directly (on the same Wi-Fi)</h4>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {webPages.map((s) => (
              <li key={s.port}>
                <a className="rounded-full border border-line px-3 py-1 text-[13px] font-semibold hover:border-faint" href={open(d.ip, s)} target="_blank" rel="noreferrer">
                  {s.scheme}://{d.ip}:{s.port}
                </a>
              </li>
            ))}
          </ul>
          {d.kind === "camera" && <p className="mt-2 text-[12.5px] text-faint">If the page asks for a login you've never set, the camera still has its factory password — change it tonight.</p>}
        </div>
      )}
    </div>
  );
}
