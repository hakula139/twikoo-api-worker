{
  description = "twikoo-api-worker: Cloudflare Workers backend for Twikoo (dev environment)";

  # ----------------------------------------------------------------------------
  # Inputs
  # ----------------------------------------------------------------------------
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
    devkit = {
      url = "github:hakula139/devkit/44782b619d0c4cd9562c5000f6230aa9582e67ac";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  # ----------------------------------------------------------------------------
  # Outputs
  # ----------------------------------------------------------------------------
  outputs =
    {
      nixpkgs,
      flake-utils,
      devkit,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        dk = devkit.lib.mkLib pkgs;

        preCommit = dk.preCommit {
          src = ./.;
          devHooks.eslint = {
            enable = true;
            entry = "${pkgs.lib.getExe (dk.nodeTool "eslint")} --fix";
            files = "\\.(ts|tsx|js|mjs|cjs)$";
          };
        };
      in
      {
        # ----------------------------------------------------------------------
        # Dev Shell
        # ----------------------------------------------------------------------
        devShells.default = pkgs.mkShell {
          name = "twikoo-api-worker-dev";

          inputsFrom = [ preCommit.shell ];
          packages = with pkgs; [
            curl
            jq
            nodejs_26
            pnpm
          ];
        };

        # ----------------------------------------------------------------------
        # Checks (`nix flake check`)
        # ----------------------------------------------------------------------
        checks = {
          pre-commit = preCommit.check;
        };

        # ----------------------------------------------------------------------
        # Formatter (`nix fmt`)
        # ----------------------------------------------------------------------
        formatter = pkgs.nixfmt;
      }
    );
}
