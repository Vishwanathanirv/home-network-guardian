import dgram from "node:dgram";
import { afterAll, beforeAll, expect, test } from "vitest";
import { askName } from "../src/discover";

// A stand-in for an iPhone: answers a reverse lookup on port 5353 with its own name.
let phone: dgram.Socket;
beforeAll(
  () =>
    new Promise<void>((ready) => {
      phone = dgram.createSocket({ type: "udp4", reuseAddr: true });
      phone.on("message", (q, from) => {
        const asked = q.subarray(12, q.length - 4); // the question name, as sent
        const name = Buffer.concat([Buffer.from([12]), Buffer.from("Ravis-iPhone"), Buffer.from([5]), Buffer.from("local"), Buffer.from([0])]);
        const head = Buffer.alloc(12);
        q.copy(head, 0, 0, 2);
        head.writeUInt16BE(0x8400, 2);
        head.writeUInt16BE(1, 6); // one answer
        const rr = Buffer.alloc(10);
        rr.writeUInt16BE(12, 0); // PTR
        rr.writeUInt16BE(1, 2);
        rr.writeUInt32BE(120, 4);
        rr.writeUInt16BE(name.length, 8);
        phone.send(Buffer.concat([head, asked, rr, name]), from.port, from.address);
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
