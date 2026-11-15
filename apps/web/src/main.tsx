import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource/architects-daughter";
import "@fontsource-variable/red-hat-mono";
import "./index.css";
import { useTheme } from "./lib";
import { Changes } from "./pages/Changes";
import { House } from "./pages/House";
import { How } from "./pages/How";
import { Scans } from "./pages/Scans";

const NAV = [
  { to: "/", t: "The house" },
  { to: "/changes", t: "What changed" },
  { to: "/scans", t: "Scan your home" },
  { to: "/how", t: "How it works" },
];

function ThemeSwitch() {
  const [t, set] = useTheme();
  const next = t === "auto" ? "night" : t === "night" ? "day" : "auto";
  return (
    <button className="text-sm font-semibold text-muted hover:text-ink" onClick={() => set(next)} title="Switch between day, night and your system setting">
      {t === "auto" ? "Light: automatic" : t === "night" ? "Light: night" : "Light: day"}
    </button>
  );
}

function Shell() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/" className="mr-auto flex items-center gap-2.5 md:mr-0 text-[1.35rem] font-bold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            Lamplight
          </Link>
          <nav className="-mx-1 order-last flex w-full gap-1 overflow-x-auto px-1 md:order-none md:w-auto md:flex-1" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => `shrink-0 rounded-md px-3 py-1.5 text-[15px] font-semibold ${isActive ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
                {n.t}
              </NavLink>
            ))}
          </nav>
          <ThemeSwitch />
          <a href="https://github.com/Vishwanathanirv/home-network-guardian" className="hidden text-sm font-semibold text-muted hover:text-ink sm:block">
            Source on GitHub
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<House />} />
          <Route path="/changes" element={<Changes />} />
          <Route path="/scans" element={<Scans />} />
          <Route path="/how" element={<How />} />
          <Route path="*" element={<p className="text-muted">There's no room here. Go back to the house.</p>} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-[1360px] px-4 pb-8 text-xs text-faint sm:px-6">
        Built by{" "}
        <a href="https://vishwanathan.dev" className="text-muted underline underline-offset-4">
          Vishwanathan R
        </a>
        . The example home is made up. Your scans stay in your browser. Vendor names from the IEEE OUI registry.
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </StrictMode>,
);
