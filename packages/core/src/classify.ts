import { isRandomMac, vendorOf } from "./oui";
import type { Device, Kind } from "./types";

export const KIND_NAME: Record<Kind, string> = {
  router: "Router",
  computer: "Computer",
  phone: "Phone or tablet",
  tv: "TV or streaming box",
  speaker: "Smart speaker",
  camera: "Camera or doorbell",
  printer: "Printer",
  nas: "Network storage",
  console: "Games console",
  smart: "Smart home gadget",
  unknown: "Unknown device",
};

type Clue = { kind: Kind; weight: number; why: string };

const VENDOR_CLUES: [RegExp, Kind, number][] = [
  [/hikvision|dahua|reolink|amcrest|wyze|arlo|ring|blink|eufy|foscam|axis comm|hanwha|uniview|ezviz|imou|tp-link.*tapo/i, "camera", 3],
  [/sonos|bose|harman|bang & olufsen|denon|yamaha/i, "speaker", 3],
  [/roku|samsung.*tv|lg electronics|vizio|tcl|hisense|sony visual|sky uk|nvidia|chromecast|amazon.*fire/i, "tv", 2],
  [/hewlett packard|hp inc|canon|epson|seiko epson|brother|xerox|lexmark|kyocera|ricoh/i, "printer", 2],
  [/synology|qnap|western digital|asustor|buffalo|drobo|terramaster/i, "nas", 3],
  [/nintendo|sony interactive|microsoft.*xbox/i, "console", 3],
  [/espressif|tuya|shelly|allterco|sonoff|itead|philips lighting|signify|lifx|ecobee|nest labs|ikea of sweden|wiz|meross|broadlink|xiaomi.*iot|lumi united|tp-link.*kasa|belkin|wemo|irobot|ring/i, "smart", 2],
  [/raspberry pi/i, "computer", 1],
  [/intel|dell|lenovo|hewlett packard enterprise|asustek|micro-star|gigabyte|azurewave|liteon|realtek|framework/i, "computer", 1],
  [/apple/i, "phone", 1],
  [/oneplus|xiaomi communications|huawei device|oppo|vivo|motorola mobility|samsung electronics|google/i, "phone", 1],
  [/tp-link|netgear|ubiquiti|mikrotik|asus|linksys|d-link|zyxel|arris|technicolor|sagemcom|huawei technologies|zte|eero|avm|fritz|draytek|cisco|juniper|netis|tenda|mercusys|actiontec|calix|nokia/i, "router", 1],
];

const HOST_CLUES: [RegExp, Kind][] = [
  [/iphone|ipad|android|galaxy|pixel|oneplus|redmi|phone/i, "phone"],
  [/macbook|imac|mac-?mini|desktop|laptop|-pc\b|^pc-|thinkpad|surface|ubuntu|fedora|debian|raspberrypi|workstation/i, "computer"],
  [/tv|roku|chromecast|firetv|fire-tv|shield|appletv|apple-tv|bravia/i, "tv"],
  [/echo|alexa|google-home|nest-?(mini|audio|hub)|homepod|sonos/i, "speaker"],
  [/cam|doorbell|ipc|nvr|dvr/i, "camera"],
  [/printer|laserjet|officejet|deskjet|envy|epson|brother|canon|mfc/i, "printer"],
  [/nas|diskstation|synology|qnap|truenas|unraid/i, "nas"],
  [/xbox|playstation|ps[45]|switch|nintendo/i, "console"],
  [/plug|bulb|light|lamp|thermostat|esp[-_]|tasmota|shelly|tuya|sonoff|vacuum|roomba|kettle|fridge|washer/i, "smart"],
  [/router|gateway|modem|fritz|livebox|hub|openwrt|unifi|ubnt|eero|orbi|deco/i, "router"],
];

/** Guesses what a device is, with the reasons, so the guess can be checked. */
export function classify(d: Device, gateway?: string): { kind: Kind; vendor?: string; confidence: "sure" | "likely" | "guess"; why: string[] } {
  const vendor = d.vendor || vendorOf(d.mac);
  const clues: Clue[] = [];
  const ports = new Set(d.ports.map((p) => p.port));
  const text = [d.os, ...(d.hints ?? []), ...d.ports.map((p) => `${p.product ?? ""} ${p.banner ?? ""}`)].join(" ");

  if (gateway && d.ip === gateway) clues.push({ kind: "router", weight: 10, why: "It's the network's gateway, so it's the router." });
  if (vendor) for (const [re, kind, w] of VENDOR_CLUES) if (re.test(vendor)) clues.push({ kind, weight: w, why: `Made by ${vendor}.` });
  if (d.hostname) for (const [re, kind] of HOST_CLUES) if (re.test(d.hostname)) clues.push({ kind, weight: 3, why: `It calls itself "${d.hostname}".` });
  if (d.mac && isRandomMac(d.mac)) clues.push({ kind: "phone", weight: 2, why: "It uses a private (random) MAC address, which phones, tablets and laptops do." });

  const has = (...p: number[]) => p.some((x) => ports.has(x));
  if (has(554, 8554)) clues.push({ kind: "camera", weight: 3, why: "It streams video over RTSP (port 554)." });
  if (has(9100, 631, 515)) clues.push({ kind: "printer", weight: 3, why: "It accepts print jobs (ports 9100, 631 or 515)." });
  if (has(8008, 8009)) clues.push({ kind: "tv", weight: 3, why: "It answers on the Chromecast ports (8008/8009)." });
  if (has(7000, 7100) && /apple/i.test(vendor ?? "")) clues.push({ kind: "tv", weight: 2, why: "It accepts AirPlay (port 7000)." });
  if (has(1400)) clues.push({ kind: "speaker", weight: 3, why: "It answers on Sonos's control port (1400)." });
  if (has(5000, 5001) && /synology/i.test(vendor ?? "")) clues.push({ kind: "nas", weight: 3, why: "Synology's admin page is on port 5000/5001." });
  if (has(139, 445) && has(22, 80, 443) && !has(3389)) clues.push({ kind: "nas", weight: 1, why: "It shares files (SMB) and has a web or SSH admin." });
  if (has(3389, 5357)) clues.push({ kind: "computer", weight: 2, why: "It's a Windows computer (remote desktop or network discovery ports)." });
  if (has(8123)) clues.push({ kind: "computer", weight: 3, why: "It runs Home Assistant (port 8123)." });
  if (has(62078)) clues.push({ kind: "phone", weight: 4, why: "It answers on the iPhone sync port (62078)." });
  if (has(53) && has(80, 443)) clues.push({ kind: "router", weight: 2, why: "It answers DNS and has a web admin page, like a router." });
  if (has(1883, 8883, 6668)) clues.push({ kind: "smart", weight: 2, why: "It speaks a smart-home protocol (MQTT or Tuya)." });
  if (has(5555) && !has(62078)) clues.push({ kind: "tv", weight: 2, why: "Android debugging (port 5555) is usually left on by Android TV boxes." });

  if (/router|gateway|wap|broadband|openwrt|routeros|dd-wrt/i.test(text)) clues.push({ kind: "router", weight: 2, why: "The scanner identified it as a router." });
  if (/webcam|camera|ipcam|nvr|dvr/i.test(text)) clues.push({ kind: "camera", weight: 3, why: "The scanner identified it as a camera or recorder." });
  if (/printer|laserjet|cups/i.test(text)) clues.push({ kind: "printer", weight: 2, why: "The scanner identified it as a printer." });
  if (/windows|macos|mac os x|linux 5|linux 6/i.test(text) && !/embedded/i.test(text)) clues.push({ kind: "computer", weight: 1, why: `Its software looks like ${text.match(/windows|macos|mac os x|linux/i)![0]}.` });
  if (/\bios\b|iphone|android/i.test(text)) clues.push({ kind: "phone", weight: 2, why: "Its software looks like a phone's." });
  if (/media device|\btv\b|chromecast|roku|webos|tizen/i.test(text)) clues.push({ kind: "tv", weight: 2, why: "The scanner identified it as a media device." });

  const score = new Map<Kind, { w: number; why: string[] }>();
  for (const c of clues) {
    const s = score.get(c.kind) ?? { w: 0, why: [] };
    s.w += c.weight;
    if (!s.why.includes(c.why)) s.why.push(c.why);
    score.set(c.kind, s);
  }
  const best = [...score.entries()].sort((a, b) => b[1].w - a[1].w)[0];
  if (!best) return { kind: "unknown", vendor, confidence: "guess", why: [vendor ? `Made by ${vendor}, but nothing says what it is.` : "No maker, name or open services to go on."] };
  const second = [...score.values()].map((s) => s.w).sort((a, b) => b - a)[1] ?? 0;
  const margin = best[1].w - second;
  return { kind: best[0], vendor, confidence: best[1].w >= 5 && margin >= 3 ? "sure" : best[1].w >= 3 && margin >= 1 ? "likely" : "guess", why: best[1].why };
}
