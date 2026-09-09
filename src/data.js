/* data/ 以下のJSONを読み込んで、参照しやすい形に組み立てる */

const SUBJECT_FILES = ["kokugo", "sansu", "rika", "shakai", "gaikokugo", "joho"];

async function json(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} を読み込めませんでした (${res.status})`);
  return res.json();
}

export async function loadDatabase(base = "./data") {
  // ビルド済み単一ファイルの場合は、あらかじめ埋め込まれたものを使う
  if (globalThis.__EMBEDDED_DB__) return index(globalThis.__EMBEDDED_DB__);

  const [questionSets, figures, heroes, extensions, gemstones] = await Promise.all([
    Promise.all(SUBJECT_FILES.map(f => json(`${base}/questions/${f}.json`))),
    json(`${base}/figures.json`),
    json(`${base}/heroes.json`),
    json(`${base}/extensions.json`),
    json(`${base}/gemstones.json`),
  ]);
  return index({ questions: questionSets.flat(), figures, heroes, extensions, gemstones });
}

function index(raw) {
  const db = { ...raw };
  db.byId = Object.fromEntries(db.questions.map(q => [q.id, q]));
  db.heroById = Object.fromEntries(db.heroes.map(h => [h.id, h]));
  db.gems = db.gemstones.gems;
  db.subjectToGem = db.gemstones.subjectToGem;

  // 知識カード名 → 教科（チャレンジのゲージ計算で使う）
  db.cardSubject = {};
  db.questions.forEach(q => {
    db.cardSubject[q.card] = q.subject;
    db.cardSubject[q.card + "（応用）"] = q.subject;
  });
  return db;
}

/* ビルド済み単一ファイルでは data URI に差し替わる */
export const assetPath = {
  hero: id => globalThis.__ASSETS__?.["h" + id] ?? `./public/heroes/${id}.webp`,
  gem:  id => globalThis.__ASSETS__?.["g" + id] ?? `./public/materials/gemstones/${id}.webp`,
};
