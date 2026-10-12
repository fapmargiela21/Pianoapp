#!/bin/sh
# Rebuilds js/vendor/basic-pitch.js and js/vendor/basic-pitch-model/ from npm.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root="$here/../.."
work=$(mktemp -d)
cd "$work"
npm init -y >/dev/null
npm i -s @spotify/basic-pitch@1.0.1 esbuild@0.23.1 >/dev/null
echo 'export class Midi {}' > midi-stub.js
cp "$here/entry.js" .
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=eof \
  --alias:@tonejs/midi=./midi-stub.js --outfile="$root/js/vendor/basic-pitch.js"
mkdir -p "$root/js/vendor/basic-pitch-model"
cp node_modules/@spotify/basic-pitch/model/* "$root/js/vendor/basic-pitch-model/"
cp node_modules/@spotify/basic-pitch/LICENSE "$root/js/vendor/basic-pitch-model/LICENSE"
rm -rf "$work"
