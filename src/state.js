/* ゲーム状態。セッション内のみで保持する（永続化は未実装） */

export function createState() {
  return {
    view: "home",
    select: { band: "auto", subject: "auto" },

    // 設定
    settings: {
      showExplanationOnCorrect: true,  // OFFにすると正解時は演出だけで次へ進む
    },

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

    heroView: null,
    toast: null,
  };
}
