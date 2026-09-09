/* ゲーム状態。進行ぶんだけ localStorage に保存する */

const STORAGE_KEY = "sekai-no-kyoushitsu/v1";

/* 保存する項目。run / challenge / view などの一時的なものは持ち越さない */
const PERSISTED = ["settings", "profile", "gum", "gems", "exts", "equip",
                   "owned", "cards", "cells", "seen", "runs", "score"];

function defaults() {
  return {
    view: "home",
    select: { band: "auto", subject: "auto" },

    // 設定
    settings: {
      showExplanationOnCorrect: true,  // OFFにすると正解時は演出だけで次へ進む
    },

    // ステータス層の表示。称号は「称号・カレンダー」の実装まで null のまま
    profile: { name: "旅人", title: null },
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

    // 現在のセッション
    run: { ids: [], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
           gems: {}, right: 0, wrong: 0, appliedRight: 0, shortage: 0 },

    // チャレンジ
    challenge: { heroId: null, phase: "intro", breakdown: null, damage: 0,
                 tries: 0, done: false, message: "" },

    heroesTab: "own",   // ヒーロー画面のタブ（own / codex）
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
  return state;
}
