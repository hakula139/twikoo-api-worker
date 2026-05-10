import type * as Worker from '@/worker';

// Wires `exports.default.fetch(...)` from `cloudflare:workers` to the
// integration tests. Without this augmentation, `exports` resolves to `{}`
// so `default` is unknown. See vitest-pool-workers docs for the migration
// off the deprecated `SELF` binding.
declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof Worker;
    }
  }
}
