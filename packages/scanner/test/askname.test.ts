import dgram from "node:dgram";
import { afterAll, beforeAll, expect, test } from "vitest";
import { askName, mdnsDirect } from "../src/discover";

const labels = (name: string) => Buffer.concat([...name.split(".").map((l) => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)])), Buffer.from([0])]);

/** One PTR answer to whatever was asked, copying the question's id. */
function answer(q: Buffer, owner: string, target: string) {
  const head = Buffer.alloc(12);
  q.copy(head, 0, 0, 2);
  head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(1, 6);
  const data = labels(target);
  const rr = Buffer.alloc(10);
  rr.writeUInt16BE(12, 0);
  rr.writeUInt16BE(1, 2);
  rr.writeUInt32BE(120, 4);
  rr.writeUInt16BE(data.length, 8);
  return Buffer.concat([head, labels(owner), rr, data]);
}

// A stand-in for an iPhone on port 5353: it answers a reverse lookup with its host name, and a
// question about Bonjour services with the name its owner gave it.
let phone: dgram.Socket;
beforeAll(
  () =>
    new Promise<void>((ready) => {
      phone = dgram.createSocket({ type: "udp4", reuseAddr: true });
      phone.on("message", (q, from) => {
        const reply = q.includes(Buffer.from("in-addr"))
          ? answer(q, "1.0.0.127.in-addr.arpa", "Ravis-iPhone.local")
          : q.includes(Buffer.from("_companion-link"))
            ? answer(q, "_companion-link._tcp.local", "Ravi's iPhone._companion-link._tcp.local")
            : null;
        if (reply) phone.send(reply, from.port, from.address);
      });
      phone.bind(5353, "127.0.0.1", () => ready());
    }),
);
afterAll(() => phone.close());

test("asks a device directly for its own name", async () => {
  expect(await askName("127.0.0.1")).toBe("Ravis-iPhone.local");
});

test("gives up quietly when nothing answers", async () => {
  expect(await askName("127.0.0.2", 300)).toBeUndefined();
});

test("asks a device directly which Bonjour services it offers, and reads its name", async () => {
  const got = await mdnsDirect(["127.0.0.1"], 900);
  expect(got.get("127.0.0.1")?.name).toBe("Ravi's iPhone");
  expect(got.get("127.0.0.1")?.services).toContain("_companion-link._tcp");
});

test("asks over LLMNR too, the way Windows laptops answer", async () => {
  const pc = dgram.createSocket({ type: "udp4", reuseAddr: true });
  await new Promise<void>((ok) => pc.bind(5355, "127.0.0.1", () => ok()));
  pc.on("message", (q, from) => pc.send(answer(q, "1.0.0.127.in-addr.arpa", "ANITHA-LAPTOP"), from.port, from.address));
  expect(await askName("127.0.0.1", 900, 5355)).toBe("ANITHA-LAPTOP");
  pc.close();
});
