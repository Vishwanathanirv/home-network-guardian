# Changelog

All notable changes. Dates are UTC.

## 2026-11-19

### Security
- The scanner's own page (which carries the live session key) could be read cross-origin by any site named `home-network-guardian-<anything>.vercel.app`, which anyone can create. CORS is now granted only on the data endpoints (`/state`, `/scan`, `/fetch`), and only to the hosted app, this project's own preview builds and local development.
- The live key is compared in constant time.
- `isPrivate("10.evil.example")` returned true. It now requires a real dotted IPv4 address.
- Imported scans (Lamplight JSON, nmap XML, ARP tables) drop devices whose address isn't an IP address, so a crafted file can't turn device links into links to other sites.
- Strict security headers on the hosted site and on the scanner's built-in site: Content-Security-Policy (only the app's own scripts; data can go only to the site itself and the scanner on 127.0.0.1), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, Permissions-Policy, HSTS.

### Reliability
- CI had failed on every push since 0477125: the build wrote the committed scanner without its executable bit. The build now keeps it executable.
- `npm run typecheck` and `npm test` generate the vendor table first, so they work on a fresh clone.
- Every end-to-end test runs under the production Content-Security-Policy and fails if the policy blocks anything.
- Ctrl K focuses its search the moment it opens; the first keys typed were being dropped (and the e2e test was flaky).

### Product
- Network page: the router and internet speeds are drawn as one beam of light (you, the router, the internet) instead of four tiles, and the three stat cards are one sentence.
- The to-do progress bar is a string of lamps, one per fix, that light up as you tick problems off.

### Performance
- `npm run measure` reports real first paint, time to the home headline and bytes transferred, in Chromium, with and without a 4× CPU slowdown.
- The vendor table is cached for a day on the hosted site.
