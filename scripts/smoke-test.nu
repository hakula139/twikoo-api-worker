# Verify the upstream version through a temporary local Wrangler instance.
def main [] {
  let smoke_port = port

  let expected_version = open "node_modules/twikoo-func/package.json" | get version
  let smoke_dir = mktemp -d
  let state = $smoke_dir | path join "state"
  let log = $smoke_dir | path join "wrangler.log"

  try {
    (
      ^wrangler d1 execute twikoo
        --local
        --persist-to $state
        --file "tests/fixtures/schema.sql"
    )

    "" | save $log

    let parent = job id
    let wrangler = job spawn {
      try {
        (
          ^wrangler dev
            --local
            --persist-to $state
            --port $smoke_port
            out+err> $log
        )
      } catch {
      } finally {
        true | job send $parent
      }
    }

    try {
      let response = (
        ^curl $"http://127.0.0.1:($smoke_port)/"
          --retry 30
          --retry-connrefused
          --retry-delay 1
          --retry-max-time 30
          --max-time 5
          --fail
          --silent
          --header "Content-Type: application/json"
          --data '{"event":"GET_FUNC_VERSION"}'
        | from json
      )

      if $response.code != 0 or $response.version != $expected_version {
        error make {msg: "Unexpected function version response."}
      }
    } catch {|err|
      open --raw $log | print
      error make $err
    } finally {
      let pids = job list | where id == $wrangler | get pids | flatten

      if not ($pids | is-empty) {
        kill ...$pids
      }

      job recv --timeout 5sec | ignore
    }
  } finally {
    rm --recursive $smoke_dir
  }
}
