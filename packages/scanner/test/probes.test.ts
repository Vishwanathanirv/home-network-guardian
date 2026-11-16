import net, { type AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { analyse } from "@lamplight/core";
import { ftpAnonCheck, ftpCode, rtspCheck, smb1Accepted, smb1Check, smb1Negotiate } from "../src/probes";

const servers: net.Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));
/** A tiny fake device: gets each chunk the scanner sends and may answer. */
function fake(onData: (sock: net.Socket, data: Buffer) => void, greet?: string): Promise<number> {
  return new Promise((ok) => {
    const s = net.createServer((sock) => {
      if (greet) sock.write(greet);
      sock.on("data", (d) => onData(sock, d));
      sock.on("error", () => {});
    });
    servers.push(s);
    s.listen(0, "127.0.0.1", () => ok((s.address() as AddressInfo).port));
  });
}

describe("camera stream check", () => {
  it("finds a stream that plays without a password, on a common path", async () => {
    const port = await fake((sock, d) => {
      const path = d.toString().split(" ")[1];
      const ok = path.endsWith("/stream1");
      const sdp = "v=0\r\nm=video 0 RTP/AVP 96\r\n";
      sock.write(ok ? `RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Type: application/sdp\r\nContent-Length: ${sdp.length}\r\n\r\n${sdp}` : "RTSP/1.0 404 Not Found\r\nCSeq: 1\r\n\r\n");
    });
    expect(await rtspCheck("127.0.0.1", port)).toEqual({ open: true, path: "/stream1" });
  });
  it("is happy when the camera asks for a password", async () => {
    const port = await fake((sock) => sock.write('RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\nWWW-Authenticate: Digest realm="cam"\r\n\r\n'));
    expect(await rtspCheck("127.0.0.1", port)).toEqual({ open: false });
  });
});

describe("FTP guest check", () => {
  const ftp = (pass: string) =>
    fake((sock, d) => {
      const line = d.toString();
      if (line.startsWith("USER")) sock.write("331 Please specify the password.\r\n");
      else if (line.startsWith("PASS")) sock.write(pass);
    }, "220-Welcome\r\n220 FTP ready\r\n");
  it("spots a server that lets the anonymous guest in", async () => {
    expect(await ftpAnonCheck("127.0.0.1", await ftp("230 Login successful.\r\n"))).toBe(true);
  });
  it("and one that doesn't", async () => {
    expect(await ftpAnonCheck("127.0.0.1", await ftp("530 Login incorrect.\r\n"))).toBe(false);
  });
  it("reads the last full reply code, including multi-line ones", () => {
    expect(ftpCode("220-Hello\r\n220 Ready\r\n")).toBe(220);
    expect(ftpCode("220-Still talking")).toBe(0);
  });
});

describe("SMBv1 check", () => {
  const reply = (accept: boolean) => {
    const smb = Buffer.alloc(32 + 1 + 34 + 2);
    Buffer.from([0xff, 0x53, 0x4d, 0x42, 0x72]).copy(smb, 0);
    smb[32] = 17;
    smb.writeUInt16LE(accept ? 0 : 0xffff, 33);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(smb.length, 0);
    return Buffer.concat([head, smb]);
  };
  it("builds a well-formed request offering only the old dialect", () => {
    const r = smb1Negotiate();
    expect(r.readUInt32BE(0)).toBe(r.length - 4);
    expect(r.subarray(4, 8).toString("latin1")).toBe("\xffSMB");
    expect(r.toString("latin1")).toContain("NT LM 0.12");
  });
  it("tells an SMBv1 yes from a no", () => {
    expect(smb1Accepted(reply(true))).toBe(true);
    expect(smb1Accepted(reply(false))).toBe(false);
  });
  it("talks to a device that still speaks SMBv1", async () => {
    expect(await smb1Check("127.0.0.1", await fake((sock) => sock.write(reply(true))))).toBe(true);
  });
});

describe("what the checks prove changes the advice", () => {
  const scan = (probes: object, ports: number[]) => analyse({ at: "", source: "lamplight", devices: [{ ip: "192.168.1.50", ports: ports.map((port) => ({ port, proto: "tcp" as const })), details: { probes } }] });
  it("a camera stream with no password is critical; one with a password is low", () => {
    expect(scan({ rtsp: { open: true, path: "/live" } }, [554, 80]).issues.find((i) => i.port === 554)).toMatchObject({ id: "rtsp-open", severity: "critical" });
    expect(scan({ rtsp: { open: false } }, [554, 80]).issues.find((i) => i.port === 554)).toMatchObject({ severity: "low" });
  });
  it("anonymous FTP and SMBv1 get their own clear warnings", () => {
    const r = scan({ ftpAnon: true, smb1: true }, [21, 445]);
    expect(r.issues.map((i) => i.id)).toEqual(expect.arrayContaining(["ftp-anon", "smb1"]));
  });
});
