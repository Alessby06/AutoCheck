{ pkgs }: {
  deps = [
    pkgs.nodejs-20_x
    pkgs.python310
    pkgs.python310Packages.pip
    pkgs.xorg.xvfb
    pkgs.chromium
    pkgs.glib
    pkgs.nss
    pkgs.fontconfig
  ];
}