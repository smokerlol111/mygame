const fs = require('node:fs');
const path = require('node:path');

function validatePool(input, rootDir) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.questions) || !input.questions.length)
    throw new Error('Потрібен непорожній набір questions із питаннями та відповідями.');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 750000) throw new Error('Набір завеликий для однієї кімнати.');
  const text = (value, label, maximum) => {
    if (!['string', 'number'].includes(typeof value)) throw new Error('Заповніть ' + label + '.');
    const result = String(value).trim();
    if (!result || result.length > maximum) throw new Error(label + ': від 1 до ' + maximum + ' символів.');
    return result;
  };
  const ids = new Set();
  const questions = input.questions.map((question, index) => {
    if (!question || typeof question !== 'object') throw new Error('Невірне питання №' + (index + 1));
    const id = text(question.id ?? 'q' + (index + 1), 'ID питання', 100);
    if (ids.has(id)) throw new Error('Повтор ID питання: ' + id);
    ids.add(id);
    const type = question.type || 'text';
    if (!['text', 'image', 'audio', 'video'].includes(type)) throw new Error('Невідомий тип питання №' + (index + 1));
    const points = question.points === undefined ? 1 : Number(question.points);
    if (!Number.isInteger(points) || points < 1 || points > 10000) throw new Error('Бали питання мають бути цілим числом від 1 до 10000.');
    let media = '';
    if (type !== 'text') {
      media = text(question.media, 'медіафайл', 300);
      if (!/^\/[a-zA-Z0-9_./-]+$/.test(media) || media.includes('..')) throw new Error('Медіа має посилатися на файл у public.');
      const extensions = { image: /\.(png|jpe?g|webp|gif)$/i, audio: /\.(mp3|wav|ogg)$/i, video: /\.(mp4|webm)$/i };
      const file = path.resolve(rootDir, 'public', media.slice(1));
      if (!extensions[type].test(media) || !file.startsWith(path.join(rootDir, 'public') + path.sep)
        || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Медіафайл не знайдено або його формат не відповідає типу питання.');
    }
    return { id, q: text(question.q, 'текст питання', 5000), a: text(question.a, 'правильну відповідь', 3000), type, media, points };
  });
  return { title: text(input.title, 'назву квізу', 120), questions };
}

module.exports = { validatePool };
