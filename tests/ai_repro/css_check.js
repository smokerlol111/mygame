// MINOR-01: finds CSS selectors in public/*.html <style> blocks whose element name contains an
// escape sequence (e.g. a literal "\n" typed into the CSS, which CSS reads as an element named "n").
// Usage: node tests/ai_repro/css_check.js        Exit code 1 = broken selector found.
const fs = require('fs'), path = require('path');
const csstree = require('css-tree');
const pub = path.resolve(__dirname, '..', '..', 'public');
let found = 0;
for (const file of fs.readdirSync(pub).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(pub, file), 'utf8');
  for (const m of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    const ast = csstree.parse(m[1], { positions: true });
    const styleStartLine = html.slice(0, m.index + '<style>'.length).split('\n').length;
    csstree.walk(ast, { visit: 'TypeSelector', enter(node) {
      if (/\\/.test(node.name)) {
        found++;
        const line = styleStartLine + node.loc.start.line - 1;
        console.log(`${file}: element selector "${node.name}" (an escaped character, matches no real element) near line ${line}`);
      }
    } });
  }
}
console.log(found ? '  => REPRODUCED' : '  => NOT REPRODUCED (no escaped element selectors)');
process.exitCode = found ? 1 : 0;
