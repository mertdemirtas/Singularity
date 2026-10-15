#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_root="$project_root"
staging_dir=""

# node-gyp cannot compile some Theia dependencies when the project path has spaces.
if [[ "$project_root" == *" "* ]]; then
  staging_dir="$(mktemp -d /tmp/plain-editor-setup.XXXXXX)"
  trap 'rm -rf -- "$staging_dir"' EXIT
  cp "$project_root/package.json" "$project_root/package-lock.json" "$staging_dir/"
  mkdir -p "$staging_dir/extensions"
  cp -a "$project_root/extensions/plain-editor-ui" "$staging_dir/extensions/"
  install_root="$staging_dir"
fi

(
  cd "$install_root"
  npm ci --no-audit --no-fund
  npm rebuild drivelist node-pty keytar @parcel/watcher @theia/ffmpeg electron
  npm run download:languages
)

if [[ -n "$staging_dir" ]]; then
  mkdir -p "$project_root/node_modules" "$project_root/plugins"
  cp -a "$staging_dir/node_modules/." "$project_root/node_modules/"
  cp -a "$staging_dir"/plugins/vscode.* "$project_root/plugins/"
fi

cd "$project_root"
node scripts/configure-sandbox.cjs
npm run build:release
