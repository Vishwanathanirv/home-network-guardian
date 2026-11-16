export type Port = {
  port: number;
  proto: "tcp" | "udp";
  /** Service name as the scanner reported it (http, ssh, telnet…). */
  service?: string;
  product?: string;
  version?: string;
  /** First line a service sent back, or an HTTP Server header. */
  banner?: string;
};

export type Device = {
  ip: string;
  mac?: string;
  /** Vendor from the scan itself (nmap includes one). The OUI table fills it in otherwise. */
  vendor?: string;
  hostname?: string;
  /** nmap's OS guess, or a UPnP/SSDP server string. */
  os?: string;
  ports: Port[];
  /** Free-text hints like SSDP device descriptions. */
  hints?: string[];
  /** What the device said about itself when asked (Lamplight scanner only). */
  details?: Details;
};

/** What a device tells you about itself if you ask nicely: Bonjour, UPnP, NetBIOS, its web page and certificate. */
export type Details = {
  /** The name its owner gave it, like "Living Room TV". */
  name?: string;
  model?: string;
  /** Maker as the device reports it (UPnP), which can differ from the network-card maker. */
  maker?: string;
  /** Bonjour (mDNS) services it announces, like _googlecast._tcp. */
  services?: string[];
  /** Windows computer name and workgroup (NetBIOS). */
  netbios?: { name: string; group?: string };
  /** What its web pages say. */
  web?: { port: number; status?: number; title?: string; server?: string; login?: boolean }[];
  /** Its HTTPS certificates. */
  tls?: { port: number; subject?: string; issuer?: string; expires?: string; selfSigned?: boolean }[];
  /** Fastest answer in milliseconds. */
  rtt?: number;
  /** What the safe, read-only checks proved (no passwords used or guessed). */
  probes?: {
    /** Camera stream: open = it described the video to us without a password. */
    rtsp?: { open: boolean; path?: string };
    /** FTP lets in the public "anonymous" guest. */
    ftpAnon?: boolean;
    /** Still speaks SMBv1, the protocol WannaCry spread through. */
    smb1?: boolean;
  };
};

export type Scan = {
  /** ISO time the scan finished. */
  at: string;
  source: "nmap" | "lamplight" | "arp";
  /** The network scanned, like 192.168.1.0/24. */
  network?: string;
  /** IP of the router, when known (default gateway). */
  gateway?: string;
  devices: Device[];
  /** How the connection to the internet looks from inside (Lamplight scanner only). */
  internet?: Internet;
};

/** A door the router opened to the internet for a device, through UPnP. */
export type Mapping = { protocol: "TCP" | "UDP"; externalPort: number; internalPort: number; client: string; description?: string; enabled?: boolean; lease?: number };

export type Internet = {
  /** Round trip to the router, and to two public servers, in milliseconds. */
  routerMs?: number;
  internetMs?: number;
  jitterMs?: number;
  /** How long a name lookup took, in milliseconds. */
  dnsMs?: number;
  /** True if the router's DNS answers for a name that doesn't exist (redirecting typos to ad pages). */
  nxdomainHijack?: boolean;
  /** The router's address on the internet, as the router reports it over UPnP. */
  externalIp?: string;
  /** Doors the router opened to the internet through UPnP. */
  mappings?: Mapping[];
  /** The Wi-Fi this computer is on and how it's locked, as the computer reports it (e.g. "WPA2-Personal"). */
  wifi?: { ssid?: string; security: string };
};

export type Kind = "router" | "computer" | "phone" | "tv" | "speaker" | "camera" | "printer" | "nas" | "console" | "smart" | "unknown";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export type Issue = {
  id: string;
  severity: Severity;
  /** Device IP, or undefined for whole-network advice. */
  ip?: string;
  title: string;
  /** Plain English: what we saw and why it matters. */
  why: string;
  /** Steps a non-expert can follow. */
  steps: string[];
  port?: number;
  /** A known-vulnerability ID, when this problem matches a published one (e.g. "CVE-2024-6387"). */
  cve?: string;
  /** How we know: "version" = guessed from the version number it reports (a hint); "checked" = proven by a safe test. */
  basis?: "version" | "checked";
};

/* ───────────── Live mode: what the scanner's local server sends the site */

export type LiveEvent = { id: number; at: string; type: "joined" | "left" | "back" | "away" | "opened" | "closed" | "moved" | "scan" | "lag"; ip: string; mac?: string; name?: string; detail?: string };
export type Presence = { ip: string; mac?: string; online: boolean; firstSeen: string; lastSeen: string; since: string; misses: number };
export type LiveState = {
  version: 1;
  started: string;
  network: string;
  scanning: { step: string; pct: number } | null;
  scan: Scan | null;
  presence: Record<string, Presence>;
  events: LiveEvent[];
  health: { at: string; routerMs?: number; internetMs?: number }[];
};
