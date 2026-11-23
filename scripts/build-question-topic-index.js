const fs = require('node:fs');
const path = require('node:path');
const { loadBank, SNAPSHOT } = require('../server/question-bank/catalog');
const root = path.resolve(__dirname,'..');
const start = '<!-- QUESTION_TOPIC_INDEX_START -->', end = '<!-- QUESTION_TOPIC_INDEX_END -->';
const escape = value => String(value).replace(/\|/g,'\\|').replace(/\s+/g,' ').trim();

function renderIndex(rootDir=root) {
  const bank = loadBank(rootDir);
  const lines = [start,'## Спільний тематичний покажчик','','Архівні та нові затверджені питання об’єднані за темами. Початковий архів вище збережено без змін. Це посилальний покажчик, не нові затверджені копії: повний текст і відповідь знайдіть у цьому самому файлі за ID. Суфікси `:cat` і `:tripletN` позначають уже наявні вкладені питання архівного батьківського запису; нові підпитання мають власні ID.','','Для архіву рівень 1–5 — початковий рядок у категорії; для нових основних питань — призначений редактором рівень. Стартові, фінальні, глядацькі й суто класичні питання можуть не мати рядка ціни. Збережено всі формати, включно з тими, які потребують перегляду; наявність у покажчику не означає автоматичний допуск у кожну випадкову гру.','',`Разом: **${bank.entries.length} посилань** — ${bank.records.length} основних записів і ${bank.entries.length-bank.records.length} вкладених питань.`,''];
  for (const theme of bank.themes) {
    const entries = bank.entries.filter(entry=>entry.themeId===theme.id);
    lines.push(`### ${theme.name}`, '', `**${entries.length} записів.**`, '', '| Початковий ID | Категорія / роль | Рівень | Питання — орієнтир для пошуку |','|---|---|---|---|');
    for (const entry of entries) {
      const prompt = entry.payload.q || entry.payload.question || '';
      const excerpt = escape(prompt).slice(0,150) + (escape(prompt).length>150 ? '…' : '');
      lines.push(`| \`${entry.id}\` | ${escape(entry.category)}${entry.parentId ? ' · '+entry.kind : ''} | ${entry.difficulty || '—'} | ${excerpt} |`);
    }
    lines.push('');
  }
  lines.push(end);
  return lines.join('\n')+'\n';
}

function main(rootDir=root,verify=process.argv.includes('--verify')) {
const file = path.join(rootDir,'archive/QUESTION_BANK.md');
const bank = fs.readFileSync(file,'utf8');
if (!bank.startsWith(fs.readFileSync(path.join(rootDir,SNAPSHOT,'QUESTION_BANK.md'),'utf8'))) throw new Error('Архівний початок банку змінений.');
const begin = bank.indexOf(start), finish = bank.indexOf(end);
if (begin>=0 && finish<begin) throw new Error('Відсутній кінцевий маркер тематичного покажчика.');
const generated = renderIndex(rootDir);
if (verify) {
  if (begin<0 || finish<begin || bank.slice(begin,finish+end.length)+'\n' !== generated) throw new Error('Тематичний покажчик потребує оновлення.');
  console.log('PASS: approved-entry categories and thematic index verified; immutable bank prefix preserved');
} else {
  const updated = begin<0 ? bank.trimEnd()+'\n\n'+generated : bank.slice(0,begin)+generated+bank.slice(finish+end.length).replace(/^\r?\n/,'');
  fs.writeFileSync(file,updated);
  console.log('Updated thematic index; existing bank and approved section preserved.');
}
}
if(require.main===module)main();
module.exports={renderIndex,main};
