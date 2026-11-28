# ==================================================================================================
# twikoo-api-worker Development Flake
# ==================================================================================================

{
  description = "twikoo-api-worker development environment";

  # ------------------------------------------------------------------------------------------------
  # Inputs
  # ------------------------------------------------------------------------------------------------
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

    devkit = {
      url = "github:hakulab/devkit/v3";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  # ------------------------------------------------------------------------------------------------
  # Outputs
  # ------------------------------------------------------------------------------------------------
  outputs =
    {
      nixpkgs,
      devkit,
      ...
    }:
    devkit.lib.eachSystem devkit.lib.systems (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        dk = devkit.lib.mkLib pkgs;

        # ------------------------------------------------------------------------------------------
        # Pre-commit Hooks
        # ------------------------------------------------------------------------------------------
        preCommit = dk.preCommit {
          src = ./.;
          hooks = {
            eslint.enable = true;
            markdownlint-cli2.settings.configPath = ".markdownlint-cli2.jsonc";
            nu-check.enable = true;
            prettier.enable = true;
            taplo.enable = true;
            tsc.enable = true;
          };
        };
      in
      {
        # ------------------------------------------------------------------------------------------
        # Dev Shell
        # ------------------------------------------------------------------------------------------
        devShells.default = pkgs.mkShell {
          name = "twikoo-api-worker-dev";

          packages = [
            dk.nushell
            pkgs.curl
            pkgs.gzip
          ]
          ++ builtins.attrValues dk.nodeToolchain;

          inputsFrom = [ preCommit ];
        };

        # ------------------------------------------------------------------------------------------
        # Formatter
        # ------------------------------------------------------------------------------------------
        formatter = pkgs.nixfmt-tree;
      }
    );
}
