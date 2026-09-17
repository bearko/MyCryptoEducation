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
         advice, titles, crystals, images, subjects, battle] = await Promise.all([
    Promise.all(SUBJECT_FILES.map(f => json(`${base}/questions/${f}.json`))),
    json(`${base}/figures.json`),
    json(`${base}/heroes.json`),
    json(`${base}/extensions-curated.json`),
    json(`${base}/advice.json`),
    json(`${base}/titles.json`),
    json(`${base}/crystals.json`),
    json(`${base}/images.json`),
    json(`${base}/subjects.json`),
    json(`${base}/battle-stats.json`),
  ]);
  return index({ questions: questionSets.flat(), figures, heroes, curated: extensions,
                 advice, titles, crystals, images, subjects, battle });
}

/**
 * **エクステンションの釣り合いは、台帳から導きます。手で書きません。**
 *
 * `data/extensions-curated.json` に書くのは、由来が参照できる事実だけ
 * （名前・系統・ランク・またがる教科・由来）。ゲージ寄与もクリスタルの要求も
 * 知識カードの条件も、ランクとまたがる教科から機械的に決めます。
 * 品を足すときに数字を釣り合わせる手間が要らず、釣り合いが崩れることもありません。
 *
 * ランクは**由来がいくつの教科にまたがるか**で決まります。MCHのレアリティは使いません。
 * 上位レアリティだけを見ていると、算数・数学がゼロのままになるためです。
 */
export const RANKS = {
  初伝: { gauge: 15, crystals: 50,  cards: 5 },
  中伝: { gauge: 30, crystals: 150, cards: 8 },
  奥伝: { gauge: 60, crystals: 400, cards: 12 },
};
export const RANK_ORDER = ["初伝", "中伝", "奥伝"];

export function buildExtensions(curated, crystals) {
  const toFamily = crystals?.subjectToFamily || {};
  const out = {};
  for (const e of curated || []) {
    const r = RANKS[e.rank] || RANKS.初伝;
    const subs = e.subjects || [];

    // クリスタルは、またがる教科ぶんの族へ均等に割る。端数は先頭の族が持つ
    const fams = [...new Set(subs.map(s => toFamily[s]).filter(Boolean))];
    const crystalsNeed = {};
    if (fams.length) {
      const each = Math.max(10, Math.round(r.crystals / fams.length / 10) * 10);
      fams.forEach((f, i) => { crystalsNeed[f] = i === 0 ? r.crystals - each * (fams.length - 1) : each; });
    }

    // **知識カードは、またがる教科それぞれで要る。** ここがクイズとクラフトをつなぐ回路
    const cards = {};
    subs.forEach(sub => { cards[sub] = r.cards; });

    out[e.id] = {
      id: e.id, name: e.name, series: e.series, rank: e.rank,
      subs, gauge: r.gauge, crystals: crystalsNeed, cards,
      origin: e.origin, upgrade: e.upgrade || null, mchRarity: e.mchRarity,
      // 由来カード。奥伝だけが持つ。その品の元になった問いを解くと手に入る
      originCard: e.originCard || null,
    };
  }
  return out;
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
  /* 教科ごとの英雄・背景・エネミー。**絵の話しか入っていません** ——
     どの学年を出すかは知識マップから導くので、ここには持たせません */
  db.subjectArt = db.subjects?.subjects || {};
  db.defaultBg = db.subjects?.defaultBg || "1030";
  db.extensions = buildExtensions(db.curated, db.crystals);

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
  /* 設問に割り当たるエネミー。IDの並びが教科に対応している */
  enemy: id => globalThis.__ASSETS__?.["y" + id] ?? `./public/enemies/${id}.webp`,
  /* マインちゃん。原本は 96x128 のドット絵なので pixelated で出す */
  navi: name => globalThis.__ASSETS__?.["n" + name] ?? `./public/characters/${name}.webp`,
  /* 攻撃が当たったときの絵。900x900 に 100px のコマが9×9 並んだシート */
  fx: name => globalThis.__ASSETS__?.["f" + name] ?? `./public/effects/${name}.webp`,
};
