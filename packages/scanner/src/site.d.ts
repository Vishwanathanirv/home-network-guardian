/** Filled in at build time with the built website (see scripts/build.mjs); empty if it wasn't built. */
declare module "lamplight:ui" {
  export const UI: Record<string, [type: string, gzippedBase64: string]>;
}
