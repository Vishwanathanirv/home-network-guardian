import net from "node:net";

/*
 * Safe, read-only checks that prove a problem instead of guessing from a version number.
 * None of them uses or guesses a password, changes anything, or reads any files.
 */

export type Probes = { rtsp?: { open: boolean; path?: string }; ftpAnon?: boolean; smb1?: boolean };

/** Sends one request and collects the reply until `done` says it's complete or time runs out. */
function talk(ip: string, port: number, send: Buffer | string | null, done: (got: Buffer) => boolean, timeout = 3000): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const sock = net.connect({ host: ip, port });
    const finish = () => {
      clearTimeout(t);
      sock.destroy();
      resolve(Buffer.concat(chunks));
    };
    const t = setTimeout(finish, timeout);
    sock.on("connect", () => send !== null && sock.write(send));
    sock.on("data", (c) => {
      chunks.push(c);
      if (done(Buffer.concat(chunks))) finish();
    });
    sock.on("error", finish);
    sock.on("close", finish);
  });
}

/** Stream paths cameras commonly use. We only ask for the stream's description, never the video. */
export const RTSP_PATHS = ["/", "/live", "/stream1", "/h264", "/11", "/live/ch00_0", "/Streaming/Channels/101", "/cam/realmonitor?channel=1&subtype=0", "/videoMain", "/onvif1"];

/** Reads the status code of an RTSP reply. */
export const rtspStatus = (reply: string) => Number(reply.match(/^RTSP\/1\.\d (\d{3})/)?.[1] ?? 0);

/**
 * Asks a camera for its stream with no password (an RTSP DESCRIBE). A 200 with a video description
 * means anyone on the network can watch; 401 means it wants a password, which is what we hope for.
 */
export async function rtspCheck(ip: string, port: number): Promise<Probes["rtsp"]> {
  for (const [i, path] of RTSP_PATHS.entries()) {
    const req = `DESCRIBE rtsp://${ip}:${port}${path} RTSP/1.0\r\nCSeq: ${i + 2}\r\nAccept: application/sdp\r\nUser-Agent: Lamplight\r\n\r\n`;
    const reply = (await talk(ip, port, req, (b) => /\r\n\r\n/.test(b.toString("latin1")) && (!/content-length:\s*[1-9]/i.test(b.toString("latin1")) || /m=(video|audio)/.test(b.toString("latin1"))), 2500)).toString("latin1");
    const code = rtspStatus(reply);
    if (code === 200 && /m=(video|audio)|application\/sdp/i.test(reply)) return { open: true, path };
    if (code === 401 || code === 403) return { open: false };
    if (!code) return undefined; // not an RTSP server, or it stopped answering
  }
  return undefined;
}

/** Reads the last complete FTP reply code in what the server sent so far. */
export function ftpCode(text: string): number {
  const lines = text.split(/\r?\n/).filter((l) => /^\d{3} /.test(l));
  return lines.length ? Number(lines[lines.length - 1].slice(0, 3)) : 0;
}

/**
 * Does the FTP server let in the public "anonymous" guest? We log in as the guest and leave at once:
 * no listing, no files. Many routers and storage boxes ship with this on, sharing everything.
 */
export function ftpAnonCheck(ip: string, port = 21, timeout = 5000): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port });
    let buf = "";
    let step = 0;
    const end = (v: boolean | undefined) => {
      clearTimeout(t);
      try {
        sock.write("QUIT\r\n");
      } catch {
        /* closed */
      }
      sock.destroy();
      resolve(v);
    };
    const t = setTimeout(() => end(undefined), timeout);
    sock.on("data", (c) => {
      buf += c.toString("latin1");
      const code = ftpCode(buf);
      if (!code) return;
      buf = "";
      if (step === 0 && code === 220) {
        step = 1;
        sock.write("USER anonymous\r\n");
      } else if (step === 1 && code === 331) {
        step = 2;
        sock.write("PASS lamplight@\r\n");
      } else if (step === 1 && code === 230) end(true);
      else if (step === 2) end(code === 230);
      else end(code >= 500 ? false : undefined);
    });
    sock.on("error", () => end(undefined));
    sock.on("close", () => end(undefined));
  });
}

/** An SMB1 "which dialects do you speak?" request offering only the old NT LM 0.12 dialect. */
export function smb1Negotiate(): Buffer {
  const dialects = Buffer.from("\x02NT LM 0.12\x00", "latin1");
  const smb = Buffer.alloc(32 + 3);
  Buffer.from([0xff, 0x53, 0x4d, 0x42]).copy(smb, 0); // \xFFSMB
  smb[4] = 0x72; // NEGOTIATE
  smb[9] = 0x18; // flags: canonical paths, case-insensitive
  smb.writeUInt16LE(0xc801, 10); // flags2: unicode, NT status codes, long names
  smb.writeUInt16LE(0xfeff, 26); // process id
  smb[32] = 0; // word count
  smb.writeUInt16LE(dialects.length, 33); // byte count
  const body = Buffer.concat([smb, dialects]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0); // NetBIOS session message, type 0
  return Buffer.concat([head, body]);
}

/** True if the reply is an SMB1 NEGOTIATE that accepted our dialect. */
export function smb1Accepted(reply: Buffer): boolean {
  if (reply.length < 4 + 37) return false;
  const smb = reply.subarray(4);
  if (smb.readUInt32BE(0) !== 0xff534d42 || smb[4] !== 0x72 || smb.readUInt32LE(5) !== 0) return false;
  return smb[32] > 0 && smb.readUInt16LE(33) !== 0xffff; // a word count, and a dialect index other than "none"
}

/** Does the device still speak SMBv1, the old file-sharing protocol WannaCry spread through? */
export async function smb1Check(ip: string, port = 445): Promise<boolean | undefined> {
  const reply = await talk(ip, port, smb1Negotiate(), (b) => b.length >= 4 && b.length >= 4 + b.readUInt32BE(0), 3000);
  if (reply.length < 8) return undefined;
  return smb1Accepted(reply);
}

/** Runs whichever checks fit the services a device has open. */
export async function activeChecks(ip: string, open: number[]): Promise<Probes | undefined> {
  const has = (p: number) => open.includes(p);
  const [rtsp, ftpAnon, smb1] = await Promise.all([
    has(554) ? rtspCheck(ip, 554) : has(8554) ? rtspCheck(ip, 8554) : undefined,
    has(21) ? ftpAnonCheck(ip) : undefined,
    has(445) ? smb1Check(ip) : undefined,
  ]);
  const out: Probes = {};
  if (rtsp) out.rtsp = rtsp;
  if (ftpAnon !== undefined) out.ftpAnon = ftpAnon;
  if (smb1 !== undefined) out.smb1 = smb1;
  return Object.keys(out).length ? out : undefined;
}
