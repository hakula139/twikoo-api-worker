#!/usr/bin/env nu

# Check the compressed Worker bundle against the Workers Free plan limit.
const REPO_ROOT = path self . | path dirname

def main [] {
  cd $REPO_ROOT
  $env.PATH = ($env.PATH | prepend ($REPO_ROOT | path join "node_modules/.bin"))

  let bundle_dir = mktemp -d

  try {
    (
      ^wrangler deploy
        --dry-run
        --outdir $bundle_dir
    )

    let threshold = 3 * 1024 * 1024
    let gzipped = (^gzip -c ($bundle_dir | path join "worker.js") | bytes length)

    print $"Compressed bundle: ($gzipped) bytes, threshold: ($threshold)"

    if $gzipped > $threshold {
      error make {msg: $"Compressed bundle ($gzipped)B exceeds ($threshold)B threshold."}
    }
  } finally {
    rm --recursive $bundle_dir
  }
}
