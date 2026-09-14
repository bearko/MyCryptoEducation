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

/**
 * その問題がいま出題されうるか。
 *
 * `needs` を持つ問題は、**そのカードを手に入れるまで出てきません。**
 * 報酬のゴールを「所持数」ではなく「次の問い」にするための仕掛けです
 * （`docs/reward-economy.md` §7）。外的報酬は露出が続くと動機を下げますが、
 * 増やすのが種類ではなく**問い**なら、そこは頭打ちになりません。
 */
export const questionOpen = (state, q) => !q.needs || !!(state.cards || {})[q.needs];

/* ある問題を開くと出てくる問題たち。解放されたことを知らせるのに使う */
export const unlockedBy = (db, card) =>
  (db.questions || []).filter(q => q.needs === card);

/**
 * **スワイプ問題は、ふつうのセッションには混ざりません。**
 *
 * スワイプは「10問ぜんぶ同じ形式で、解説を挟まずに矢継ぎ早に」出すためのモードです。
 * 途中に1問だけ混ざると、テンポの設計そのものが成り立ちません
 * （`spreadModes` が方式をばらけさせるのと、狙いが正反対になります）。
 * だから在庫の段階で分けます。
 */
export const isSwipe = q => (q.format || "choice") === "swipe";

/* 指定した範囲で出題しうる問題（在庫）。kind で通常とスワイプの在庫を分ける */
export function inventory(db, state, band = "auto", subject = "auto", kind = "normal") {
  const open = unlockedChapters(db, state);
  const wantSwipe = kind === "swipe";
  return db.questions.filter(q => {
    if (isSwipe(q) !== wantSwipe) return false;
    if (!open.has(q.chapter)) return false;
    if (!questionOpen(state, q)) return false;
    if (band !== "auto") {
      const g = GRADES.find(x => x.k === q.grade);
      if (!g || g.band !== band) return false;
    }
    if (subject !== "auto" && q.subject !== subject) return false;
    return true;
  });
}

/* 教科ごとの在庫内訳（出題選択画面の表示用） */
export function inventoryBySubject(db, state, band = "auto", kind = "normal") {
  const out = {};
  SUBJECTS.forEach(s => { out[s] = inventory(db, state, band, s, kind).length; });
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
  const kind = opts.kind ?? "normal";
  const cand = inventory(db, state, band, subject, kind);
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

  // スワイプは全問が同じ方式なので、ばらけさせる相手がいない
  return (kind === "swipe" ? chosen : spreadModes(chosen)).map(q => q.id);
}

/**
 * **同じ回答方式が続かないように、並びだけを入れ替える。**
 *
 * 出題の優先順（白いマス → 未出題 → 既出）と、末尾の越境問題はそのままにして、
 * 3問続いたときだけ後ろから違う方式を持ってくる。測ったところ、手を入れる前は
 * **40セッション中27回で3問以上続き、最長6問連続**だった。同じ形の操作が
 * 4回続くと、解いているというより作業になる。
 *
 * 入れ替えるのは順番だけで、出る問題そのものは変えない。
 */
export function spreadModes(list, limit = 2) {
  if (list.length < limit + 1) return list.slice();
  const tail = list[list.length - 1];   // 末尾の越境問題は動かさない
  const groups = new Map();
  list.slice(0, -1).forEach(q => {
    if (!groups.has(q.mode)) groups.set(q.mode, []);
    groups.get(q.mode).push(q);         // 束の中では、出題の優先順を保つ
  });

  const out = [];
  const left = () => [...groups.values()].reduce((a, g) => a + g.length, 0);
  while (left()) {
    // 直前が limit 問とも同じ方式なら、その方式は今回選ばない
    const run = out.slice(-limit);
    const banned = run.length === limit && run.every(q => q.mode === run[0].mode)
      ? run[0].mode : null;
    // **残りがいちばん多い束から取る。** 多いものを後回しにすると、終わりで固まる
    let pick = null;
    for (const [mode, g] of groups) {
      if (!g.length || mode === banned) continue;
      if (!pick || g.length > groups.get(pick).length) pick = mode;
    }
    if (!pick) pick = [...groups].find(([, g]) => g.length)[0];   // ほかに無ければ諦める
    out.push(groups.get(pick).shift());
  }
  out.push(tail);
  return out;
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

/* 幅を狭く言い切って当てたときだけ、クリスタルの抽選がもう1回 */
export const RANGE_BONUS_SCORE = 800;

/* ---- チャレンジバトル ---- */

/**
 * **難度係数。** レアリティは体力ではなく「関連分野を何割埋めれば届くか」を表す。
 * Legendary は関連分野をまるごと、Common はその4割で届く。
 */
export const DIFFICULTY = { Common: 0.4, Uncommon: 0.55, Rare: 0.7, Epic: 0.85, Legendary: 1 };
export const difficultyFactor = hero => DIFFICULTY[hero?.rarity] ?? 0.7;

/* 基礎の内訳。直結カードのほうを重く見る */
export const W_DIRECT = 0.6;
export const W_RELATED = 0.4;

/**
 * 装備は「基礎を何倍にするか」でしか効かない。
 * Common(gauge 10) で +2.5%、Legendary(gauge 60) で +15%。得意分野と噛み合えば2倍。
 * 合計は ×2 で頭打ち——**装備は持っている知識を最大で倍にするところまで**（原則1）。
 */
export const GEAR_UNIT = 400;
export const GEAR_MAX = 2;

/* 知識カード名の総当たり表。応用は同じカードの別形なので数えない */
function basePool(db) {
  if (db.__basePool) return db.__basePool;
  const bySubject = {};
  const all = [];
  Object.entries(db.cardSubject).forEach(([card, subject]) => {
    if (card.endsWith("（応用）")) return;
    all.push(card);
    (bySubject[subject] = bySubject[subject] || []).push(card);
  });
  return (db.__basePool = { all, bySubject });
}

/* 応用ぶんを剥がして、素の知識カード名の集合にする */
function ownedBase(state) {
  const set = new Set();
  Object.keys(state.cards).forEach(c => set.add(c.replace("（応用）", "")));
  return set;
}

/**
 * 難易度ゲージ＝その英雄への**到達度**。
 *
 * ```
 * 基礎   = 直結カードの網羅率 × 0.6 ＋ 関連分野の網羅率 × 0.4
 * 到達度 = min(1, 基礎 × 装備倍率 ÷ 難度係数)
 * ```
 *
 * **総量ではなく網羅率で測る。** 総量は問題数に比例して青天井に増えるので、
 * DBを育てるほど飽和が早まる——480問の時点で全英雄が100%に張り付いていた。
 * 割合なら4800問でも壊れない。
 *
 * この形なら `gearCap`（装備は知識を超えないという後付けの上限）も要らない。
 * **知識がゼロなら基礎が0で、装備を何個積んでも0のまま。** 原則1が構造として保証される。
 * 詳しくは docs/reward-economy.md。
 */
export function gaugeBreakdown(db, state, hero) {
  const factor = difficultyFactor(hero);
  const empty = {
    reach: 0, percent: 0, base: 0, gear: 1, factor,
    direct: { have: 0, total: 0, rate: 0 }, related: { have: 0, total: 0, rate: 0 }, rows: [],
  };
  if (!hero.rel) return empty;

  const pool = basePool(db);
  const owned = ownedBase(state);
  const rel = new Set(hero.rel.cards);

  const directList = hero.rel.cards.filter(c => owned.has(c));
  const direct = {
    have: directList.length, total: hero.rel.cards.length,
    rate: hero.rel.cards.length ? directList.length / hero.rel.cards.length : 0,
  };

  const relatedPool = hero.rel.subjects
    .flatMap(s => pool.bySubject[s] || []).filter(c => !rel.has(c));
  const relatedHave = relatedPool.filter(c => owned.has(c)).length;
  const related = {
    have: relatedHave, total: relatedPool.length,
    rate: relatedPool.length ? relatedHave / relatedPool.length : 0,
  };

  const base = direct.rate * W_DIRECT + related.rate * W_RELATED;

  /* 装備は倍率として効く。噛み合っていれば2倍 */
  const gearRows = [];
  let weight = 0;
  Object.entries(state.equip).forEach(([heroId, extKey]) => {
    if (!extKey || !state.owned[heroId]) return;
    const ext = db.extensions[extKey];
    const owner = db.heroes.find(h => h.id === heroId);
    if (!ext || !owner) return;
    if (!ext.subs.some(s => hero.rel.subjects.includes(s))) return;
    const aligned = ext.subs.some(s => owner.fit.includes(s));
    const w = (ext.gauge || 10) / GEAR_UNIT * (aligned ? 2 : 1);
    weight += w;
    gearRows.push({ ext, owner, aligned, w });
  });
  /* ×2 が頭打ち。超えたぶんは各装備に比例して薄める */
  const scale = weight > GEAR_MAX - 1 ? (GEAR_MAX - 1) / weight : 1;
  const gear = 1 + weight * scale;

  const uncapped = factor ? base * gear / factor : 0;
  const reach = Math.min(1, uncapped);

  /* 内訳は「到達度を何ポイント押し上げたか」で出す（原則1） */
  const pts = x => Math.round(x / factor * 100);
  const rows = [];
  if (direct.have) rows.push({
    label: `直結する知識カード ${direct.have}/${direct.total}枚`,
    value: pts(direct.rate * W_DIRECT * gear),
    detail: directList.join(" / "),
  });
  if (related.have) rows.push({
    label: `関連分野の知識カード ${related.have}/${related.total}枚`,
    value: pts(related.rate * W_RELATED * gear),
    detail: hero.rel.subjects.join("・"),
  });
  gearRows.forEach(g => rows.push({
    label: `${g.ext.name}（${g.owner.name}）`,
    value: pts(base * g.w * scale),
    detail: g.aligned ? "得意分野と噛み合っている ・ 効果2倍" : "関連分野を広げる",
  }));
  if (uncapped > 1) rows.push({
    label: "ここから先は挑めば分かる",
    value: -Math.round((uncapped - 1) * 100),
    detail: "到達度は100%で止まります",
  });

  return { reach, percent: Math.round(reach * 100), base, gear, factor, direct, related, rows };
}

/* 到達度から出題段階を決める。0 = 最も深い、3 = 義務教育レベル */
export function challengeStage(reach) {
  return reach >= 1 ? 3 : reach >= 0.67 ? 2 : reach >= 0.34 ? 1 : 0;
}

/**
 * 3問中いくつ当てれば解放かをレアリティで決める。
 * 1問1答だと、たまたま知っていた1問で解放されてしまう。
 */
export const CHALLENGE_NEED = { Common: 1, Uncommon: 1, Rare: 2, Epic: 2, Legendary: 3 };
export const challengeNeed = hero => CHALLENGE_NEED[hero?.rarity] ?? 1;

/* 1回の挑戦で出す問題数 */
export const CHALLENGE_QUESTIONS = 3;

/**
 * 段階に応じた問い方を選ぶ。**v は難しい順に並べる。**
 * 段階0（ゲージが削れていない）が最も深く、段階3（削りきった）が最も易しい。
 *
 * 以前はここが `v[3 - stage]` になっていて、知識を積むほど難しい問いが出ていた。
 * 画面に出る段階の見出しとも逆だった。
 */
export const challengePrompt = (q, stage) =>
  q.v[Math.max(0, Math.min(q.v.length - 1, stage))];

/**
 * 挑戦を終えたときに渡す、その人物にまつわる知識カード1枚。
 * まだ持っていないものから配る。**プールはその英雄の関連カードだけなので、
 * 挑み続けても無限には増えない。** 負けるほど次が有利になる、を
 * 「知識を積まずにゲージが埋まる」に変えないための歯止め。
 */
export function challengeCard(hero, state) {
  return (hero?.rel?.cards || []).find(c => !state.cards[c]) || null;
}

/* ---- クラフト ---- */

/** 族を問わないことを表す。汎用のエクステンションだけがこれを使う */
export const ANY_FAMILY = "*";

/**
 * **クリスタルは確率で落ちます。原則2（ランダム報酬を入れない）の唯一の例外です。**
 *
 * 一定量が確定で入る形も検討しましたが、報酬が毎回同じだと周回が作業になります。
 * 「出会えたら幸運」な一撃を混ぜたほうが、地道に集める道を否定せずに変化が出ます。
 * ただし**射幸心の側に倒さないための縛りを3つ置いています。**
 *
 * 1. **どの族を貯めても、規定ポイントに届くまでの時間は変わりません。**
 *    出にくい族は1回の当たりが大きく、出やすい族は小刻みに入ります。
 *    「良い物が出るまで待つ」ほうが得、という構造を作らないためです
 * 2. 外れても失うものはありません。GUM も知識カードも解説も、正解した時点で確定です
 * 3. 確率は図鑑の希少度そのもの。こちらで盛ったり削ったりしていません
 *
 * レア寄りの族だけ、待たされるぶんの対価として期待値を最大10%上乗せします（`RARE_BONUS`）。
 */
export const RARE_BONUS = 0.10;

/**
 * 族の中で1回引いたときの期待ポイント。
 * 族の中では**希少度がそのまま確率**で、価格は 50 ÷ 希少度 なので、
 * 期待値は 50 × 種類数 ÷ 族内の希少度合計 になる。
 */
function familyStats(db) {
  if (db.__famStats) return db.__famStats;
  const st = {};
  (db.crystals?.crystals || []).forEach(c => {
    const f = (st[c.family] ||= { list: [], sum: 0 });
    f.list.push(c);
    f.sum += c.scarcity;
  });
  Object.values(st).forEach(f => {
    f.expect = f.sum ? f.list.reduce((a, c) =>
      a + (c.scarcity / f.sum) * crystalPoints(c.scarcity), 0) : 0;
  });
  // レア寄りほど当たりが重い。上乗せは対数で測る（宝石が外れ値なので線形だと潰れる）
  const es = Object.values(st).map(f => f.expect).filter(e => e > 0);
  const lo = Math.log(Math.min(...es)), hi = Math.log(Math.max(...es));
  Object.values(st).forEach(f => {
    f.bonus = f.expect > 0 && hi > lo
      ? 1 + RARE_BONUS * (Math.log(f.expect) - lo) / (hi - lo) : 1;
  });
  return (db.__famStats = st);
}

/** 族の「1回引いたときの期待ポイント」 */
export const familyExpect = (db, family) => familyStats(db)[family]?.expect || 0;
/** レア寄りの族への上乗せ（1.00〜1.10） */
export const familyBonus = (db, family) => familyStats(db)[family]?.bonus || 1;

/**
 * 1問正解あたりの当たり確率。
 *
 * `当たり確率 × 当たりの期待ポイント` が族によらず `gum × 上乗せ` になるように決める。
 * **これが「どの族でも所要時間が変わらない」の中身です。**
 * 難しい問題ほど gum が大きいので、当たりやすくもなる。
 */
export function dropRate(db, family, gum) {
  const e = familyExpect(db, family);
  if (!e) return 0;
  return Math.min(1, gum * familyBonus(db, family) / e);
}

/**
 * 1問ぶんの抽選。当たれば鉱物のid、外れれば null。
 * **族の中は希少度そのままの重み**なので、安い鉱物ほどよく出る。
 * `rng` を渡せる形にしてあるのは、テストで同じ結果を再現するため。
 */
export function drawCrystal(db, subject, gum, rng = Math.random) {
  const family = db.subjectToFamily?.[subject];
  const f = family && familyStats(db)[family];
  if (!f || !f.list.length) return null;
  if (rng() >= dropRate(db, family, gum)) return null;

  let r = rng() * f.sum;
  for (const c of f.list) { r -= c.scarcity; if (r <= 0) return c.id; }
  return f.list[f.list.length - 1].id;
}

/**
 * 持っている族ポイント。**クラフトが払うのはこれで、鉱物そのものは減りません。**
 *
 * 鉱物は手に入れた時点でポイントに変わり、図鑑には残り続けます。こうしないと、
 * たまに出た高いレア鉱物が安いレシピに丸ごと食われますし、クラフトのたびに
 * 図鑑が欠けて豆知識が読めなくなります（「手に入れると読める」と決めてあるため）。
 */
export const familyPoints = (state, family) =>
  family === ANY_FAMILY
    ? Object.values(state.points || {}).reduce((a, b) => a + b, 0)
    : (state.points || {})[family] || 0;

/* その教科の知識カードを何枚持っているか。応用は同じカードの別形なので数えない */
export function subjectCardCount(db, state, subject) {
  const seen = new Set();
  Object.keys(state.cards || {}).forEach(c => {
    const base = c.replace("（応用）", "");
    if (db.cardSubject?.[base] === subject) seen.add(base);
  });
  return seen.size;
}

/**
 * クラフトの可否と、その内訳。画面もホームの通知ドットもこれを見る。
 * 足りないものが分かるように、満たしているかどうかを項目ごとに返す。
 */
export function craftCheck(db, state, id) {
  const e = db.extensions?.[id];
  if (!e) return { ok: false, crystals: [], cards: [], origin: null };

  /**
   * **クリスタルは族ごとのポイントで要求する。**（「石英120pt」のように）
   * 個別の鉱物を名指ししないので、要求は族の数だけに収まり、
   * どの鉱物で払うかはプレイヤーが決められる。
   */
  const crystals = e.crystals
    ? Object.entries(e.crystals).map(([family, need]) => {
        const have = familyPoints(state, family);
        return { family, need, have, enough: have >= need };
      })
    : [];

  /**
   * **知識カードは、その品の由来がまたがる教科それぞれで要ります。**
   *
   * 素材だけで作れると「素材の量＝強さ」に戻ります。ここを閉じると、
   * クイズ → 素材 → クラフト の回路に知識が通ります。大唐西域記（奥伝）を作るには、
   * 社会・国語・外国語のどれも実際に解いていないと届きません。
   */
  const cards = Object.entries(e.cards || {}).map(([subject, need]) => {
    const have = subjectCardCount(db, state, subject);
    return { subject, need, have, ok: have >= need };
  });

  /**
   * **由来カード。** その品の元になった人物や出来事の問題を解くと手に入ります。
   * 素材と教科の広さだけでは足りず、**その品そのものを知っていること**が要る。
   * 奥伝だけの条件です。クラフト画面から直接その問いに挑めます。
   */
  const origin = e.originCard
    ? { card: e.originCard, ok: !!(state.cards || {})[e.originCard],
        qid: (db.questions || []).find(q => q.card === e.originCard)?.id || null }
    : null;

  const ok = crystals.every(c => c.enough) && cards.every(c => c.ok)
          && (!origin || origin.ok);
  return { ok, crystals, cards, origin };
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
  const percent = gauge ? gauge.percent : 0;
  const craftable = craftableKeys(db, state);
  const blanks = blankSubjects(db, state);
  const extCount = Object.values(state.exts).reduce((a, b) => a + b, 0);
  const equipped = Object.values(state.equip).filter(Boolean).length;
  // まだ1ptも貯まっていない族があれば、その教科を勧める
  const emptyFamily = (db.families || []).find(f => !(state.points || {})[f]);
  const thinSubject = emptyFamily ? db.familyToSubject?.[emptyFamily] : null;

  const test = {
    firstVisit:     () => state.runs === 0,
    challengeReady: () => !!gauge && percent >= 100,
    nearUnlock:     () => !!gauge && percent >= 34 && percent < 100,
    craftable:      () => craftable.length > 0,
    blankSubject:   () => blanks.length > 0,
    unequipped:     () => extCount > 0 && equipped === 0,
    thinFamily:     () => state.runs > 0 && !!thinSubject,
  };

  const fill = t => t
    .replace("{hero}", next ? next.name : "")
    .replace("{percent}", String(percent))
    .replace("{count}", String(craftable.length))
    .replace("{subject}", blanks[0] || thinSubject || "")
    .replace("{family}", emptyFamily || "");

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
 * **クリスタル1個ぶんのポイント。払った GUM そのもの。**
 *
 * クラフトは個別の鉱物ではなく「石英120pt」のように**族ごとのポイント**で要求する。
 * 個別の鉱物を名指しすると、種類が増えるほどレシピが読めなくなり、
 * たまたま持っていない1種で詰まる。族ごとなら、要求は族の数だけに収まる。
 *
 * 希少度 × 価格 は常に 50 なので、ポイントを価格と同じにしておけば、
 * 同じ GUM で得られるポイントはどの鉱物でも変わらない。**族を教科に結び付けても、
 * 族の中でも族の間でも、有利不利は生まれない。** 120ptを水晶で払っても
 * 紫水晶で払っても同じだけ進む。
 *
 * 安い鉱物を回し続けるのが得、という抜け道も生まれない。
 */
export const crystalPoints = scarcity => crystalPrice(scarcity);

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

/* 図鑑に並んだ鉱物の合計ポイント。**払うのは state.points のほうで、これは記録用** */
export function crystalsValue(owned, byId) {
  return Object.entries(owned || {}).reduce((sum, [id, n]) => {
    const c = byId?.[id];
    return c ? sum + crystalPoints(c.scarcity) * (n || 0) : sum;
  }, 0);
}

/* ---------- 文字パネル（難モード） ---------- */

/* 問題ごとに同じ盤面が出るように、IDから種を作る。
   毎回ちがう盤面だと、validate が通した生成結果と本番がずれる */
function seedOf(text) {
  let h = 2166136261;
  for (const c of String(text)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rngFrom = seed => {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
};

const HIRA = [..."あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだでどばびぶべぼぱぴぷぺぽゃゅょっー"];
const KATA = [..."アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポャュョッー"];

/** パネルに乗る読みか。2〜12文字のかな・カナだけ */
export const panelReady = r => typeof r === "string" && /^[ぁ-んァ-ヶー]{2,12}$/.test(r);

/**
 * 文字パネルの盤面を作る。
 *
 * 8方向に隣り合うセルをたどる自己回避経路を引き、その順に読みの文字を置く。
 * 残りはダミーで埋め、**1〜2枚は答えの文字を重ねて偽の分岐を作る**。
 * ここが難易度のつまみになる（experience-design-framework の決定4）。
 *
 * **1文字目のマークは出さない。** 探索コストは許容範囲だが、マークは読みの
 * 1文字目を漏らしてしまう。半分知っている人には答えそのものになる。
 *
 * @returns {{size:number, cells:string[], path:number[]}|null}
 *   100回の試行で経路を引けなければ null（呼ぶ側は消去法へ落とす）
 */
export function panelLayout(reading, key = reading, tries = 100) {
  if (!panelReady(reading)) return null;
  const chars = [...reading];
  const L = chars.length;
  const size = L <= 6 ? 3 : 4;
  if (L > size * size) return null;

  const rnd = rngFrom(seedOf(key));
  const pick = n => Math.floor(rnd() * n);
  const neighbors = i => {
    const r = Math.floor(i / size), c = i % size, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size) out.push(nr * size + nc);
    }
    return out;
  };
  const shuffled = a => {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = pick(i + 1); [r[i], r[j]] = [r[j], r[i]]; }
    return r;
  };

  /* 折り返しの鋭さ。180度に近い折り返しがあると、指でなぞったときに
     はみ出して隣のマスを拾ってしまう。まずは鋭い角を避けて引く */
  const turnOk = (a, b, c) => {
    const v = (p, q) => [Math.floor(q / size) - Math.floor(p / size), (q % size) - (p % size)];
    const [ar, ac] = v(a, b), [br, bc] = v(b, c);
    const dot = ar * br + ac * bc;
    return dot / (Math.hypot(ar, ac) * Math.hypot(br, bc)) > -0.5;   // 135度より鋭い折り返しは断る
  };

  const draw = smooth => {
    for (let t = 0; t < tries; t++) {
      const start = pick(size * size);
      const walk = [start];
      const used = new Set([start]);
      // 深さ優先＋バックトラック。行き止まりに入ったら1つ戻ってやり直す
      const step = () => {
        if (walk.length === L) return true;
        const last = walk[walk.length - 1];
        for (const n of shuffled(neighbors(last))) {
          if (used.has(n)) continue;
          if (smooth && walk.length >= 2 && !turnOk(walk[walk.length - 2], last, n)) continue;
          walk.push(n); used.add(n);
          if (step()) return true;
          walk.pop(); used.delete(n);
        }
        return false;
      };
      if (step()) return walk;
    }
    return null;
  };
  // なめらかに引けなければ、鋭い角も許して引く。問題を落とすよりはよい
  const path = draw(true) || draw(false);
  if (!path) return null;

  const kata = /^[ァ-ヶー]+$/.test(reading);
  const pool = (kata ? KATA : HIRA).filter(c => c !== "ー" || chars.includes("ー"));
  const cells = new Array(size * size).fill("");
  path.forEach((cell, i) => { cells[cell] = chars[i]; });

  // 空きセル。まず答えの文字を1〜2枚まぜて偽の分岐を作る
  const blanks = shuffled(cells.map((c, i) => (c ? -1 : i)).filter(i => i >= 0));
  const fakes = Math.min(blanks.length, 1 + pick(2));
  blanks.forEach((cell, i) => {
    cells[cell] = i < fakes ? chars[pick(L)] : pool[pick(pool.length)];
  });
  return { size, cells, path };
}
