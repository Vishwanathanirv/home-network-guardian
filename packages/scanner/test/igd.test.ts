import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { igd } from "../src/discover";

// A pretend router that speaks just enough UPnP: a description and two port mappings.
const DESC = `<?xml version="1.0"?><root><device><friendlyName>Archer C6</friendlyName><deviceList><device><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service>
</serviceList></device></deviceList></device></root>`;
const MAPS = [
  { ext: 8081, int: 80, client: "192.168.1.31", desc: "IPCAM", proto: "TCP" },
  { ext: 9308, int: 9308, client: "192.168.1.60", desc: "PS5 Remote Play", proto: "UDP" },
];

describe("reading the router's doors to the internet", () => {
  let server: http.Server;
  let url = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/desc.xml") return res.end(DESC);
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (/GetExternalIPAddress/.test(String(req.headers.soapaction))) return res.end("<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>203.0.113.42</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>");
        const i = Number(body.match(/<NewPortMappingIndex>(\d+)</)?.[1]);
        const m = MAPS[i];
        if (!m) return res.writeHead(500).end("<s:Fault>SpecifiedArrayIndexInvalid</s:Fault>");
        res.end(`<s:Envelope><s:Body><u:R><NewRemoteHost></NewRemoteHost><NewExternalPort>${m.ext}</NewExternalPort><NewProtocol>${m.proto}</NewProtocol><NewInternalPort>${m.int}</NewInternalPort><NewInternalClient>${m.client}</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>${m.desc}</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration></u:R></s:Body></s:Envelope>`);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/desc.xml`;
  });
  afterAll(() => server.close());

  it("lists the router's internet address and every open door", async () => {
    expect(await igd(url)).toEqual({
      externalIp: "203.0.113.42",
      mappings: [
        { protocol: "TCP", externalPort: 8081, internalPort: 80, client: "192.168.1.31", description: "IPCAM", enabled: true, lease: undefined },
        { protocol: "UDP", externalPort: 9308, internalPort: 9308, client: "192.168.1.60", description: "PS5 Remote Play", enabled: true, lease: undefined },
      ],
    });
  });
});
