#!/bin/bash
# Code rules that can be read from the files (docs/SECURITY.md section 4): no innerHTML/insertAdjacentHTML/document.write,
# no eval or Function, no inline scripts, styles or handlers in pages, CSP + robots + core loads in every page, no
# account name or full site address, nothing loaded from outside the site.
cd "$(dirname "$0")/../.."
fail=0
bad() { echo "  FAIL $*"; fail=1; }
CODE="assets/js/*.js assets/js/widgets/*.js"
grep -n "\.innerHTML\s*=\|insertAdjacentHTML\|outerHTML\s*=\|document\.write" $CODE | grep -vE "^[^:]+:[0-9]+:\s*(\*|//)" | grep -v "^assets/js/hn-dom.js:.*tpl.innerHTML = svg" && bad "innerHTML-style writes outside the template parser"
grep -nE "\beval\(|new Function|[^.a-zA-Z]Function\(" $CODE && bad "eval or Function"
for p in *.html; do
  head -4 "$p" | grep -q 'http-equiv="Content-Security-Policy"' || bad "$p: CSP must be the first head element"
  grep -q '<meta name="robots" content="noindex, nofollow">' "$p" || bad "$p: robots noindex"
  grep -q '/dame-hub/core/v1/core.js' "$p" || bad "$p: core not loaded"
  grep -nE '<script>|<script [^>]*>[^<]|\son[a-z]+="|\sstyle="|<style' "$p" && bad "$p: inline script, handler or style"
  grep -nE '(src|href)="https?://' "$p" && bad "$p: loads something from outside"
done
ACCOUNT="niyaz""8951"; PAGES="github"".io"
grep -rnIi "$ACCOUNT\|$PAGES" --exclude-dir=.git --exclude-dir=vendor . && bad "account name or site address in the repo"
grep -rnI "https://cdn\|googleapis\|fonts.g" --include=*.html --include=*.css --include=*.js --exclude-dir=.git --exclude-dir=vendor . && bad "CDN or outside font"
diff <(ls assets/js/widgets | sed 's/\.js$//' | sort) <(node -e "globalThis.window=globalThis;window.HN={};require('./assets/js/widgets.js');console.log(window.HVACWidgets.NAMES.slice().sort().join('\n'))") > /dev/null || bad "widgets.js NAMES differs from assets/js/widgets/"
[ $fail = 0 ] && echo "code rules: ok"
exit $fail
