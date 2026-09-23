/**
 * 音。**MyCryptoHeroes の素材をそのまま鳴らします**（台帳は `data/sounds.json`、
 * 取り込みは `node scripts/fetch-mch-assets.mjs --audio`）。
 *
 * **既定はOFFです。自動で鳴らさないでください** —— 電車の中で開く人がいます。
 * 設定（マイページ・出題中の⚙）で入れたときだけ鳴ります。
 *
 * **音は演出だけです。** 鳴らしても鳴らさなくても、GUM・知識カード・クリスタルは
 * 1つも変わりません（原則3-2）。**音を鳴らすと有利、という形にしないでください。**
 *
 * ブラウザは、人が触る前の再生を止めます。設定を押した時点が「触った」に
 * あたるので、そこからは鳴らせます。**止められても黙って諦めます** ——
 * 例外を投げると、鳴らないだけのはずが画面ごと落ちます。
 */

import { assetPath } from "./data.js";

let seOn = false;
let bgmOn = false;
let bgmEl = null;
let bgmKey = null;
const cache = new Map();

export const SE_VOLUME = 0.55;
export const BGM_VOLUME = 0.3;

export const setSound = on => { seOn = !!on; };
export const setBgm = on => { bgmOn = !!on; if (!bgmOn) stopBGM(); };
export const soundOn = () => seOn;
export const bgmPlaying = () => bgmKey;

/** 鳴らせない場所（jsdom・古い環境）でも、黙って何もしないで済ませる */
const makeAudio = src => {
  try { return new globalThis.Audio(src); } catch { return null; }
};

/**
 * 効果音をひとつ鳴らす。**同じ音が重なってもよいように、毎回頭から鳴らします。**
 * 知らないキーは黙って無視します（台帳から消しても落ちません）。
 */
export function playSE(key) {
  if (!seOn || !key) return;
  try {
    let el = cache.get(key);
    if (!el) {
      el = makeAudio(assetPath.se(key));
      if (!el) return;
      el.preload = "auto";
      cache.set(key, el);
    }
    el.volume = SE_VOLUME;
    el.currentTime = 0;
    el.play?.()?.catch?.(() => {});
  } catch { /* 鳴らないだけ。止めない */ }
}

/**
 * BGM を差し替える。**同じ曲ならそのまま続けます** —— 画面を描き直すたびに
 * 頭から鳴り直すと、ホームとマイページを行き来しただけで曲が切れます。
 */
export function playBGM(key) {
  if (!bgmOn || !key) return;
  if (bgmKey === key && bgmEl && !bgmEl.paused) return;
  stopBGM();
  const el = makeAudio(assetPath.bgm(key));
  if (!el) return;
  el.loop = true;
  el.volume = BGM_VOLUME;
  bgmEl = el;
  bgmKey = key;
  try { el.play?.()?.catch?.(() => {}); } catch { /* 鳴らないだけ */ }
}

export function stopBGM() {
  try { bgmEl?.pause?.(); } catch { /* 何もしない */ }
  bgmEl = null;
  bgmKey = null;
}

/** MCH の effect_id（1単体 / 2全体 / 3回復 / 4バフ / 5デバフ）を音に読み替える */
export const EFFECT_SE = { 1: "hit", 2: "blast", 3: "heal", 4: "buff", 5: "debuff" };
