import { classify, KIND_NAME } from "./classify";
import type { Device, Issue, Kind, Port, Scan, Severity } from "./types";
import { SEVERITY_RANK } from "./types";
import { isPrivate } from "./parse";

/** 100.64.0.0/10: addresses internet providers share between many homes. */
export const isCgnat = (ip: string) => {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
};

/** What a port is, in words a non-expert understands. */
export const SERVICE: Record<number, string> = {
  21: "File transfer (FTP)",
  22: "Remote command line (SSH)",
  23: "Remote command line, unencrypted (Telnet)",
  25: "Email sending (SMTP)",
  53: "Name lookups (DNS)",
  80: "Web page (HTTP)",
  139: "Windows file sharing (old)",
  443: "Secure web page (HTTPS)",
  445: "Windows file sharing (SMB)",
  515: "Printing (LPD)",
  548: "Mac file sharing (AFP)",
  554: "Video stream (RTSP)",
  631: "Printing (IPP)",
  1400: "Sonos control",
  1883: "Smart-home messages, unencrypted (MQTT)",
  1900: "Plug-and-play discovery (UPnP)",
  2323: "Remote command line, unencrypted (Telnet)",
  3306: "Database (MySQL)",
  3389: "Remote desktop (RDP)",
  5000: "Web admin or UPnP",
  5001: "Secure web admin",
  5353: "Device discovery (mDNS)",
  5432: "Database (PostgreSQL)",
  5555: "Android debugging (ADB)",
  5900: "Remote screen (VNC)",
  6379: "Database (Redis)",
  6668: "Tuya smart-home control",
  7000: "AirPlay",
  8008: "Chromecast",
  8009: "Chromecast",
  8080: "Web page (HTTP)",
  8443: "Secure web page (HTTPS)",
  8554: "Video stream (RTSP)",
  8883: "Smart-home messages (MQTT over TLS)",
  9100: "Printing (raw)",
  27017: "Database (MongoDB)",
  32400: "Plex media server",
  49152: "Plug-and-play control (UPnP)",
  62078: "iPhone sync",
};

export const serviceName = (p: Port) => SERVICE[p.port] ?? (p.service ? `${p.service[0].toUpperCase()}${p.service.slice(1)}` : `Port ${p.port}`);

const GUEST = "Put it on your router's guest network (most routers have one in the Wi-Fi settings), so it can reach the internet but not your computers and phones.";
const UPDATE = "Update its software: check the maker's app, or its settings page, for a firmware update.";

/** Compares dotted version strings: -1, 0 or 1. */
function cmp(a: string, b: string) {
  const x = a.split(/[.p]/).map((n) => parseInt(n, 10) || 0);
  const y = b.split(/[.p]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}

/** Software versions with well-known, actively exploited holes. Deliberately short and certain. */
function knownBad(p: Port): { title: string; why: string; severity: Severity } | undefined {
  const product = `${p.product ?? ""} ${p.banner ?? ""}`;
  const v = (p.version ?? product).match(/\d+(?:\.\d+)+(?:p\d+)?/)?.[0];
  if (/vsftpd/i.test(product) && /2\.3\.4/.test(`${p.version ?? ""} ${product}`)) return { severity: "critical", title: "Backdoored FTP server", why: "vsftpd 2.3.4 is the release that was shipped with a hidden backdoor: anyone can get a root command line on this device." };
  if (/openssh/i.test(product) && v && cmp(v, "8.5p1") >= 0 && cmp(v, "9.8") < 0) {
    // Distributions patch old versions without changing the number, so we can't be sure.
    const distro = /debian|ubuntu|el\d|fedora|alpine|raspbian/i.test(`${p.version ?? ""} ${product}`);
    return { severity: distro ? "medium" : "high", title: `OpenSSH ${v} may have the "regreSSHion" hole`, why: `OpenSSH 8.5p1 to 9.7p1 has a bug (CVE-2024-6387) that can let an attacker run code as root without logging in.${distro ? " Linux distributions fixed it without changing the version number, so if this machine has had its updates since July 2024 it is already safe." : ""}` };
  }
  if (/dropbear/i.test(product) && v && cmp(v, "2016.74") < 0) return { severity: "high", title: `Old Dropbear SSH (${v})`, why: "Dropbear versions before 2016.74 have known holes that allow running code. Devices this old are rarely updated." };
  if (/samba/i.test(product) && v && cmp(v, "3.5.0") >= 0 && cmp(v, "4.6.4") <= 0) return { severity: "critical", title: `Samba ${v} has the "SambaCry" hole`, why: "Samba 3.5.0 to 4.6.4 lets anyone who can write to a share run code on the device (CVE-2017-7494). It was used by worms." };
  return undefined;
}

export type DeviceReport = Device & { kind: Kind; vendor?: string; confidence: "sure" | "likely" | "guess"; reasons: string[]; issues: Issue[]; worst: Severity | null; /** A friendly, numbered display name, filled in by the app. */ label?: string };

export function checkDevice(d: Device, gateway?: string): DeviceReport {
  const c = classify(d, gateway);
  const kind = c.kind;
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, "ip">) => issues.push({ ...i, ip: d.ip });
  const has = (n: number) => d.ports.find((p) => p.port === n && p.proto === "tcp");
  const what = kind === "unknown" ? "this device" : `this ${KIND_NAME[kind].toLowerCase()}`;
  const isServerish = kind === "computer" || kind === "nas";

  for (const p of d.ports) {
    const bad = knownBad(p);
    if (bad) add({ id: "outdated", severity: bad.severity, title: bad.title, why: bad.why, steps: [UPDATE, kind === "router" ? "If the maker no longer offers updates, replace the router. Internet providers often send a new one for free if you ask." : kind === "computer" ? "Install the system updates (on Linux: sudo apt update && sudo apt upgrade)." : "If no update exists, unplug it from the network until you can replace it."], port: p.port });
  }

  const telnet = has(23) ?? has(2323);
  if (telnet)
    add({
      id: "telnet",
      severity: "critical",
      port: telnet.port,
      title: "Telnet is open",
      why: `Telnet is a remote command line with no encryption, and on gadgets it usually has a factory password. Botnets like Mirai take over devices exactly this way, by trying a list of default passwords.`,
      steps: [`Change ${what}'s password in its app or settings page, if it has one.`, "Look for a setting to turn off Telnet.", UPDATE, `If none of that is possible, ${GUEST.charAt(0).toLowerCase()}${GUEST.slice(1)}`],
    });

  if (has(5555))
    add({
      id: "adb",
      severity: "critical",
      port: 5555,
      title: "Android debugging is open to the network",
      why: "Android Debug Bridge on the network gives anyone on your Wi-Fi full control of the device with no password: installing apps, reading files, watching the screen. Crypto-mining worms spread through it.",
      steps: ["On the device, open Settings, then Developer options, and turn off \"ADB debugging\" or \"Network debugging\".", "If there's no Developer options menu, check for a firmware update or a factory reset from the maker."],
    });

  const ftp = has(21);
  if (ftp && !issues.some((i) => i.port === 21))
    add({ id: "ftp", severity: isServerish ? "medium" : "high", port: 21, title: "FTP file sharing is on", why: "FTP sends usernames, passwords and files without encryption, so anything on the network can read them. It's also a common way in on cameras and routers.", steps: [kind === "nas" ? "In the storage's settings, turn off FTP and use SMB or SFTP instead." : `Turn off FTP in ${what}'s settings.`, UPDATE] });

  for (const n of [5900, 5901, 5902])
    if (has(n)) {
      add({ id: "vnc", severity: "high", port: n, title: "Remote screen sharing (VNC) is on", why: "VNC shows and controls the screen from anywhere on the network. Many setups use a short password or none at all.", steps: ["If you don't use it, turn off Screen Sharing / Remote Management (Mac) or uninstall the VNC server.", "If you do, set a long password and never forward this port on your router."] });
      break;
    }

  if (has(3389)) add({ id: "rdp", severity: "medium", port: 3389, title: "Remote desktop is on", why: "Fine inside the house with a strong password, but remote desktop is one of the most attacked services if it ever becomes reachable from the internet.", steps: ["If you don't use it: Settings, System, Remote Desktop, turn it off.", "Make sure your router doesn't forward port 3389.", "Use a long password on the Windows account."] });

  if ((has(445) || has(139)) && !isServerish)
    add({ id: "smb", severity: "medium", port: has(445) ? 445 : 139, title: "File sharing on a gadget", why: `Windows file sharing on ${what} is unusual. It often means an old, rarely updated file server, which is how worms like WannaCry spread.`, steps: [`Turn off file sharing ("SMB" or "Samba") in ${what}'s settings if you don't use it.`, UPDATE] });

  if (has(554) || has(8554)) add({ id: "rtsp", severity: "medium", port: has(554) ? 554 : 8554, title: "Camera video stream is open", why: "The live video can be opened by anything on your network with the camera's stream password, which is often the factory default.", steps: ["Change the camera's password in its app (not just your app account password).", "Turn off RTSP or \"local streaming\" if you only watch through the app.", GUEST] });

  if (has(1883)) add({ id: "mqtt", severity: "medium", port: 1883, title: "Unencrypted smart-home messages", why: "MQTT on port 1883 has no encryption and often no password, so anything on the network can read your sensors or switch your devices.", steps: ["Set a username and password on the MQTT broker (in Home Assistant: the Mosquitto add-on's settings).", "Use port 8883 with TLS if the devices support it."] });

  for (const n of [3306, 5432, 6379, 27017])
    if (has(n)) add({ id: "database", severity: "medium", port: n, title: `${SERVICE[n]} is reachable`, why: "A database answering on the network is a common leftover from a project. Redis and MongoDB in particular often have no password by default.", steps: ["If it's a development project, set it to listen on 127.0.0.1 only.", "Otherwise make sure it has a password and isn't forwarded by the router."] });

  const upnp = d.ports.find((p) => p.port === 1900 || p.port === 49152 || /upnp/i.test(`${p.service} ${p.product}`));
  if (kind === "router" && upnp)
    add({ id: "upnp", severity: "medium", port: upnp.port, title: "UPnP is on", why: "UPnP lets any device in the house open a door in your router to the internet, with no password. A hacked gadget can use it to make itself reachable from outside.", steps: ["Open your router's settings (usually the address printed on its label) and turn off UPnP. It's often under Advanced, NAT or Port forwarding.", "If a games console then complains about NAT type, forward only the ports it needs."] });

  if (kind === "router") {
    const ssh = has(22);
    if (ssh) add({ id: "router-ssh", severity: "low", port: 22, title: "The router has a command line open", why: "SSH on a router is fine if you set it up yourself. If you didn't, it's an extra way in that probably still has the factory password.", steps: ["In the router's settings, turn off SSH if you don't use it.", "Change the router's admin password from the one on the label."] });
    if (has(80) && !has(443)) add({ id: "router-http", severity: "low", port: 80, title: "Router settings page isn't encrypted", why: "The admin password is sent in plain text when you log in to the router, so anything on the Wi-Fi can capture it.", steps: ["Turn on HTTPS for the admin page if the router offers it.", "Change the admin password from the one printed on the label.", "Only change router settings from a wired connection or a network you trust."] });
  } else if ((kind === "camera" || kind === "smart" || kind === "nas" || kind === "printer") && (has(80) || has(8080)) && !has(443) && !has(8443)) {
    add({ id: "http-admin", severity: "low", port: has(80) ? 80 : 8080, title: "Settings page isn't encrypted", why: `${what[0].toUpperCase()}${what.slice(1)} has a web page for its settings with no encryption, so its password crosses the network in plain text.`, steps: [`Change ${what}'s admin password from the default.`, "Turn on HTTPS in its settings if it offers it."] });
  }

  // What the device's own web pages and certificates say.
  const now = Date.now();
  for (const t of d.details?.tls ?? [])
    if (t.expires && Date.parse(t.expires) < now)
      add({ id: "cert-expired", severity: "low", port: t.port, title: "Its security certificate has expired", why: `The HTTPS certificate on port ${t.port} ran out on ${new Date(t.expires).toDateString()}. Browsers will warn every time, which teaches everyone to click through warnings, and it often means the device stopped getting updates.`, steps: [UPDATE, "Many devices renew the certificate after an update or a restart."] });
  const login = d.details?.web?.find((w) => w.login && ![443, 5001, 8443].includes(w.port));
  if (login && !issues.some((i) => i.id === "router-http" || i.id === "http-admin"))
    add({ id: "login-http", severity: "low", port: login.port, title: "A login page without encryption", why: `${what[0].toUpperCase()}${what.slice(1)} has a login page${login.title ? ` ("${login.title}")` : ""} on plain HTTP, so the password crosses the network readable by anything on the Wi-Fi.`, steps: ["Change its password from the default.", "Turn on HTTPS in its settings if it offers it, and use that address instead."] });

  if ((kind === "unknown" || c.confidence === "guess") && !d.hostname && !d.details?.name)
    add({ id: "unknown", severity: "low", title: "Do you know what this is?", why: d.ports.length ? "Nothing says what this device is. It's worth checking it's yours." : "Nothing says what this device is, and it has no open services to identify it by. Most often it's a phone or laptop with a private address, but check.", steps: ["Look in your router's app or settings for its list of connected devices; it often shows names.", "Unplug or turn off devices one at a time and scan again to see which one disappears.", "If it isn't yours, change your Wi-Fi password and reconnect your own devices."] });

  issues.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return { ...d, kind, vendor: c.vendor, confidence: c.confidence, reasons: c.why, issues, worst: issues[0]?.severity ?? null };
}

export type Report = { scan: Scan; devices: DeviceReport[]; network: Issue[]; issues: Issue[] };

export function analyse(scan: Scan): Report {
  const gateway = scan.gateway ?? guessGateway(scan);
  const devices = scan.devices.map((d) => checkDevice(d, gateway));
  const network: Issue[] = [];
  const gadgets = devices.filter((d) => ["camera", "smart", "tv", "speaker"].includes(d.kind));
  const people = devices.filter((d) => ["computer", "phone", "nas"].includes(d.kind));
  if (gadgets.length >= 3 && people.length)
    network.push({
      id: "guest-network",
      severity: gadgets.some((g) => g.worst && SEVERITY_RANK[g.worst] >= 3) ? "medium" : "low",
      title: `${gadgets.length} smart gadgets share a network with your computers`,
      why: "Cheap gadgets get few updates. If one is taken over, it can reach every laptop, phone and shared folder on the same network.",
      steps: ["Turn on your router's guest network (or a separate \"IoT\" network).", "Reconnect the TV, speakers, cameras and plugs to it. Casting from your phone may need the phone on the same network, so keep the TV where you cast from.", "Keep computers, phones and storage on the main network."],
    });
  // Doors the router opened to the internet through UPnP, on the device they lead to.
  const net = scan.internet;
  const cgnat = !!net?.externalIp && (isPrivate(net.externalIp) || isCgnat(net.externalIp));
  const DANGER = new Set([21, 22, 23, 445, 554, 2323, 3389, 5555, 5900, 8554]);
  for (const m of net?.mappings ?? []) {
    if (m.enabled === false) continue;
    const d = devices.find((x) => x.ip === m.client);
    const svc = SERVICE[m.internalPort] ?? `port ${m.internalPort}`;
    // Games consoles open ports for online play on purpose; a camera or a computer doing it is another matter.
    const severity: Severity = cgnat ? "low" : DANGER.has(m.internalPort) ? "critical" : d?.kind === "console" ? "medium" : "high";
    const issue: Issue = {
      id: "upnp-mapping",
      severity,
      ip: m.client,
      port: m.internalPort,
      title: `Open to the internet: ${svc}`,
      why: `The router has a door open from the internet (${m.protocol} port ${m.externalPort}) straight to ${d ? `this ${KIND_NAME[d.kind].toLowerCase()}` : m.client}${m.description ? `, opened by "${m.description}"` : ""}. Anyone on the internet can knock on it, and scanners do, all day.${cgnat ? " Your internet provider shares one internet address between many homes (carrier-grade NAT), so the door probably doesn't reach the real internet; it will if your provider ever gives you your own address." : ""}`,
      steps: [`In the device's app or settings, turn off "remote access", "UPnP" or "port forwarding" if you don't need to reach it from outside.`, "Or turn off UPnP on the router, which closes every door it opened (games consoles may then need one port forwarded by hand).", "If you do need it from outside, use the maker's cloud app or a VPN instead of an open port."],
    };
    if (d) {
      d.issues.push(issue);
      d.issues.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
      d.worst = d.issues[0].severity;
    } else network.push(issue);
  }
  if (net?.nxdomainHijack)
    network.push({ id: "dns-hijack", severity: "low", title: "Your router's DNS makes up answers", why: "When you look up a website that doesn't exist, your router (or your internet provider behind it) answers anyway, usually to show you an ad page. It means something is rewriting your name lookups, which also breaks some security tools and leaks your typos.", steps: ["In the router's settings, look for \"DNS assist\", \"search assist\" or \"error redirect\" and turn it off.", "Or set the router's DNS servers to 1.1.1.1 and 8.8.8.8 (or 9.9.9.9 for one that blocks known bad sites)."] });

  const issues = [...devices.flatMap((d) => d.issues), ...network].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return { scan: { ...scan, gateway }, devices, network, issues };
}

/** The router is usually .1 (or .254), and answers DNS. */
export function guessGateway(scan: Scan): string | undefined {
  const dns = scan.devices.find((d) => d.ports.some((p) => p.port === 53) && /\.(1|254)$/.test(d.ip));
  return dns?.ip ?? scan.devices.find((d) => /\.1$/.test(d.ip))?.ip;
}
