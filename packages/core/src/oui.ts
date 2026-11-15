export type OuiTable = { vendors: string[]; prefixes: Record<string, number> };

let table: OuiTable | null = null;

/** Loads the vendor table (built from the IEEE registry by `npm run oui`). */
export function setOui(t: OuiTable) {
  table = t;
}

/**
 * Phones and laptops now use a random "private" MAC address on each Wi-Fi network. Those have
 * the locally-administered bit set (second hex digit 2, 6, A or E) and belong to no vendor.
 */
export function isRandomMac(mac: string) {
  return /^[0-9A-F][26AE]/i.test(mac.replace(/[^0-9A-F]/gi, ""));
}

export function vendorOf(mac?: string): string | undefined {
  if (!mac || !table) return undefined;
  const hex = mac.replace(/[^0-9A-F]/gi, "").toUpperCase();
  if (hex.length < 6 || isRandomMac(hex)) return undefined;
  const i = table.prefixes[hex.slice(0, 6)];
  return i === undefined ? undefined : table.vendors[i];
}
