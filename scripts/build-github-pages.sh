#!/usr/bin/env bash
# Build the static Astro site for GitHub Pages.
# Output: dist/  →  https://davidkabera.github.io/federated-learning/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${CI:-}" != "true" ]]; then
	ulimit -n 65536 2>/dev/null || true
	if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
		# shellcheck source=/dev/null
		. "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
		nvm use
	fi
fi

if [[ "${CI:-}" == "true" ]] || [[ ! -d node_modules ]]; then
	npm ci
fi

npm run build

# GitHub Pages runs Jekyll unless this file exists; Astro assets live under _astro/.
touch dist/.nojekyll

echo "Built GitHub Pages site in dist/"
echo "Preview: npx astro preview --base /federated-learning"
echo "Live (after Actions deploy): https://davidkabera.github.io/federated-learning/"
