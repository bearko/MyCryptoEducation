/* ゲーム状態。進行ぶんだけ localStorage に保存する */

const STORAGE_KEY = "sekai-no-kyoushitsu/v1";

export const NAME_MAX = 255;

/* ユーザー名の上限。差し替えUIが入る前から、保存データ経由でも効かせる */
export function capName(name) {
  return typeof name === "string" ? name.slice(0, NAME_MAX) : name;
}

/* 保存する項目。run / challenge / view などの一時的なものは持ち越さない */
const PERSISTED = ["settings", "profile", "gum", "gems", "exts", "equip",
                   "owned", "cards", "cells", "seen", "runs", "score", "days",
                   "totalRight", "crossRight", "countries", "crystals"];

function defaults() {
  return {
    view: "home",
    select: { band: "auto", subject: "auto" },

    // 設定
    settings: {
      showExplanationOnCorrect: true,  // OFFにすると正解時は演出だけで次へ進む
    },

    // ステータス層の表示。称号は「称号・カレンダー」の実装まで null のまま。
    // icon は手持ちの英雄のID。マイページができたら差し替えられるようにしておく
    profile: { name: "旅人", title: null, icon: "10001" },
    gum: 0,

    gems: { ifrit: 0, levia: 0, tiamat: 0, garuda: 0 },
    exts: {},
    equip: {},
    owned: { "10001": 1, "10002": 1, "10003": 1 },
    cards: {},
    cells: {},
    seen: {},
    runs: 0,
    score: 0,

    crystals: {},         // 買ったクリスタル { "001": 個数, ... }

    // 称号の判定に使う積み上げ
    totalRight: 0,        // 累計の正解数
    crossRight: 0,        // いまの範囲の外（chapter 2以上）での正解数
    countries: {},        // 正解した問題の国名

    // カレンダーの記録。"YYYY-MM-DD" → { runs, right, wrong, appliedRight, results }
    // 連続日数は数えない。ボーナスもペナルティも持たせないため
    days: {},

    // 現在のセッション。noReward は記録からの再挑戦（報酬なし）
    run: { ids: [], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
           gems: {}, right: 0, wrong: 0, appliedRight: 0, shortage: 0,
           results: {}, noReward: false, done: false },

    // チャレンジ
    challenge: { heroId: null, phase: "intro", breakdown: null, damage: 0,
                 tries: 0, done: false, message: "" },

    heroesTab: "own",   // ヒーロー画面のタブ（own / codex）
    calendar: null,     // カレンダーで見ている月 { year, month }
    myTab: "name",      // マイページのタブ（name / icon / title）
    dayView: null,      // 開いている日 "YYYY-MM-DD"
    stage: { i: 0 },    // ホームで見ている挑戦相手（未解放の英雄の何番目か）
    heroView: null,
    toast: null,
  };
}

/* localStorage は使えないことがある（file://、プライベートモード、jsdom）。
   読めなくても書けなくても、ゲームは初期状態から普通に遊べる */
function readStore() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return saved && typeof saved === "object" ? saved : null;
  } catch { return null; }
}

export function saveState(state) {
  try {
    const store = globalThis.localStorage;
    if (!store) return false;
    const out = {};
    for (const k of PERSISTED) out[k] = state[k];
    store.setItem(STORAGE_KEY, JSON.stringify(out));
    return true;
  } catch { return false; }
}

export function clearState() {
  try {
    const store = globalThis.localStorage;
    if (!store) return false;
    store.removeItem(STORAGE_KEY);
    return true;
  } catch { return false; }
}

export function createState() {
  const state = defaults();
  const saved = readStore();
  if (!saved) return state;

  // 保存対象だけを、型が合っているものに限って戻す。
  // 壊れた保存データでゲームが起動しなくなるほうが困る
  for (const k of PERSISTED) {
    const v = saved[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) !== Array.isArray(state[k])) continue;
    if (typeof v !== typeof state[k]) continue;
    state[k] = (v && typeof v === "object" && !Array.isArray(v))
      ? { ...state[k], ...v } : v;
  }
  state.profile.name = capName(state.profile.name);
  return state;
}
