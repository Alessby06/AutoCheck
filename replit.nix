{ pkgs }: {
  deps = [
    pkgs.nodejs-16_x
    pkgs.python39
    pkgs.python39Packages.pip
    pkgs.chromium
    pkgs.glib
    pkgs.nss
    pkgs.fontconfig
  ];
}