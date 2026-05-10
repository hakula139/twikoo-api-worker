import type * as Worker from '@/worker';

// Types `exports.default` from `cloudflare:workers` for integration tests.
declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof Worker;
    }
  }
}
