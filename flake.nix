{
  description = "twikoo-api-worker: Cloudflare Workers backend for Twikoo (dev environment)";

  # ----------------------------------------------------------------------------
  # Inputs
  # ----------------------------------------------------------------------------
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
    devkit = {
      url = "github:hakula139/devkit/d3958e313d1c13d44e3cebb75afb610e3c712d3d";
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
