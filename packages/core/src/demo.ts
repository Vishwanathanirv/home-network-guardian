import type { Details, Internet, Scan } from "./types";

/**
 * A made-up family home, scanned twice a week apart, written out as real `nmap -oX` XML so the
 * demo goes through the same parser as your own scans. MAC prefixes are real vendor prefixes;
 * the rest of each address is invented.
 */

type P = [port: number, service: string, product?: string, version?: string, extra?: string];
type H = { ip: string; mac: string; vendor: string; host?: string; os?: string; ports?: P[]; type?: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function toNmapXml(hosts: H[], when: Date): string {
  const t = Math.floor(when.getTime() / 1000);
  const body = hosts
    .map(
      (h) => `<host starttime="${t - 60}" endtime="${t}"><status state="up" reason="arp-response" reason_ttl="0"/>
<address addr="${h.ip}" addrtype="ipv4"/>
<address addr="${h.mac}" addrtype="mac"${h.vendor ? ` vendor="${esc(h.vendor)}"` : ""}/>
<hostnames>${h.host ? `<hostname name="${esc(h.host)}" type="PTR"/>` : ""}</hostnames>
<ports><extraports state="closed" count="${1000 - (h.ports?.length ?? 0)}"/>
${(h.ports ?? [])
  .map(([port, name, product, version, extra]) => `<port protocol="tcp" portid="${port}"><state state="open" reason="syn-ack" reason_ttl="64"/><service name="${name}"${product ? ` product="${esc(product)}"` : ""}${version ? ` version="${esc(version)}"` : ""}${extra ? ` extrainfo="${esc(extra)}"` : ""}${h.type ? ` devicetype="${esc(h.type)}"` : ""} method="probed" conf="10"/></port>`)
  .join("\n")}
</ports>${h.os ? `<os><osmatch name="${esc(h.os)}" accuracy="92" line="1"/></os>` : ""}
</host>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nmaprun>
<nmaprun scanner="nmap" args="nmap -sV -O -oX scan.xml 192.168.1.0/24" start="${t - 300}" version="7.95" xmloutputversion="1.05">
<scaninfo type="syn" protocol="tcp" numservices="1000" services="1-1000"/>
${body}
<runstats><finished time="${t}" timestr="${when.toUTCString()}" summary="Nmap done" elapsed="300"/><hosts up="${hosts.length}" down="${254 - hosts.length}" total="254"/></runstats>
</nmaprun>
`;
}

const BASE: H[] = [
  { ip: "192.168.1.1", mac: "50:C7:BF:3A:91:0E", vendor: "TP-LINK", host: "router.home", type: "broadband router", os: "Linux 3.10 - 4.11 (embedded)", ports: [[22, "ssh", "Dropbear sshd", "2014.63", "protocol 2.0"], [53, "domain", "dnsmasq", "2.80"], [80, "http", "TP-LINK router http config"], [1900, "upnp", "MiniUPnP", "1.9"]] },
  { ip: "192.168.1.2", mac: "00:11:32:8C:4D:21", vendor: "Synology", host: "diskstation.home", os: "Linux 4.4", ports: [[22, "ssh", "OpenSSH", "8.2", "protocol 2.0"], [80, "http", "nginx"], [139, "netbios-ssn", "Samba smbd", "4.X"], [443, "https", "nginx"], [445, "microsoft-ds", "Samba smbd", "4.X"], [5000, "http", "nginx"], [5001, "https", "nginx"]] },
  { ip: "192.168.1.5", mac: "28:CD:C1:07:5B:EE", vendor: "Raspberry Pi Trading", host: "homeassistant.home", os: "Linux 6.1", ports: [[22, "ssh", "OpenSSH", "9.2p1 Debian 2+deb12u2", "protocol 2.0"], [1883, "mqtt", "Mosquitto", "2.0.18"], [8123, "http", "aiohttp", "3.9.5"]] },
  { ip: "192.168.1.10", mac: "10:00:20:5E:A3:47", vendor: "Apple", host: "annas-macbook-air.home", os: "Apple macOS 14 (Sonoma)", ports: [[5000, "rtsp", "AirTunes rtspd", "760.20.1"], [5900, "vnc", "Apple remote desktop vnc"], [7000, "rtsp", "AirTunes rtspd", "760.20.1"]] },
  { ip: "192.168.1.11", mac: "6A:3F:12:9B:C0:44", vendor: "", host: "iphone.home", ports: [[62078, "iphone-sync"]] },
  { ip: "192.168.1.12", mac: "DA:71:0E:52:19:B3", vendor: "" },
  { ip: "192.168.1.14", mac: "10:65:30:A1:7C:02", vendor: "Dell", host: "ravi-laptop.home", os: "Microsoft Windows 11 21H2", ports: [[135, "msrpc", "Microsoft Windows RPC"], [139, "netbios-ssn", "Microsoft Windows netbios-ssn"], [445, "microsoft-ds"], [3389, "ms-wbt-server", "Microsoft Terminal Services"]] },
  { ip: "192.168.1.20", mac: "64:16:66:2F:88:19", vendor: "Nest Labs", host: "nest-thermostat.home" },
  { ip: "192.168.1.22", mac: "00:04:3C:5D:19:A0", vendor: "Sonos", host: "sonos-living-room.home", ports: [[1400, "http", "Sonos UPnP", "1.0"], [1443, "https"]] },
  { ip: "192.168.1.23", mac: "10:96:93:42:D1:7B", vendor: "Amazon Technologies", host: "echo-kitchen.home", ports: [[8009, "ajp13"]] },
  { ip: "192.168.1.30", mac: "18:80:25:6E:03:9C", vendor: "Hangzhou Hikvision Digital Technology", host: "driveway-cam.home", type: "webcam", ports: [[80, "http", "Hikvision IP camera httpd"], [554, "rtsp", "Hikvision 7513 POE IP camera rtspd"], [8000, "http-alt"]] },
  { ip: "192.168.1.31", mac: "54:9C:6A:11:E7:40", vendor: "Shenzhen Bilian Electronic", host: "ipc-8f2a.home", type: "webcam", os: "Linux 2.6.32 (embedded)", ports: [[23, "telnet", "BusyBox telnetd"], [80, "http", "thttpd", "2.25b"], [554, "rtsp"]] },
  { ip: "192.168.1.40", mac: "18:60:24:B3:6D:15", vendor: "Hewlett Packard", host: "hp-officejet.home", type: "printer", ports: [[80, "http", "HP OfficeJet printer http config"], [443, "https"], [631, "ipp", "HP IPP"], [9100, "jetdirect"]] },
  { ip: "192.168.1.50", mac: "70:89:76:0C:2A:58", vendor: "Tuya Smart", host: "smart-plug-heater.home", ports: [[6668, "unknown"]] },
  { ip: "192.168.1.51", mac: "14:08:08:4B:93:6E", vendor: "Espressif", host: "esp-garden-lights.home", ports: [[80, "http", "ESP8266 httpd"]] },
  { ip: "192.168.1.60", mac: "90:47:48:7D:15:C2", vendor: "Sony Interactive Entertainment", host: "ps5.home" },
];

/** A TV box that turned up this week, with Android debugging left on. */
const NEW_TV_BOX: H = { ip: "192.168.1.24", mac: "1C:A4:10:39:6B:E5", vendor: "Amlogic", host: "android-tv-box.home", type: "media device", os: "Android 9", ports: [[5555, "adb", "Android Debug Bridge", "device"], [8008, "http"], [8009, "ajp13"]] };

const LAST_WEEK = new Date("2026-11-08T21:40:00Z");
const TONIGHT = new Date("2026-11-15T21:40:00Z");

export const DEMO_XML_LAST_WEEK = toNmapXml(BASE.filter((h) => h.ip !== "192.168.1.12").map((h) => (h.ip === "192.168.1.2" ? { ...h, ports: h.ports!.filter((p) => p[0] !== 21) } : h)), LAST_WEEK);
export const DEMO_XML_TONIGHT = toNmapXml(
  [...BASE.map((h) => (h.ip === "192.168.1.2" ? { ...h, ports: [[21, "ftp", "Synology DiskStation NAS ftpd"] as P, ...h.ports!] } : h)), NEW_TV_BOX].sort((a, b) => +a.ip.split(".")[3] - +b.ip.split(".")[3]),
  TONIGHT,
);

/**
 * What the example home's devices say about themselves when the Lamplight scanner asks
 * (Bonjour, UPnP, NetBIOS, their web pages and certificates). nmap doesn't collect these, so
 * they're added on top of the XML above.
 */
export const DEMO_DETAILS: Record<string, Details> = {
  "192.168.1.1": { name: "Archer C6", model: "Archer C6 v2", maker: "TP-Link", web: [{ port: 80, status: 200, title: "TL-Archer C6 login", login: true }], rtt: 2 },
  "192.168.1.2": { name: "DiskStation", model: "DS220+", maker: "Synology Inc.", services: ["_smb._tcp", "_afpovertcp._tcp", "_http._tcp", "_device-info._tcp"], web: [{ port: 5000, status: 200, title: "DiskStation - Synology DiskStation", server: "nginx", login: true }], tls: [{ port: 5001, subject: "synology", issuer: "Synology Inc. CA", expires: "2026-09-30T00:00:00Z" }], rtt: 1 },
  "192.168.1.5": { name: "Home", model: "Raspberry Pi 4 Model B", services: ["_home-assistant._tcp", "_ssh._tcp"], web: [{ port: 8123, status: 200, title: "Home Assistant", server: "Python/3.12 aiohttp/3.9.5", login: true }], rtt: 3 },
  "192.168.1.10": { name: "Anna's MacBook Air", model: "MacBookAir10,1", services: ["_airplay._tcp", "_raop._tcp", "_rfb._tcp", "_companion-link._tcp"], rtt: 6 },
  "192.168.1.11": { name: "Ravi's iPhone", model: "iPhone15,2", services: ["_companion-link._tcp", "_apple-mobdev2._tcp"], rtt: 41 },
  "192.168.1.14": { netbios: { name: "RAVI-LAPTOP", group: "WORKGROUP" }, services: ["_workstation._tcp"], rtt: 4 },
  "192.168.1.20": { rtt: 18 },
  "192.168.1.22": { name: "Living Room", model: "Sonos One SL", maker: "Sonos, Inc.", services: ["_sonos._tcp", "_spotify-connect._tcp", "_airplay._tcp", "_raop._tcp"], rtt: 5 },
  "192.168.1.23": { name: "Kitchen", model: "Echo Dot (4th Gen)", maker: "Amazon", services: ["_spotify-connect._tcp"], rtt: 9 },
  "192.168.1.24": { name: "Living Room TV", model: "X96 Max Plus", services: ["_googlecast._tcp", "_androidtvremote2._tcp"], web: [{ port: 8008, status: 404 }], rtt: 7 },
  "192.168.1.30": { model: "DS-2CD2043G2-I", maker: "Hikvision", web: [{ port: 80, status: 200, title: "Hikvision", server: "App-webs/", login: true }], rtt: 4 },
  "192.168.1.31": { web: [{ port: 80, status: 200, title: "IPCAM", server: "thttpd/2.25b 29dec2003", login: true }], rtt: 12 },
  "192.168.1.40": { name: "HP OfficeJet Pro 9010", model: "OfficeJet Pro 9010 series", maker: "HP", services: ["_ipp._tcp", "_ipps._tcp", "_pdl-datastream._tcp", "_uscan._tcp", "_http._tcp"], web: [{ port: 80, status: 200, title: "HP OfficeJet Pro 9010 series" }], tls: [{ port: 443, subject: "HPA1B2C3", issuer: "HPA1B2C3", expires: "2036-01-01T00:00:00Z", selfSigned: true }], rtt: 8 },
  "192.168.1.50": { rtt: 23 },
  "192.168.1.51": { name: "Garden lights", web: [{ port: 80, status: 200, title: "Garden lights" }], rtt: 15 },
  "192.168.1.60": { rtt: 3 },
};

/** Adds what devices said about themselves to a scan, as the Lamplight scanner would. */
export function withDetails(scan: Scan, details: Record<string, Details>): Scan {
  return { ...scan, devices: scan.devices.map((d) => (details[d.ip] ? { ...d, details: { ...d.details, ...details[d.ip] } } : d)) };
}

/** The example home's connection tonight, as the Lamplight scanner measures it. */
export const DEMO_INTERNET: Internet = {
  routerMs: 2.1,
  internetMs: 18.4,
  jitterMs: 3.2,
  dnsMs: 24,
  nxdomainHijack: true,
  externalIp: "203.0.113.42",
  wifi: { ssid: "Archer_C6", security: "WPA2-Personal" },
  mappings: [
    { protocol: "UDP", externalPort: 9308, internalPort: 9308, client: "192.168.1.60", description: "PS5 Remote Play", enabled: true },
    { protocol: "TCP", externalPort: 8081, internalPort: 80, client: "192.168.1.31", description: "IPCAM", enabled: true },
    { protocol: "TCP", externalPort: 10554, internalPort: 554, client: "192.168.1.31", description: "IPCAM RTSP", enabled: true },
  ],
};
