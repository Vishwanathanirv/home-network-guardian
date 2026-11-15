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
};
