/* 出題ロジックと難易度ゲージの計算（純粋関数のみ・DOMに触れない） */

export const SUBJECTS = ["国語", "算数・数学", "理科", "社会", "外国語", "情報"];

export const GRADES = [
  { k: "e1", l: "1", band: "e" }, { k: "e2", l: "2", band: "e" },
  { k: "e3", l: "3", band: "e" }, { k: "e4", l: "4", band: "e" },
  { k: "e5", l: "5", band: "e" }, { k: "e6", l: "6", band: "e" },
  { k: "j1", l: "1", band: "j" }, { k: "j2", l: "2", band: "j" },
  { k: "j3", l: "3", band: "j" }, { k: "w",  l: "世", band: "w" },
];

const GRADE_ORDER = { e1: 1, e2: 2, e3: 3, e4: 4, e5: 5, e6: 6, j1: 7, j2: 8, j3: 9, w: 10 };

export const RUN_LENGTH = 10;

/* 解放済みの章。英雄の unlocks が新しい出題範囲を開く */
export function unlockedChapters(db, state) {
  const set = new Set([0, 1]);
  db.heroes.forEach(h => {
    if (state.owned[h.id] && h.unlocks != null) set.add(h.unlocks);
  });
  return set;
}

/* 指定した範囲で出題しうる問題（在庫） */
export function inventory(db, state, band = "auto", subject = "auto") {
  const open = unlockedChapters(db, state);
  return db.questions.filter(q => {
    if (!open.has(q.chapter)) return false;
    if (band !== "auto") {
      const g = GRADES.find(x => x.k === q.grade);
      if (!g || g.band !== band) return false;
    }
    if (subject !== "auto" && q.subject !== subject) return false;
    return true;
  });
}

/* 教科ごとの在庫内訳（出題選択画面の表示用） */
export function inventoryBySubject(db, state, band = "auto") {
  const out = {};
  SUBJECTS.forEach(s => { out[s] = inventory(db, state, band, s).length; });
  return out;
}

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export const cellKey = q => q.subject + "|" + q.grade;

/**
 * 1セッションぶんの出題を組む。
 *
 * ・同じ問題は絶対に2回出さない（在庫が足りなければ、その数だけ出題する）
 * ・知識マップの白いマスを最優先、次に未出題、最後に既出
 * ・最後の1問は必ず「いまの範囲の外」。無ければ最も遠い学年・章の問題
 */
export function buildRun(db, state, opts = {}) {
  const band = opts.band ?? state.select.band;
  const subject = opts.subject ?? state.select.subject;
  const cand = inventory(db, state, band, subject);
  if (cand.length === 0) return [];

  const blank = cand.filter(q => !state.cells[cellKey(q)]);
  const fresh = cand.filter(q => state.cells[cellKey(q)] && !state.seen[q.id]);
  const rest  = cand.filter(q => state.cells[cellKey(q)] && state.seen[q.id]);
  const ranked = [...shuffle(blank), ...shuffle(fresh), ...shuffle(rest)];

  const size = Math.min(RUN_LENGTH, cand.length);
  const chosen = [];
  const used = new Set();

  // 末尾に置く「越境問題」を先に確保する
  const distance = q => q.chapter * 100 + (GRADE_ORDER[q.grade] || 0);
  const crossing = ranked.filter(q => q.chapter >= 2);
  const tail = crossing.length
    ? crossing[0]
    : ranked.slice().sort((a, b) => distance(b) - distance(a))[0];

  for (const q of ranked) {
    if (chosen.length >= size - 1) break;
    if (q.id === tail.id) continue;
    if (used.has(q.id)) continue;
    used.add(q.id);
    chosen.push(q);
  }
  if (!used.has(tail.id) && chosen.length < size) chosen.push(tail);

  return chosen.map(q => q.id);
}

/* ---- チャレンジバトル ---- */

export function gaugeBreakdown(db, state, hero) {
  const rows = [];
  let damage = 0;
  if (!hero.rel) return { damage: 0, hp: hero.hp || 60, rows };

  const stripApplied = c => c.replace("（応用）", "");
  const owned = Object.keys(state.cards);

  const direct = owned.filter(c => hero.rel.cards.includes(stripApplied(c)));
  if (direct.length) {
    const v = direct.length * 8;
    damage += v;
    rows.push({ label: `直結する知識カード ${direct.length}枚`, value: v, detail: direct.join(" / ") });
  }

  const related = owned.filter(c =>
    !hero.rel.cards.includes(stripApplied(c)) &&
    db.cardSubject[c] && hero.rel.subjects.includes(db.cardSubject[c]));
  if (related.length) {
    const v = related.length * 4;
    damage += v;
    rows.push({ label: `関連分野の知識カード ${related.length}枚`, value: v, detail: hero.rel.subjects.join("・") });
  }

  Object.entries(state.equip).forEach(([heroId, extKey]) => {
    if (!extKey || !state.owned[heroId]) return;
    const ext = db.extensions[extKey];
    const owner = db.heroes.find(h => h.id === heroId);
    if (!ext || !owner) return;
    if (!ext.subs.some(s => hero.rel.subjects.includes(s))) return;
    const aligned = ext.subs.some(s => owner.fit.includes(s));
    const v = aligned ? 20 : 10;
    damage += v;
    rows.push({
      label: `${ext.name}（${owner.name}）`, value: v,
      detail: aligned ? "得意分野と噛み合っている" : "装備効果",
    });
  });

  const hp = hero.hp || 60;
  return { damage: Math.min(hp, damage), hp, raw: damage, rows };
}

/* 削れた割合から出題段階を決める。0 = 最も深い、3 = 義務教育レベル */
export function challengeStage(damage, hp) {
  const r = damage / (hp || 100);
  return r >= 1 ? 3 : r >= 0.67 ? 2 : r >= 0.34 ? 1 : 0;
}

/* ---- クラフト ---- */

/* いま素材が足りているエクステンションのキー。
   ホームの通知ドットとクラフト画面が同じ判定を見るために、ここに置く */
export function craftableKeys(db, state) {
  return Object.entries(db.extensions)
    .filter(([, e]) => Object.entries(e.cost).every(([g, v]) => (state.gems[g] || 0) >= v))
    .map(([k]) => k);
}

/* ---- ホーム ---- */

/* まだ解放していない英雄。ホームのカルーセルと挑戦先の選択で使う */
export function lockedHeroes(db, state) {
  return db.heroes.filter(h => !state.owned[h.id]);
}

/* カルーセルの次の位置。端は反対側へ回り込む */
export function nextIndex(i, n, dir = 1) {
  return n > 0 ? (((i + dir) % n) + n) % n : 0;
}

/* 次に解放できる英雄（ロスターの並び順で、まだ持っていない先頭） */
export function nextHero(db, state) {
  return lockedHeroes(db, state)[0] || null;
}

/* まだ1問も解いていない教科。知識マップの白い行にあたる */
function blankSubjects(db, state) {
  const open = unlockedChapters(db, state);
  return SUBJECTS.filter(s =>
    db.questions.some(q => q.subject === s && open.has(q.chapter)) &&
    !GRADES.some(g => state.cells[s + "|" + g.k]));
}

/**
 * ホーム上段でマイちゃんが話す一言を選ぶ。
 * data/advice.json の rules を上から見て、最初に条件が当たったものを返す。
 * 当たらなければ fallback を runs で順番に回す（ランダムにはしない）。
 */
export function adviceFor(db, state) {
  const advice = db.advice;
  if (!advice) return "";

  const next = nextHero(db, state);
  const gauge = next && next.rel ? gaugeBreakdown(db, state, next) : null;
  const percent = gauge ? Math.round(gauge.damage / gauge.hp * 100) : 0;
  const craftable = craftableKeys(db, state);
  const blanks = blankSubjects(db, state);
  const extCount = Object.values(state.exts).reduce((a, b) => a + b, 0);
  const equipped = Object.values(state.equip).filter(Boolean).length;
  const emptyGem = Object.keys(db.gems).find(g => !state.gems[g]);
  const gemSubject = emptyGem
    ? Object.entries(db.subjectToGem).find(([, g]) => g === emptyGem)?.[0] : null;

  const test = {
    firstVisit:     () => state.runs === 0,
    challengeReady: () => !!gauge && percent >= 100,
    nearUnlock:     () => !!gauge && percent >= 34 && percent < 100,
    craftable:      () => craftable.length > 0,
    blankSubject:   () => blanks.length > 0,
    unequipped:     () => extCount > 0 && equipped === 0,
    gemShortage:    () => state.runs > 0 && !!gemSubject,
  };

  const fill = t => t
    .replace("{hero}", next ? next.name : "")
    .replace("{percent}", String(percent))
    .replace("{count}", String(craftable.length))
    .replace("{subject}", blanks[0] || gemSubject || "");

  for (const rule of advice.rules || []) {
    if (test[rule.when]?.()) return fill(rule.text);
  }
  const fb = advice.fallback || [];
  return fb.length ? fill(fb[state.runs % fb.length]) : "";
}
