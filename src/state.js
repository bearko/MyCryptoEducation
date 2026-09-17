/* ゲーム状態。進行ぶんだけ localStorage に保存する */

const STORAGE_KEY = "sekai-no-kyoushitsu/v1";

export const NAME_MAX = 255;

/* ユーザー名の上限。差し替えUIが入る前から、保存データ経由でも効かせる */
export function capName(name) {
  return typeof name === "string" ? name.slice(0, NAME_MAX) : name;
}

/* 保存する項目。run / challenge / view などの一時的なものは持ち越さない */
const PERSISTED = ["settings", "profile", "gum", "points", "exts", "equip",
                   "owned", "cards", "cells", "seen", "runs", "score", "days",
                   "totalRight", "crossRight", "countries", "crystals", "introDone", "startGrade",
                   "modeLevel"];

function defaults() {
  return {
    view: "home",
    /* 出題を選ぶ画面。**3教科はくじで引いて、引いたら覚えておきます。**
       ホームへ戻って入り直しても引き直しません（引き直せると、欲しい教科が
       出るまで往復することになります）。出発した時点で捨てて、次に引き直します。
       seed はエネミーの割り当てに使う数で、くじと一緒に決まります */
    select: { band: "auto", subject: "auto", picks: null, seed: 0, run: null },

    // 設定
    settings: {
      showExplanationOnCorrect: true,  // OFFにすると正解時は演出だけで次へ進む
    },

    // ステータス層の表示。称号は「称号・カレンダー」の実装まで null のまま。
    // icon は手持ちの英雄のID。マイページができたら差し替えられるようにしておく
    profile: { name: "旅人", title: null, icon: "10001" },
    gum: 0,

    exts: {},
    equip: {},
    owned: { "10001": 1, "10002": 1, "10003": 1 },
    cards: {},
    cells: {},
    seen: {},
    runs: 0,
    /* 出題形式ごとの段（Lv.1〜Lv.3）。**上がるだけで下がらない**（engine.levelUps）。
       学年が「どの教育課程か」で、段は同じ学年の中での踏みこみ方 */
    modeLevel: {},
    // 無説明の初回起動（決定1）を終えたか。終えるまでホームは出さない
    introDone: false,
    startGrade: null,   // 初回に選んだ学年。梯子の下端になる
    score: 0,

    crystals: {},         // 出会ったクリスタル { "001": 個数, ... }。図鑑。減らない
    points: {},           // 族ごとのポイント { "石英": 120, ... }。クラフトが払うのはこちら

    // 称号の判定に使う積み上げ
    totalRight: 0,        // 累計の正解数
    crossRight: 0,        // いまの範囲の外（chapter 2以上）での正解数
    countries: {},        // 正解した問題の国名

    // カレンダーの記録。"YYYY-MM-DD" → { runs, right, wrong, appliedRight, results }
    // 連続日数は数えない。ボーナスもペナルティも持たせないため
    days: {},

    // 現在のセッション。noReward は記録からの再挑戦（報酬なし）
    // hard は問題IDごとの難モードの状態。4択に降りたら "choice" が入る。
    // 降りるかどうかは毎問プレイヤーが決める（決定2）。前の問題を引き継がない
    run: { ids: [], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
           right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, found: [], cut: null,
           results: {}, noReward: false, done: false, hard: {} },

    // チャレンジ。3問構成で、qi が何問目か、results が各問の正誤
    challenge: { heroId: null, phase: "intro", breakdown: null, reach: 0,
                 tries: 0, done: false, message: "",
                 qi: 0, results: [], gotCard: null },

    heroesTab: "own",   // ヒーロー画面のタブ（own / codex）
    calendar: null,     // カレンダーで見ている月 { year, month }
    myTab: "name",      // マイページのタブ（name / icon / title）
    craftTab: null,     // クラフト画面で見ているランク（初伝/中伝/奥伝）
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
