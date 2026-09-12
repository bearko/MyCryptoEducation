#!/usr/bin/env node
/* 問題DBの整合性チェック。CIで走らせる。
   使い方: npm run validate                                        */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
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
const crystals   = await json("data/crystals.json");
const curriculum = await json("data/curriculum.json");

/* ---- 1問ごとの検証 ---- */
const seenIds = new Set();
const promptsBySubject = {};
const allPrompts = new Map();
const cardOwner = new Map();

for (const q of questions) {
  const id = q.id || `(id未設定 in ${q._file})`;

  const format = q.format || "choice";
  if (!["choice", "range"].includes(format)) err(id, `未知の出題形式 "${format}"`);

  const common = ["id","chapter","grade","gradeLabel","subject","unit","prompt","hints","lesson","tip","card"];
  const needed = format === "range" ? [...common, "year"] : [...common, "choices", "answer"];
  for (const k of needed) {
    if (q[k] === undefined || q[k] === null || q[k] === "") err(id, `必須項目 ${k} がありません`);
  }
  if (seenIds.has(q.id)) err(id, "IDが重複しています");
  seenIds.add(q.id);

  if (!SUBJECTS.includes(q.subject)) err(id, `未知の教科 "${q.subject}"`);
  if (!GRADES.includes(q.grade))     err(id, `未知の学年キー "${q.grade}"`);
  // カリキュラムに無い組み合わせに問題を置くと、どの教育課程にも対応しない作り物になる
  const shape = curriculum.exists[q.subject];
  if (shape && !shape.includes(q.grade))
    err(id, `${q.subject} は ${q.grade} に存在しません（data/curriculum.json）`);
  if (!gemstones.subjectToGem[q.subject]) err(id, `教科 "${q.subject}" に対応する魔石がありません`);

  if (format === "range") {
    if (!Number.isInteger(q.year)) err(id, `year は整数で書いてください（紀元前は負の数）`);
    else if (q.year > new Date().getFullYear()) err(id, `year が未来です (${q.year})`);
    if (q.choices || q.answer !== undefined) err(id, "レンジ回答に choices / answer は要りません");
    if (q.precision !== undefined && !(q.precision > 0)) err(id, `precision は正の数にしてください (${q.precision})`);
    if (q.applied) err(id, "レンジ回答の応用編はまだ扱えません");
  } else if (!Array.isArray(q.choices) || q.choices.length < 2) err(id, "選択肢が2つ未満です");
  else {
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length)
      err(id, `answer が選択肢の範囲外です (${q.answer} / 0-${q.choices.length - 1})`);
    if (new Set(q.choices).size !== q.choices.length) err(id, "選択肢に重複があります");
  }

  if (!Array.isArray(q.hints) || q.hints.length !== 3) err(id, "ヒントは3つ必要です");
  else if (format === "range") {
    // 第3ヒントが年をそのまま書いていないか
    if (q.hints[2] && String(q.hints[2]).includes(String(q.year)))
      warn(`${id}: 第3ヒントに正解の年「${q.year}」がそのまま書かれています`);
  } else {
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

  // 教科をまたいだ重複も見る。数が増えるほど起きやすい
  if (allPrompts.has(key)) err(id, `他の教科に同一の問題文があります（${allPrompts.get(key)}）`);
  allPrompts.set(key, q.id);

  // 知識カード名の重複。同じ名前だとゲージ計算でひとまとめに数えられてしまう
  if (cardOwner.has(q.card) && cardOwner.get(q.card) !== q.id)
    warn(`${id}: 知識カード「${q.card}」が ${cardOwner.get(q.card)} と重複しています`);
  else cardOwner.set(q.card, q.id);
}

/* ---- 英雄 ---- */
const heroIds = new Set();
for (const h of heroes) {
  if (heroIds.has(h.id)) err(h.id, "英雄IDが重複しています");
  heroIds.add(h.id);
  if (h.ch) {
    const CH_NEED = { Common: 1, Uncommon: 1, Rare: 2, Epic: 2, Legendary: 3 };
    if (!Array.isArray(h.ch.qs) || h.ch.qs.length !== 3)
      err(h.name, `チャレンジは3問構成にしてください（いま ${h.ch.qs?.length ?? 0}問）`);
    (h.ch.qs || []).forEach((q, i) => {
      const at = `${h.name} 第${i + 1}問`;
      if (!Array.isArray(q.v) || q.v.length !== 4) err(at, "問い方は4段階必要です");
      else {
        // 段階が進むほどやさしくなるように、v は難しい順に並べる。
        // 目安として、後ろほど長いか同じくらいの説明が付いているはず
        if (q.v.some(t => typeof t !== "string" || !t.trim())) err(at, "空の問い方があります");
        if (new Set(q.v).size !== q.v.length) err(at, "同じ問い方が重複しています");
      }
      if (!Array.isArray(q.ans) || q.ans.length === 0) err(at, "受理解答がありません");
      else if (q.ans.some(a => typeof a !== "string" || !a.trim())) err(at, "空の受理解答があります");
      // 問い方の中に答えがそのまま入っていないか
      (q.v || []).forEach((t, k) => {
        const bare = String(q.ans[0]).replace(/[\s。、]/g, "");
        if (bare.length >= 2 && String(t).replace(/[\s。、]/g, "").includes(bare))
          warn(`${at} 段階${k}: 問い方に答え「${q.ans[0]}」がそのまま入っています`);
      });
    });
    if (!CH_NEED[h.rarity]) err(h.name, `レアリティ "${h.rarity}" の必要正答数が決まっていません`);
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
const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
for (const [k, e] of Object.entries(extensions)) {
  for (const f of ["name", "line", "rarity", "subs", "gauge", "cost", "text"]) {
    if (e[f] === undefined || e[f] === null || e[f] === "") err(k, `必須項目 ${f} がありません`);
  }
  if (!RARITIES.includes(e.rarity)) err(k, `未知のレアリティ "${e.rarity}"`);
  Object.keys(e.cost).forEach(g => {
    if (!gemstones.gems[g]) err(k, `未知の魔石 "${g}"`);
  });
  e.subs.forEach(s => { if (!SUBJECTS.includes(s)) err(k, `未知の分野 "${s}"`); });
  // 下位は実在して、1段だけ下であること
  if (e.below) {
    const b = extensions[e.below];
    if (!b) err(k, `下位 "${e.below}" がありません`);
    else if (RARITIES.indexOf(b.rarity) !== RARITIES.indexOf(e.rarity) - 1)
      err(k, `下位 "${e.below}" のレアリティが1段下ではありません（${b.rarity}）`);
    else if (b.line !== e.line) err(k, `下位 "${e.below}" が別の系統です（${b.line}）`);
  }
  if (e.rarity === "Common" && e.crystal) err(k, "Commonにクリスタルを要求しないでください");
  if (e.rarity === "Legendary" && !e.cards)
    err(k, "Legendaryには知識カードの所持を条件に入れてください（素材だけで最上位が手に入らないように）");
  if (!existsSync(join(ROOT, `public/extensions/${k}.webp`)))
    err(k, "画像が public/extensions にありません");
}

// 8系統 × 5レアリティが揃っているか
const byLine = {};
for (const [k, e] of Object.entries(extensions)) (byLine[e.line] ??= []).push(e.rarity);
for (const [line, rs] of Object.entries(byLine)) {
  const missing = RARITIES.filter(r => !rs.includes(r));
  if (missing.length) err(line, `レアリティが欠けています: ${missing.join(", ")}`);
}

/* ---- クリスタル ---- */
const FAMILIES = ["貴金属", "宝石", "元素", "鉱石", "生物起源", "石英"];
const crystalIds = new Set();
for (const c of crystals.crystals || []) {
  const id = c.id || "(id未設定)";
  if (crystalIds.has(c.id)) err(id, "クリスタルIDが重複しています");
  crystalIds.add(c.id);
  if (!/^\d{3}$/.test(String(c.id))) err(id, "IDは3桁の数字にしてください");
  for (const k of ["name", "en", "family", "scarcity", "fact"]) {
    if (c[k] === undefined || c[k] === null || c[k] === "") err(id, `必須項目 ${k} がありません`);
  }
  if (!FAMILIES.includes(c.family)) err(id, `未知の族 "${c.family}"`);
  if (typeof c.scarcity !== "number" || !(c.scarcity > 0) || c.scarcity > 100)
    err(id, `希少度が 0〜100% の範囲にありません (${c.scarcity})`);
  // 図鑑のアートが取れているか
  if (!existsSync(join(ROOT, `public/materials/crystals/${c.id}.webp`)))
    err(id, "アートが public/materials/crystals にありません");
}

/* ---- 在庫（同じ問題が繰り返し出る原因になる） ---- */
const stock = (band, subject) => questions.filter(q =>
  (band === "auto" || BANDS[band].includes(q.grade)) &&
  (subject === "auto" || q.subject === subject)).length;

const GRADE_LABEL = { e1: "小1", e2: "小2", e3: "小3", e4: "小4", e5: "小5", e6: "小6",
                      j1: "中1", j2: "中2", j3: "中3", w: "世界" };
const cell = {};
questions.forEach(q => { cell[q.subject + "|" + q.grade] = (cell[q.subject + "|" + q.grade] || 0) + 1; });

/* 教科 × 学年のマス目。「−」はカリキュラムに存在しない組み合わせ */
const table = [];
let realCells = 0, emptyCells = 0, thinCells = 0;
for (const s of SUBJECTS) {
  const shape = curriculum.exists[s] || GRADES;
  const row = { 教科: s };
  for (const g of GRADES) {
    if (!shape.includes(g)) { row[GRADE_LABEL[g]] = "−"; continue; }
    realCells++;
    const n = cell[s + "|" + g] || 0;
    if (n === 0) emptyCells++;
    // 1マスが1セッションぶんに満たないと、その学年を選んだ人の体験が薄いまま終わる
    else if (n < RUN_LENGTH) thinCells++;
    row[GRADE_LABEL[g]] = n || "・";
  }
  row.計 = stock("auto", s);
  table.push(row);
  if (row.計 > 0 && row.計 < RUN_LENGTH)
    warn(`在庫不足: ${s} は ${row.計}問しかありません（1セッション ${RUN_LENGTH}問）`);
  if (row.計 === 0) warn(`在庫ゼロ: ${s} に問題がありません`);
}
for (const s of SUBJECTS) {
  const shape = curriculum.exists[s] || GRADES;
  const holes = shape.filter(g => !(cell[s + "|" + g] || 0)).map(g => GRADE_LABEL[g]);
  if (holes.length) warn(`空きマス: ${s} の ${holes.join("・")} に問題がありません`);
  const thin = shape.filter(g => {
    const n = cell[s + "|" + g] || 0;
    return n > 0 && n < RUN_LENGTH;
  }).map(g => `${GRADE_LABEL[g]}(${cell[s + "|" + g]})`);
  if (thin.length) warn(`1セッションに満たないマス: ${s} の ${thin.join("・")}`);
}

/* ---- 出力 ---- */
console.log(`\n問題 ${questions.length}問 / 英雄 ${heroes.length}体 / エクステンション ${Object.keys(extensions).length}種（${Object.keys(byLine).length}系統） / クリスタル ${(crystals.crystals || []).length}種\n`);
console.table(table);
console.log(`実在マス ${realCells} ・ 空き ${emptyCells} ・ ${RUN_LENGTH}問未満 ${thinCells}` +
  `　（「−」はカリキュラムに無い組み合わせ）`);

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
