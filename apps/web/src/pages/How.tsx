export function How() {
  return (
    <div className="max-w-3xl space-y-8 text-[1.02rem] leading-relaxed">
      <div>
        <h1 className="text-[2.2rem] font-bold leading-[1.1] tracking-[-0.015em]">How Lamplight works</h1>
        <p className="mt-3 text-muted">Many homes now have more than a dozen connected devices, and few people could name them all. Cheap gadgets ship with factory passwords and old software, and one weak device on the Wi-Fi can reach everything else. Lamplight answers three questions: what's on my network, which devices are risky, and what exactly do I do about it.</p>
      </div>
      <section>
        <h2 className="text-xl font-bold">1. Finding devices</h2>
        <p className="mt-2 text-muted">
          The scanner tries to connect to 39 well-known ports on every address in your network. A device that answers, or even refuses, is there. Your computer then knows its hardware ID (MAC address) from the ARP table. It also asks UPnP devices to announce themselves, which is how a router with UPnP switched on gives itself away. It only scans private addresses and never tries to log in to anything.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold">2. Working out what each one is</h2>
        <p className="mt-2 text-muted">
          The first half of a MAC address belongs to the maker, so Lamplight looks it up in the IEEE's public registry (about 40,000 entries). It adds the device's own name, the services it answers on (port 554 means a video stream, 9100 a printer, 62078 an iPhone) and the scanner's guess at its software. Each clue adds weight to a type, and the page tells you which clues it used and how sure it is. Phones and laptops now hide their maker behind a random address, which Lamplight recognises too.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold">3. Deciding what matters</h2>
        <p className="mt-2 text-muted">
          The checks are written for homes, not data centres. Telnet on a camera and Android debugging on a TV box are urgent, because botnets take over exactly those. File sharing is normal on a NAS and odd on a light bulb. UPnP on the router, an unencrypted camera stream and a settings page without HTTPS are worth fixing this week. A short list of software versions with notorious holes is checked too (like OpenSSH 8.5 to 9.7, or the backdoored vsftpd 2.3.4), with a caveat where Linux distributions fix things without changing the version number.
        </p>
      </section>
      <section className="card p-4">
        <h2 className="text-xl font-bold">What it can't tell you</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
          <li>Whether a password is weak. Lamplight never tries to log in to your devices; it tells you where a default password is likely to matter.</li>
          <li>Anything about devices that don't answer. Phones usually ignore connections, so they show up with nothing open, which is good.</li>
          <li>Every known vulnerability. Version checks are deliberately few and certain; a full vulnerability scanner would need a large, constantly updated database.</li>
          <li>What your router exposes to the internet. That needs a scan from outside your home; your internet provider's app or the router's own settings page is the place to check port forwarding.</li>
        </ul>
      </section>
      <section>
        <h2 className="text-xl font-bold">Privacy</h2>
        <p className="mt-2 text-muted">Scans are read in your browser and saved in your browser's storage. Nothing is sent anywhere. The names and rooms you give devices are stored the same way.</p>
      </section>
    </div>
  );
}
