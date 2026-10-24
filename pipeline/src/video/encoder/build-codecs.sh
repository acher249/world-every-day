#!/bin/bash
set -euo pipefail
export PKG_CONFIG_PATH=/opt/video/lib/pkgconfig
export LD_LIBRARY_PATH=/opt/video/lib
mkdir -p /opt/video/sources /opt/video/licenses
fetch() {
  curl -fsSL --retry 3 "$2" -o "$1"
  echo "$3  $1" | sha256sum -c -
  cp "$1" /opt/video/sources/
}
fetch ffmpeg.tar.xz https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz 05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41
fetch openh264.tar.gz https://github.com/cisco/openh264/archive/refs/tags/v2.6.0.tar.gz 558544ad358283a7ab2930d69a9ceddf913f4a51ee9bf1bfb9e377322af81a69
fetch libvpx.tar.gz https://github.com/webmproject/libvpx/archive/refs/tags/v1.15.2.tar.gz 26fcd3db88045dee380e581862a6ef106f49b74b6396ee95c2993a260b4636aa
fetch opus.tar.gz https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz 65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1
tar xf openh264.tar.gz
cd openh264-2.6.0
make -j4 ASM=No BUILDTYPE=Release PREFIX=/opt/video
make install-shared PREFIX=/opt/video
cp LICENSE /opt/video/licenses/openh264.txt
cd ..
tar xf libvpx.tar.gz
cd libvpx-1.15.2
./configure --prefix=/opt/video --target=generic-gnu --enable-shared --disable-static --disable-examples --disable-tools --disable-docs --disable-unit-tests
make -j4 && make install
cp LICENSE /opt/video/licenses/libvpx.txt
cd ..
tar xf opus.tar.gz
cd opus-1.5.2
./configure --prefix=/opt/video --enable-shared --disable-static --disable-extra-programs --disable-doc
make -j4 && make install
cp COPYING /opt/video/licenses/opus.txt
cd ..
tar xf ffmpeg.tar.xz
cd ffmpeg-8.0.1
./configure --prefix=/opt/video --enable-shared --disable-static --disable-gpl --disable-nonfree --disable-doc --disable-debug --disable-x86asm --disable-autodetect --enable-zlib --enable-libopenh264 --enable-libvpx --enable-libopus --disable-network
make -j4 && make install
cp COPYING.LGPLv2.1 LICENSE.md /opt/video/licenses/
/opt/video/bin/ffmpeg -L > /opt/video/licenses/ffmpeg-build.txt 2>&1
grep -q 'Lesser General Public License' /opt/video/licenses/ffmpeg-build.txt
cp /build/build-codecs.sh /opt/video/sources/
