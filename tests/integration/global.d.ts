import type * as Worker from '@/worker';

// Types `exports.default` from `cloudflare:workers` so integration tests can
// call the worker entry through it. Without this, `exports` resolves to `{}`.
declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof Worker;
    }
  }
}
