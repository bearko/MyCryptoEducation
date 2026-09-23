/**
 * 属性 ＝ MCH の5勢力。**DOMに触れない純粋関数だけを置きます。**
 *
 * 黒ウィズの火水雷光闇を、MCHが元から持っている5勢力に置き換えたものです。
 * **こちらで属性を作っていません** —— ヒーロー404体すべてが、玄武・朱雀・
 * 黄竜・青龍・白虎のどれかに属しています。
 *
 * 相性は**五行相剋**の輪です。
 *
 * ```
 * 青龍(木) ─▶ 黄竜(土) ─▶ 玄武(水) ─▶ 朱雀(火) ─▶ 白虎(金) ─▶ 青龍(木)
 *           木剋土        土剋水        水剋火        火剋金        金剋木
 * ```
 *
 * **光・闇のような「2つだけで閉じた相互有利」は作っていません。**
 * 5つが1つの輪になっているほうが、どの勢力を選んでも同じだけ有利・不利があり、
 * 扱いが揃います。
 */

export const FACTIONS = ["朱雀", "玄武", "青龍", "白虎", "黄竜"];

/** その勢力が剋す相手。五行相剋そのもの */
export const BEATS = {
  青龍: "黄竜", 黄竜: "玄武", 玄武: "朱雀", 朱雀: "白虎", 白虎: "青龍",
};

export const GOOD = 1.5;
export const EVEN = 1.0;
export const BAD = 0.5;

/** 攻める側 a から、受ける側 b への倍率。黒ウィズの 1.5 / 1.0 / 0.5 */
export const affinity = (a, b) =>
  BEATS[a] === b ? GOOD : BEATS[b] === a ? BAD : EVEN;

/** 画面に出す記号。数字（1.5倍）は出さない——記号のほうが一目で読めます */
export const affinityMark = (a, b) => {
  const r = affinity(a, b);
  return r > 1 ? "▲" : r < 1 ? "▼" : "●";
};

/** 相剋の輪が閉じているか。validate が呼びます */
export function ringOk(beats = BEATS, order = FACTIONS) {
  let cur = order[0];
  const seen = new Set();
  for (let i = 0; i < order.length; i++) {
    if (seen.has(cur) || !beats[cur]) return false;
    seen.add(cur);
    cur = beats[cur];
  }
  return cur === order[0] && seen.size === order.length;
}
