#!/usr/bin/env bash
set -euo pipefail
kernel=$(uname -r)
tag=v3.1.20260906
dkms_version=${tag#v}
package="amneziawg/$dkms_version"
trees="/usr/src/amneziawg-$dkms_version"

apt-get update
apt-get install -y --no-install-recommends dkms build-essential kmod "linux-headers-$kernel"
# Follow the Ubuntu kernel flavour when it has a headers metapackage.
flavour=${kernel#*-}
flavour=${flavour#*-}
if apt-cache show "linux-headers-$flavour" >/dev/null 2>&1; then
    apt-get install -y --no-install-recommends "linux-headers-$flavour"
fi

if [[ ! -f $trees/dkms.conf ]]; then
    tmp=$(mktemp -d)
    trap 'rm -rf -- "$tmp"' EXIT
    git clone --quiet --depth 1 --branch "$tag" https://github.com/amnezia-vpn/amneziawg-linux-kernel-module.git "$tmp/source"
    sed -i "s/^PACKAGE_VERSION=.*/PACKAGE_VERSION=\"$dkms_version\"/" "$tmp/source/src/dkms.conf"
    make -C "$tmp/source/src" dkms-install DKMSDIR="$trees"
fi
dkms install "$package" -k "$kernel"
modprobe wireguard
modprobe amneziawg
printf 'wireguard\namneziawg\n' > /etc/modules-load.d/swg-node.conf
sysctl -w net.ipv4.ip_forward=1
printf 'net.ipv4.ip_forward = 1\n' > /etc/sysctl.d/90-swg-node.conf
