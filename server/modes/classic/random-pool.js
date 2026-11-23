const crypto = require('node:crypto');
const { validatePool } = require('./pool');
const { loadBank } = require('../../question-bank/catalog');

const normalize = value => value.normalize('NFKC').toLocaleLowerCase('uk').replace(/[\p{P}\p{Z}\s]/gu, '');

function candidatesFrom(records) {
  const seen = new Set(), ids = new Set(), questions = [];
  let duplicates = 0, excluded = 0;
  for (const record of records) {
    const question = record.payload;
    if (!['main','final','classic'].includes(record.kind) || !question || ![undefined,'text'].includes(question.type)
      || question.reviewRequired || question.cat || question.answerImage || question.media
      || typeof record.id !== 'string' || typeof question.q !== 'string' || typeof question.a !== 'string'
      || !question.q.trim() || !question.a.trim()) { excluded++; continue; }
    const key = normalize(question.q);
    if (seen.has(key) || ids.has(record.id)) { duplicates++; continue; }
    seen.add(key); ids.add(record.id);
    questions.push({ id:record.id, q:question.q, a:question.a, type:'text', points:1 });
  }
  return { questions, duplicates, excluded };
}

function createRandomPool(rootDir, requestedCount, randomInt = crypto.randomInt) {
  const { records } = loadBank(rootDir);
  const { questions, duplicates, excluded } = candidatesFrom(records);
  const count = Number(requestedCount);
  if (!Number.isInteger(count) || count < 1 || count > questions.length)
    throw new Error(`Оберіть цілу кількість від 1 до ${questions.length} питань.`);
  // Sampling without replacement, including a random order when selecting the entire pool.
  for (let i=questions.length-1;i>0;i--) {
    const j = randomInt(i+1);
    [questions[i],questions[j]] = [questions[j],questions[i]];
  }
  const pool = validatePool({title:`Випадковий квіз · ${count} питань`,questions:questions.slice(0,count)},rootDir);
  return { pool, available:questions.length, duplicates, excluded };
}

module.exports = { createRandomPool, candidatesFrom, normalize };
