/**
 * 黒ウィズ型バトルの計算。**DOMに触れない純粋関数だけを置きます。**
 *
 * 出題や難易度の計算を `engine.js` だけで追えることと同じ理由です——
 * ここだけ読めばバトルの釣り合いが分かる、という状態を保ってください。
 *
 * 仕様は `docs/wiz-redesign-spec.md`。**数字を動かすときは、そちらも直してください。**
 */

import { MODE_WORK } from "./engine.js";
import { affinity } from "./faction.js";

/* 問題IDから決まる値を作るための種。engine.js と同じ式 */
const bhash = s => { let h = 5381; for (const c of String(s)) h = (h * 33 + c.charCodeAt(0)) | 0; return Math.abs(h); };

/* ---------- 持ち時間 ---------- */

/**
 * **持ち時間は形式ごとに変えます。**
 *
 * 黒ウィズは全形式20秒ですが、この game には文字パネル（なぞる）や
 * 消去法（3回押す）のように、手数そのものが多い形式があります。
 * 一律にすると、重い形式だけが理不尽になります。
 *
 * 手数（`engine.MODE_WORK`）から導くので、**形式を足したときに
 * 秒数を書き足す必要がありません。**
 */
export const SECONDS_PER_WORK = 8;
export const timeLimit = mode => Math.round((MODE_WORK[mode] ?? 1.4) * SECONDS_PER_WORK);

/* ---------- 回答判定 ---------- */

/**
 * **速く答えるほど、多くのASが発動します。**
 *
 * 黒ウィズは20秒のうち5秒がEXCELLENTの境目です（＝持ち時間の1/4）。
 * **秒ではなく比のほうを写しています。** 形式ごとに持ち時間が違うので、
 * 秒で書くとスワイプ（8秒）と文字パネル（22秒）で意味が変わります。
 *
 * **正解すれば最低2体は発動します**（黒ウィズと同じ）。
 */
export const JUDGES = ["EXCELLENT", "GREAT", "GOOD", "NICE"];
export const AS_BY_JUDGE = { EXCELLENT: 5, GREAT: 4, GOOD: 3, NICE: 2 };
export const JUDGE_AT = { EXCELLENT: 0.25, GREAT: 0.5, GOOD: 0.75, NICE: 1 };

export function judge(ms, limitSec) {
  const r = ms / Math.max(1, limitSec * 1000);
  return r <= JUDGE_AT.EXCELLENT ? "EXCELLENT"
       : r <= JUDGE_AT.GREAT ? "GREAT"
       : r <= JUDGE_AT.GOOD ? "GOOD" : "NICE";
}

/** その判定で、デッキの左から何体ぶんのASが乗るか */
export const asCount = j => AS_BY_JUDGE[j] ?? 2;

/* ---------- チェイン ---------- */

/**
 * **誤答で0に戻しません。半減です。**
 *
 * 黒ウィズも2017年に「0に戻る」をやめています。外した1問がそれまでの
 * 積み上げを全部消すのは、原則3（失敗は罰されない）と正面からぶつかります。
 */
export const CHAIN_MAX_SHOWN = 999;
export const chainNext = (chain, ok) => ok ? (chain | 0) + 1 : Math.floor((chain | 0) / 2);
/** ダメージ補正 `(100 + チェイン)%`。ASにもSSにも乗ります */
export const chainBonus = chain => (100 + (chain | 0)) / 100;

/* ---------- デッキ ---------- */

export const DECK_SIZE = 5;

/**
 * コストは**強さではなく枠の重さ**です。レアリティから導きます。
 * **レアリティが決めるのはここだけで、攻撃力には効きません**（原則1）。
 */
export const COST = { Common: 4, Uncommon: 6, Rare: 9, Epic: 13, Legendary: 18, MCH: 4 };
export const costOf = hero => COST[hero?.rarity] ?? 6;
export const deckCost = heroes => heroes.filter(Boolean).reduce((a, h) => a + costOf(h), 0);

/**
 * **デッキコストの上限は、知識マップの埋まり具合で決まります。**
 *
 * プレイヤーレベルという数値を新しく作らないでください。進行の数値を
 * 2つ持つと必ず食い違います。**知識マップが埋まることが、そのまま
 * 編成の自由になります。**
 */
export const DECK_CAP_BASE = 20;
export const deckCap = filledCells => DECK_CAP_BASE + Math.max(0, filledCells | 0);

/**
 * **超過しても挑めます。そのかわり全員が25%ダウンします**（黒ウィズと同じ）。
 * 禁止ではなく代償です——降りるかどうかは常にプレイヤーの手にあります（決定2）。
 */
export const OVER_PENALTY = 0.75;
export const overCost = (cost, cap) => cost > cap;
export const costFactor = (cost, cap) => overCost(cost, cap) ? OVER_PENALTY : 1;

/* ---------- 知識が強さになるところ ---------- */

/**
 * **ヒーローの攻撃力は、そのヒーローに縁のある教科の網羅率で決まります。**
 *
 * ここが原則1（強さの源は知識であって素材ではない）の入口です。
 * レベルも進化も限界突破も入れていないので、**攻撃力を動かす手段は
 * 「解くこと」しかありません。**
 *
 * **装備倍率は掛けません。** 掛けると「装備の量＝攻撃力」になり、原則1が
 * 裏返ります。エクステンションが効くのはSSの中身だけです（＝触媒のまま）。
 *
 * 知識ゼロでも `KNOW_MIN` は出します。0にすると始めたばかりの人が1体も
 * 倒せません（原則3）。**勝手に決めた幅です**（`docs/review-points.md` §34）。
 */
export const KNOW_MIN = 0.5;
export const KNOW_SPAN = 1.5;
export const knowledgeMul = coverage => KNOW_MIN + Math.min(1, Math.max(0, coverage)) * KNOW_SPAN;

/**
 * そのヒーローの縁のある教科を、どれだけ埋めているか（0〜1）。
 * 複数の教科にまたがるヒーローは、その平均を見ます。
 */
export function coverageOf(hero, haveBySubject, totalBySubject) {
  const subs = (hero?.fit || []).filter(s => (totalBySubject?.[s] || 0) > 0);
  if (!subs.length) return 0;
  const sum = subs.reduce((a, s) =>
    a + Math.min(1, (haveBySubject?.[s] || 0) / totalBySubject[s]), 0);
  return sum / subs.length;
}

/* ---------- ダメージ ---------- */

/**
 * ヒーロー1体の一撃。
 *
 * ```
 * 一撃 = 基礎攻撃（MCHの (phy + int) / 2）× 知識倍率 × 超過補正
 * ```
 */
export const heroPower = (stats, coverage, factor = 1) =>
  Math.max(1, Math.round(
    ((stats?.phy || 0) + (stats?.int || 0)) / 2 * knowledgeMul(coverage) * factor));

/**
 * AS 1本ぶんのダメージ。
 *
 * ```
 * 一撃 × ASの効果率 × 属性相性 × チェイン補正
 * ```
 *
 * **効果率に幅があるものは中央値に固定します。** 乱数にすると同じ問題で
 * 結果が変わり、原則2（ランダム報酬を入れない）に触れます。
 */
export const asDamage = (power, rate, atkFaction, defFaction, chain) =>
  Math.max(1, Math.round(power * rate * affinity(atkFaction, defFaction) * chainBonus(chain)));

/** MCH の min_rate 〜 max_rate から、固定で使う効果率を取る */
export const effectRate = eff => {
  const lo = Number(eff?.min_rate), hi = Number(eff?.max_rate);
  if (!Number.isFinite(lo)) return 0.4;
  return ((lo + (Number.isFinite(hi) ? hi : lo)) / 2) / 100;
};

/* ---------- AS の発動条件 ---------- */

/**
 * **サイコロを振りません。**
 *
 * MCHのPassiveは `{triggerRate}%の確率で` という条件を持ちます。運で出る
 * ようにすると「出るまで引き直す」遊び方ができ、原則2と正面からぶつかります。
 * **問題IDとヒーローIDから決まるので、同じ問題ならいつでも同じ答えです。**
 * 割合としては triggerRate どおりですが、1問ごとに見れば決まっています。
 */
export const rollFixed = (key, rate) => bhash(key) % 1000 < Math.max(0, Math.min(100, rate)) * 10;

/**
 * MCH の condition を、このバトルの言葉に読み替えて判定する。
 *
 * **MCH の「Active Skill」は必殺技ではなく、毎ターンの行動そのものです。**
 * 装備したエクステンションの技を毎回撃つのが MCH のバトルなので、
 * 「自身がActive Skillを使用した後に」は**その枠が行動したとき**を指します。
 * ここを「SSを撃った次」と読むと、40体のうち23体のASが一生出ません
 * （実際に一度そう書きました）。**正解のたびに行動している**と読みます。
 *
 * | MCHの condition | 読み替え |
 * |---|---|
 * | バトル開始時に | その wave の1問目に正解したとき |
 * | 自身がActive Skillを使用した後に | その枠が行動したとき（＝正解のたび） |
 * | 自身がActive Skillでダメージを受けた後に | 反撃を受けた次の正解 |
 * | 自身が死亡した後に | ヒーローが倒れているとき |
 * | HPが◯%未満の時に／味方全体のHP合計が◯%未満の時に | パーティのHPがそこを切っているとき |
 * | 1回だけ発動 | 1セッションに1回 |
 *
 * **読み替えられない条件は通します。** 出ないほうへ倒すと、そのヒーローが
 * ただ弱いだけになります。確率（triggerRate）のほうで十分に絞れています。
 */
export function conditionMet(text, ctx = {}) {
  const t = String(text || "");
  if (!t) return true;
  if (/バトル開始時/.test(t) && !ctx.waveFirst) return false;
  if (/ダメージを受けた後/.test(t) && !ctx.wasHit) return false;
  if (/死亡した後/.test(t) && !ctx.down) return false;
  const hp = t.match(/HP(?:合計)?が(\d+)%未満/);
  if (hp && !((ctx.hpRate ?? 1) < Number(hp[1]) / 100)) return false;
  return true;
}

export const onceOnly = text => /1回だけ発動/.test(String(text || ""));

/**
 * この問題で、そのヒーローのASが実際に出るか。
 * **順番（左から何体目か）は呼ぶ側が決めます** —— ここは条件だけ見ます。
 */
export function asFires(passive, qid, heroId, ctx = {}) {
  const d = passive?.description?.ja || passive?.ja || passive || {};
  if (!conditionMet(d.condition, ctx)) return false;
  if (onceOnly(d.condition) && ctx.usedOnce) return false;
  const rate = Number(d.trigger_rate);
  return rollFixed(`${qid}|${heroId}|as`, Number.isFinite(rate) && rate > 0 ? rate : 100);
}

/* ---------- SS ---------- */

/**
 * SSゲージ。**規定の正解数が溜まると自分で撃てます。**
 * 黒ウィズの「未覚醒でも最低3回」に合わせてあります。
 * ランクは既存の独自ランク（由来がいくつの教科にまたがるか）そのままで、
 * **MCHのレアリティは使いません。**
 */
export const SS_NEED = { 初伝: 3, 中伝: 4, 奥伝: 6 };
export const ssNeed = ext => SS_NEED[ext?.rank] ?? 3;
export const ssReady = (gauge, ext) => (gauge | 0) >= ssNeed(ext);
/** SSの倍率。ふつうの一撃に対して */
export const SS_POWER = 3;

/* ---------- 敵 ---------- */

/**
 * 敵に属性を割り当てる。**MCHの敵データは属性を持っていません**ので、
 * こちらで決めています（`docs/review-points.md` §34）。
 * IDから決まるので、同じ敵はいつでも同じ属性です。
 */
export const FACTION_ORDER = ["朱雀", "玄武", "青龍", "白虎", "黄竜"];
export const foeFaction = id => FACTION_ORDER[bhash("foe|" + id) % FACTION_ORDER.length];

/** ボスの体力の上乗せ。最後の wave の敵だけ */
export const BOSS_HP = 1.3;
