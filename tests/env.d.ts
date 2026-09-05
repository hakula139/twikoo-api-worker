// Miniflare populates these bindings from wrangler.toml.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    R2: R2Bucket;
    R2_PUBLIC_URL: string;
  }
}

// Vite's `?raw` query loads file contents as a string at build time;
// drizzle-kit's emitted SQL fixture is consumed via this path.
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
