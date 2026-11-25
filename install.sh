#!/usr/bin/env bash
set -euo pipefail

REPO="${FFM_REPO:-https://github.com/oneuse1337/fuck-figma-mcp}"
BRANCH="${FFM_BRANCH:-main}"
DIR="${FFM_DIR:-$HOME/.fuck-figma-mcp}"
NAME="${FFM_NAME:-fuck-figma-mcp}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\033[2m→\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js 18 or newer is required. Get it from https://nodejs.org and run this again."
command -v npm >/dev/null 2>&1 || die "npm is missing. Reinstall Node.js from https://nodejs.org and run this again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js $(node -v) is too old. Install Node.js 18 or newer from https://nodejs.org."

SELF="${BASH_SOURCE[0]:-}"
LOCAL=""
if [ -n "$SELF" ] && [ -f "$SELF" ]; then
  LOCAL="$(cd "$(dirname "$SELF")" && pwd)"
  [ -f "$LOCAL/server.mjs" ] && [ -f "$LOCAL/plugin/manifest.json" ] || LOCAL=""
fi

if [ -n "$LOCAL" ]; then
  DIR="$LOCAL"
  step "Using local copy in $DIR"
elif [ -d "$DIR/.git" ] && command -v git >/dev/null 2>&1; then
  step "Updating $DIR"
  git -C "$DIR" pull --ff-only --quiet
elif command -v git >/dev/null 2>&1; then
  [ -e "$DIR" ] && die "$DIR already exists and is not a git checkout. Remove it or set FFM_DIR to another folder."
  step "Cloning $REPO into $DIR"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
else
  command -v curl >/dev/null 2>&1 || die "Neither git nor curl is installed. Install one of them and run this again."
  step "Downloading $REPO into $DIR"
  mkdir -p "$DIR"
  curl -fsSL "$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz --strip-components=1 -C "$DIR"
fi

step "Installing dependencies"
(cd "$DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error --update-notifier=false)

SERVER="$DIR/server.mjs"
NODE_BIN="$(command -v node)"

if command -v claude >/dev/null 2>&1; then
  step "Registering MCP server \"$NAME\" in Claude Code"
  claude mcp remove --scope user "$NAME" >/dev/null 2>&1 || true
  claude mcp add --scope user "$NAME" -- "$NODE_BIN" "$SERVER" >/dev/null
  REGISTERED=1
else
  REGISTERED=0
fi

echo
bold "fuck-figma-mcp is installed"
echo
if [ "$REGISTERED" = 1 ]; then
  echo "  Claude Code: added as \"$NAME\" (user scope). Restart Claude Code or run /mcp to load it."
else
  echo "  Claude Code was not found. Add this to your MCP client config (Claude Desktop, Cursor, etc.):"
  echo
  printf '    "%s": { "command": "%s", "args": ["%s"] }\n' "$NAME" "$NODE_BIN" "$SERVER"
fi
echo
echo "  In the Figma desktop app, once:"
echo "    Plugins → Development → Import plugin from manifest…"
echo "    $DIR/plugin/manifest.json"
echo
echo "  Then in every file you want the AI to edit:"
echo "    Plugins → Development → fuck-figma-mcp"
echo
