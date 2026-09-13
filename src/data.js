/* data/ 以下のJSONを読み込んで、参照しやすい形に組み立てる */

import { answerMode, normalizeHints } from "./answer-mode.js";
import { panelLayout } from "./engine.js";

const SUBJECT_FILES = ["kokugo", "sansu", "rika", "shakai", "gaikokugo", "joho"];

async function json(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} を読み込めませんでした (${res.status})`);
  return res.json();
}

export async function loadDatabase(base = "./data") {
  // ビルド済み単一ファイルの場合は、あらかじめ埋め込まれたものを使う
  if (globalThis.__EMBEDDED_DB__) return index(globalThis.__EMBEDDED_DB__);

  const [questionSets, figures, heroes, extensions,
         advice, titles, crystals, images] = await Promise.all([
    Promise.all(SUBJECT_FILES.map(f => json(`${base}/questions/${f}.json`))),
    json(`${base}/figures.json`),
    json(`${base}/heroes.json`),
    json(`${base}/extensions.json`),
    json(`${base}/advice.json`),
    json(`${base}/titles.json`),
    json(`${base}/crystals.json`),
    json(`${base}/images.json`),
  ]);
  return index({ questions: questionSets.flat(), figures, heroes, extensions,
                 advice, titles, crystals, images });
}

function index(raw) {
  const db = { ...raw };
  /* ヒントは読み込み時に {text, only} へ揃える。文字列のままのものは
     only を持たないので、choice でも hidden でも使われる（後方互換）。
     回答方式もここで1度だけ決めて焼き込む。判定を画面側でやり直さない */
  db.questions.forEach(q => {
    q.hints = normalizeHints(q.hints || []);
    q.mode = answerMode(q);
    // 盤面もここで1度だけ作る。引けなければ消去法へ落とす（決定4のフォールバック）
    if (q.mode === "panel") {
      q.panel = panelLayout(q.reading, q.id);
      if (!q.panel) q.mode = "elimination";
    }
  });
  db.byId = Object.fromEntries(db.questions.map(q => [q.id, q]));
  db.heroById = Object.fromEntries(db.heroes.map(h => [h.id, h]));
  db.crystalById = Object.fromEntries((db.crystals?.crystals || []).map(c => [c.id, c]));
  db.photos = db.images?.images || {};
  // 教科 ↔ 族。クラフトの要求先と、どの教科を解けばその族が貯まるかを結ぶ
  db.families = db.crystals?.families || [];
  db.subjectToFamily = db.crystals?.subjectToFamily || {};
  db.familyToSubject = Object.fromEntries(
    Object.entries(db.subjectToFamily).map(([s, f]) => [f, s]));

  // 知識カード名 → 教科（チャレンジのゲージ計算で使う）
  db.cardSubject = {};
  db.questions.forEach(q => {
    db.cardSubject[q.card] = q.subject;
    db.cardSubject[q.card + "（応用）"] = q.subject;
  });
  return db;
}

/* ビルド済み単一ファイルでは data URI に差し替わる。
   背景だけは埋め込み用に縮小したコピー（public/backgrounds/small）が入る */
export const assetPath = {
  hero: id => globalThis.__ASSETS__?.["h" + id] ?? `./public/heroes/${id}.webp`,
  bg:   id => globalThis.__ASSETS__?.["b" + id] ?? `./public/backgrounds/${id}.webp`,
  icon: name => globalThis.__ASSETS__?.["i" + name] ?? `./public/icons/${name}.webp`,
  ext:  id => globalThis.__ASSETS__?.["e" + id] ?? `./public/extensions/${id}.webp`,
  crystal: id => globalThis.__ASSETS__?.["c" + id] ?? `./public/materials/crystals/${id}.webp`,
  /* コモンズの写真。単一ファイル版には small/ の縮小コピーだけを畳む */
  photo: file => globalThis.__ASSETS__?.["p" + file] ?? `./public/commons/${file}.webp`,
  /* 解放前の英雄を見せるための Rep.画像。原本は id + 10000 */
  rep:  id => assetPath.hero(String(Number(id) + 10000)),
};
