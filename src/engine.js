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
 * 正解1問で入る GUM。易しいほど少なく、難しいほど多い（1〜10）。
 * 学年の梯子がちょうど10段あるので、そのまま段数を渡している。
 * 小1が1、小6が6、中3が9、世界の問題が10。
 *
 * ヒントを使っても減らさない。ヒントは罰の対象ではないため。
 * 応用編にも上乗せしない。上限が1問10GUMなので、難易度は学年だけで決める。
 */
export function gumFor(q) {
  return Math.max(1, Math.min(10, GRADE_ORDER[q.grade] || 1));
}

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

/* ---- レンジ回答（年代当て） ---- */

/**
 * 許容できる幅（全幅・年）。時代が古いほど広い。
 *
 * 人類が持つ年代の記録解像度は、古いほど粗い。だから幅は「現在からの隔たり」に
 * 比例させる。手で値を決める必要がない。
 *
 *   age = 現在年 − 正解年
 *   W   = clamp(round(age / 10) + 10, 10, 500)
 *
 * precision は問題ごとの微調整。語呂で覚えられる年（1600、1492）は 0.5 にして
 * 厳しくし、諸説ある年代は 2.0 に緩める。既定は 1.0。
 */
export function rangeWidth(year, precision = 1, now = new Date().getFullYear()) {
  const base = Math.round((now - year) / 10) + 10;
  return Math.max(10, Math.min(500, Math.round(base * (precision || 1))));
}

/**
 * レンジ回答の採点（0〜1000）。
 *
 * 正解年が範囲の外なら0点。範囲を広く取れば当たるが、点は伸びない。
 * 狭く取るには知識が要る。**どのくらい自信があるかを賭ける形式**なので、
 * 知識の解像度がそのまま点になる。
 */
export function scoreRange(a, b, year, width) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (!(year >= lo && year <= hi)) return 0;
  if (lo === hi) return 1000;
  return Math.max(50, Math.round(1000 * (1 - (hi - lo) / width)));
}

/* 高い精度で当てたときだけ、魔石がもう1つ落ちる。運の要素は無い */
export const RANGE_BONUS_SCORE = 800;

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

  // ここまでが知識カードぶん。装備はこれを超えられない（原則1）
  const fromCards = damage;

  let fromGear = 0;
  const gearRows = [];
  Object.entries(state.equip).forEach(([heroId, extKey]) => {
    if (!extKey || !state.owned[heroId]) return;
    const ext = db.extensions[extKey];
    const owner = db.heroes.find(h => h.id === heroId);
    if (!ext || !owner) return;
    if (!ext.subs.some(s => hero.rel.subjects.includes(s))) return;
    const aligned = ext.subs.some(s => owner.fit.includes(s));
    const v = (ext.gauge || 10) * (aligned ? 2 : 1);
    fromGear += v;
    gearRows.push({
      label: `${ext.name}（${owner.name}）`, value: v,
      detail: aligned ? "得意分野と噛み合っている" : "装備効果",
    });
  });

  /**
   * **装備の合計は、知識カードの合計を超えない。**
   *
   * 装備は「どの知識が関連としてカウントされるか」を広げる触媒であって、
   * それ自体が強さの源ではない（原則1）。上限を置かないと、装備を増やすほど
   * ゲージが削れる状態になり、成長実感が知識から素材へ移ってしまう。
   * 知識が0なら装備も0。持っている知識を、装備は最大で倍にするところまで。
   */
  const gearCap = Math.min(fromGear, fromCards);
  rows.push(...gearRows);
  if (fromGear > gearCap) {
    rows.push({
      label: "装備は知識を超えない",
      value: -(fromGear - gearCap),
      detail: `装備の合計は知識カードの合計（${fromCards}）までです`,
    });
  }
  damage += gearCap;

  const hp = hero.hp || 60;
  return { damage: Math.min(hp, damage), hp, raw: damage, rows };
}

/* 削れた割合から出題段階を決める。0 = 最も深い、3 = 義務教育レベル */
export function challengeStage(damage, hp) {
  const r = damage / (hp || 100);
  return r >= 1 ? 3 : r >= 0.67 ? 2 : r >= 0.34 ? 1 : 0;
}

/* ---- クラフト ---- */

/**
 * レシピが要求するぶんのクリスタルを、**安いものから**選ぶ。
 *
 * クリスタルは個数ではなく合計いくらぶんで数える（族の縛りを外した以上、
 * 個数で数えると安い鉱物を並べるだけで済んでしまうため）。安い順に取るのは、
 * 使いすぎを最小にするため。それでも1個で足りてしまう高価な鉱物しか
 * 持っていない場合は、その1個を丸ごと使うことになる。
 *
 * 返り値の picks は { "001": 個数 }、value は実際に使う合計。
 */
export function pickCrystals(owned, byId, need) {
  const picks = {};
  let value = 0;
  if (need <= 0) return { picks, value, enough: true };

  const stock = Object.entries(owned || {})
    .filter(([id, n]) => n > 0 && byId?.[id])
    .map(([id, n]) => ({ id, n, price: crystalPrice(byId[id].scarcity) }))
    .sort((a, b) => a.price - b.price);

  for (const c of stock) {
    while (c.n > 0 && value < need) {
      picks[c.id] = (picks[c.id] || 0) + 1;
      value += c.price;
      c.n--;
    }
    if (value >= need) break;
  }
  return { picks, value, enough: value >= need };
}

/**
 * クラフトの可否と、その内訳。画面もホームの通知ドットもこれを見る。
 * 足りないものが分かるように、満たしているかどうかを項目ごとに返す。
 */
export function craftCheck(db, state, id) {
  const e = db.extensions?.[id];
  if (!e) return { ok: false, gems: [], crystals: null, below: null, cards: null };

  const gems = Object.entries(e.cost || {}).map(([g, need]) => ({
    gem: g, need, have: state.gems[g] || 0, ok: (state.gems[g] || 0) >= need,
  }));

  const crystals = e.crystal
    ? { need: e.crystal, ...pickCrystals(state.crystals, db.crystalById, e.crystal) }
    : null;

  const below = e.below
    ? { id: e.below, name: db.extensions[e.below]?.name || e.below,
        have: state.exts[e.below] || 0, ok: (state.exts[e.below] || 0) >= 1 }
    : null;

  // Legendary だけ知識カードの所持を条件に入れる。
  // 最上位が素材だけで手に入ると「素材の量＝強さ」に戻ってしまうため
  const cards = e.cards
    ? { need: e.cards, have: Object.keys(state.cards || {}).length,
        ok: Object.keys(state.cards || {}).length >= e.cards }
    : null;

  const ok = gems.every(g => g.ok) && (!crystals || crystals.enough)
          && (!below || below.ok) && (!cards || cards.ok);
  return { ok, gems, crystals, below, cards };
}

/* いま作れるエクステンションのキー。
   ホームの通知ドットとクラフト画面が同じ判定を見るために、ここに置く */
export function craftableKeys(db, state) {
  return Object.keys(db.extensions || {}).filter(id => craftCheck(db, state, id).ok);
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

/* ---- カレンダー（記録装置。連続日数のボーナスもペナルティも持たない） ---- */

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* 月のマス目。month は 1-12。前後の月にはみ出すマスも埋めて週で返す */
export function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - first.getDay());
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      row.push({ key: dayKey(cur), day: cur.getDate(), inMonth: cur.getMonth() === month - 1 });
    }
    // 月をまたぎきった週は落とす（6行目が丸ごと来月になる月がある）
    if (row.some(c => c.inMonth)) weeks.push(row);
  }
  return weeks;
}

/* その日の記録に1セッションぶんを足す。上書きではなく積む */
export function mergeDay(prev, run) {
  const base = prev || { runs: 0, right: 0, wrong: 0, appliedRight: 0, gum: 0, results: {} };
  return {
    runs: base.runs + 1,
    right: base.right + run.right,
    wrong: base.wrong + run.wrong,
    appliedRight: base.appliedRight + run.appliedRight,
    gum: (base.gum || 0) + (run.gum || 0),
    results: { ...base.results, ...run.results },
  };
}

/* 月を送る。{ year, month } を返す */
export function shiftMonth(year, month, dir) {
  const d = new Date(year, month - 1 + dir, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/* ---- 称号 ---- */

/* 問題の country は「イギリス / Key Stage 3（11–14歳）」の形。国名だけ取り出す */
export const countryOf = q => (q.country || "").split(" / ")[0].trim();

/**
 * 称号の進み具合。data/titles.json の並び順で返す。
 * 「量」より「越境」を目立たせたいので、並べ替えはせずファイルの順を守る。
 * 返すのは { ...title, have, goal, done }。
 */
export function titleProgress(db, state) {
  const list = db.titles?.titles || [];
  const subjectsDone = SUBJECTS.filter(s =>
    GRADES.some(g => ["ok", "st"].includes(state.cells[s + "|" + g.k]))).length;

  return list.map(t => {
    let have = 0, goal = t.n || 1;
    if (t.when === "countries")      have = Object.keys(state.countries || {}).length;
    else if (t.when === "subjects")  have = subjectsDone;
    else if (t.when === "crossRight") have = state.crossRight || 0;
    else if (t.when === "totalRight") have = state.totalRight || 0;
    else if (t.when === "crystalKinds") have = crystalKinds(state);
    else if (t.when === "heroCards") {
      const cards = db.heroById?.[t.hero]?.rel?.cards || [];
      goal = cards.length;
      have = cards.filter(c => state.cards[c]).length;
    }
    return { ...t, have: Math.min(have, goal), goal, done: goal > 0 && have >= goal };
  });
}

export const earnedTitles = (db, state) => titleProgress(db, state).filter(t => t.done);

/* ---- クリスタル ---- */

/**
 * ショップの価格。図鑑の希少度から自動で決まるので、手で値付けしない。
 * 希少なものほど高い。下限5GUM（安すぎて意味を失わないように）。
 * 例: 銅 6.250% → 8GUM、黒鉛 3.950% → 13GUM、ダイヤモンド 0.034% → 1471GUM
 */
export function crystalPrice(scarcity) {
  const s = Number(scarcity);
  if (!Number.isFinite(s) || s <= 0) return 5;
  return Math.max(5, Math.round(50 / s));
}

/**
 * クリスタル1個ぶんの目安（GUM）。
 *
 * 価格は 50 / 希少度 なので、**希少度 × 価格 は常に 50** になる。
 * つまり「その鉱物に出会う割合」と「その鉱物の値段」の積がどれも同じで、
 * どれを選んでも GUM あたりの重みが変わらない。整数に丸めるぶんだけ
 * 50 から数%ずれるが、それ以上の有利不利は生まれない。
 */
export const CRYSTAL_UNIT = 50;

/**
 * クリスタルがクラフトに寄せる重み。**払った GUM そのもの。**
 *
 * こうしておくと、同じ GUM を使うかぎり、どの鉱物を買っても
 * クラフトの進み方が変わらない。安い鉱物を回し続けるのが得、
 * という抜け道が生まれない。
 *
 * **族を教科に結び付けるのはやめた。** 貴金属は希少度が低く価格が高いので、
 * 族と教科を結ぶと、教科ごとに手に入る価値が大きく偏る。鉱物ごとの違いは
 * 豆知識（`fact`）が担い、仕組みの上では差を付けない。
 * `family` は図鑑の見出しとして残してあるだけで、効果には使わない。
 */
export const crystalValue = scarcity => crystalPrice(scarcity);

/**
 * ショップの品揃え。**固定で、安い順。**
 * 日替わりでランダムに並べ替えると「良い品が出るまで待つ」待機が生まれるので入れない。
 */
export function shopList(db) {
  return [...(db.crystals?.crystals || [])]
    .map(c => ({ ...c, price: crystalPrice(c.scarcity) }))
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
}

/* 買えるか。GUM が足りているかだけを見る */
export const canBuy = (state, price) => (state.gum || 0) >= price;

/* 集めたクリスタルの種類数（称号の判定に使う） */
export const crystalKinds = state =>
  Object.values(state.crystals || {}).filter(n => n > 0).length;

/* 持っているクリスタルの合計の重み。owned は { "001": 個数, ... } */
export function crystalsValue(owned, byId) {
  return Object.entries(owned || {}).reduce((sum, [id, n]) => {
    const c = byId?.[id];
    return c ? sum + crystalValue(c.scarcity) * (n || 0) : sum;
  }, 0);
}
