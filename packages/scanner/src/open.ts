/**
 * How to open a link in the browser on each system. Not "cmd /c start" on Windows: the Command
 * Prompt reads the "&" in "?live=…&key=…" as "run another command" and drops the key.
 */
export function browserCommand(url: string, platform = process.platform): [string, string[]] {
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
}
