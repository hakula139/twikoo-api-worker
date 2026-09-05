import type * as Worker from '@/worker';

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof Worker;
    }
  }
}
