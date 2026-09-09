#!/usr/bin/env node
/* 問題DBの整合性チェック。CIで走らせる。
   使い方: npm run validate                                        */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_LENGTH = 10;
const SUBJECTS = ["国語", "算数・数学", "理科", "社会", "外国語", "情報"];
const GRADES = ["e1","e2","e3","e4","e5","e6","j1","j2","j3","w"];
const BANDS = { e: ["e1","e2","e3","e4","e5","e6"], j: ["j1","j2","j3"], w: ["w"] };

const errors = [];
const warnings = [];
const err  = (id, msg) => errors.push(`${id}: ${msg}`);
const warn = (msg) => warnings.push(msg);

const json = async p => JSON.parse(await readFile(join(ROOT, p), "utf8"));

const questions = [];
for (const file of await readdir(join(ROOT, "data/questions"))) {
  if (!file.endsWith(".json")) continue;
  const list = await json(`data/questions/${file}`);
  if (!Array.isArray(list)) { err(file, "配列ではありません"); continue; }
  list.forEach(q => questions.push({ ...q, _file: file }));
}
const figures    = await json("data/figures.json");
const heroes     = await json("data/heroes.json");
const extensions = await json("data/extensions.json");
const gemstones  = await json("data/gemstones.json");

/* ---- 1問ごとの検証 ---- */
const seenIds = new Set();
const promptsBySubject = {};

for (const q of questions) {
  const id = q.id || `(id未設定 in ${q._file})`;

  for (const k of ["id","chapter","grade","gradeLabel","subject","unit","prompt","choices","answer","hints","lesson","tip","card"]) {
    if (q[k] === undefined || q[k] === null || q[k] === "") err(id, `必須項目 ${k} がありません`);
  }
  if (seenIds.has(q.id)) err(id, "IDが重複しています");
  seenIds.add(q.id);

  if (!SUBJECTS.includes(q.subject)) err(id, `未知の教科 "${q.subject}"`);
  if (!GRADES.includes(q.grade))     err(id, `未知の学年キー "${q.grade}"`);
  if (!gemstones.subjectToGem[q.subject]) err(id, `教科 "${q.subject}" に対応する魔石がありません`);

  if (!Array.isArray(q.choices) || q.choices.length < 2) err(id, "選択肢が2つ未満です");
  else {
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length)
      err(id, `answer が選択肢の範囲外です (${q.answer} / 0-${q.choices.length - 1})`);
    if (new Set(q.choices).size !== q.choices.length) err(id, "選択肢に重複があります");
  }

  if (!Array.isArray(q.hints) || q.hints.length !== 3) err(id, "ヒントは3つ必要です");
  else {
    // 第3ヒントが正解をそのまま書いていないか
    const answerText = q.choices?.[q.answer] ?? "";
    const bare = String(answerText).replace(/[\s。、]/g, "");
    if (bare.length >= 2 && q.hints[2] && q.hints[2].replace(/[\s。、]/g, "").includes(bare))
      warn(`${id}: 第3ヒントに正解「${answerText}」がそのまま含まれています`);
  }

  if (q.figure && !figures[q.figure]) err(id, `図版 "${q.figure}" が figures.json にありません`);
  if (q.commons && !q.license) err(id, "画像問題にライセンス情報がありません");

  if (q.applied) {
    const a = q.applied;
    if (!Array.isArray(a.choices) || a.choices.length < 2) err(id, "応用編の選択肢が2つ未満です");
    else if (!Number.isInteger(a.answer) || a.answer < 0 || a.answer >= a.choices.length)
      err(id, "応用編の answer が範囲外です");
  }

  (promptsBySubject[q.subject] ??= new Map());
  const key = q.prompt.replace(/\s/g, "");
  if (promptsBySubject[q.subject].has(key))
    err(id, `同じ教科に同一の問題文があります（${promptsBySubject[q.subject].get(key)}）`);
  promptsBySubject[q.subject].set(key, q.id);
}

/* ---- 英雄 ---- */
const heroIds = new Set();
for (const h of heroes) {
  if (heroIds.has(h.id)) err(h.id, "英雄IDが重複しています");
  heroIds.add(h.id);
  if (h.ch) {
    if (!Array.isArray(h.ch.v) || h.ch.v.length !== 4)
      err(h.name, "チャレンジの問い方は4段階必要です");
    if (!Array.isArray(h.ch.ans) || h.ch.ans.length === 0)
      err(h.name, "チャレンジの受理解答がありません");
  }
  if (h.rel) {
    h.rel.subjects.forEach(s => {
      if (!SUBJECTS.includes(s)) err(h.name, `未知の関連教科 "${s}"`);
    });
    h.rel.cards.forEach(c => {
      if (!questions.some(q => q.card === c))
        err(h.name, `関連カード "${c}" に対応する問題がありません`);
    });
  }
}

/* ---- エクステンション ---- */
for (const [k, e] of Object.entries(extensions)) {
  Object.keys(e.cost).forEach(g => {
    if (!gemstones.gems[g]) err(k, `未知の魔石 "${g}"`);
  });
  e.subs.forEach(s => { if (!SUBJECTS.includes(s)) err(k, `未知の分野 "${s}"`); });
}

/* ---- 在庫（同じ問題が繰り返し出る原因になる） ---- */
const stock = (band, subject) => questions.filter(q =>
  (band === "auto" || BANDS[band].includes(q.grade)) &&
  (subject === "auto" || q.subject === subject)).length;

const table = [];
for (const s of SUBJECTS) {
  const row = { 教科: s, 全体: stock("auto", s) };
  for (const b of ["e", "j", "w"]) row[{ e: "小", j: "中", w: "世" }[b]] = stock(b, s);
  table.push(row);
  if (row.全体 > 0 && row.全体 < RUN_LENGTH)
    warn(`在庫不足: ${s} は ${row.全体}問しかありません（1セッション ${RUN_LENGTH}問）`);
  if (row.全体 === 0) warn(`在庫ゼロ: ${s} に問題がありません`);
}

/* ---- 出力 ---- */
console.log(`\n問題 ${questions.length}問 / 英雄 ${heroes.length}体 / エクステンション ${Object.keys(extensions).length}種\n`);
console.table(table);

if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  warnings.forEach(w => console.log("  - " + w));
}
if (errors.length) {
  console.log(`\n✗ エラー ${errors.length}件`);
  errors.forEach(e => console.log("  - " + e));
  process.exit(1);
}
console.log("\n✓ 検証を通過しました\n");
