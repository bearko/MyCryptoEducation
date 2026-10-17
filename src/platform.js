/* bearko.games 共通基盤への窓口（総合スコア。bearko/mycryptoportfolio の SPEC-002 3.6、docs/game-clear.md）。
   送るのは「知識カード・クリア・解放した英雄・称号・知識マップのマス」の数と、それで決まるトロフィーだけ。点の計算は共通基盤のサーバーが行う。
   **報酬にも遊び方にも触りません**（原則3-2）。どれも答え方や速さで変わらないので、点も変わりません。
   ゲーム内の点（S.score）は送りません（点を称号やほかの数字につなげない）。
   SDK（https://bearko.games/sdk/v1.js）が読めない・通信に失敗しても何もしません。
   単一ファイル版はモジュールを結合するので、名前は platform〜 で始めて重ならないようにしています */

import { gameCleared, unlockedHeroCount, earnedTitles, knowledgeMapProgress } from "./engine.js";

const PLATFORM_EVERY = 60 * 1000; // 送るのは多くても1分に1回
let platformSent = null;           // 最後に送った成績
let platformLastAt = 0;
let platformPending = null;
let platformWasCleared = null;     // 開いた時点でクリア済みだったか（開き直すたびに通知を出さないため）

const platformSdk = () => (typeof window !== "undefined" ? window.BearkoGames : undefined);

/** 送る成績。純粋関数 */
export function platformMetrics(db, S) {
  return {
    cards: Object.keys((S && S.cards) || {}).length,
    cleared: gameCleared(db, S),
    heroes: unlockedHeroCount(db, S),
    titles: earnedTitles(db, S).length,
    cells: knowledgeMapProgress(db, S).done,
  };
}

/** a が b より進んでいるか（どれか1つでも増えた）。純粋関数 */
export function platformAhead(a, b) {
  if (!b) return a.cards > 0 || a.cleared || a.heroes > 0 || a.titles > 0 || a.cells > 0;
  return a.cards > b.cards || (a.cleared && !b.cleared) ||
    a.heroes > b.heroes || a.titles > b.titles || a.cells > b.cells;
}

function platformSend(metrics, quiet = true) {
  const bg = platformSdk();
  if (!bg || typeof bg.submitScore !== "function") return;
  platformSent = metrics;
  platformLastAt = Date.now();
  try {
    Promise.resolve(bg.submitScore(metrics, { quiet }))
      .then(r => { if (!r || !r.ok) console.warn("[platform] score", r && r.error); })
      .catch(e => console.warn("[platform] score", e));
  } catch (e) {
    console.warn("[platform] score", e);
  }
}

export function initPlatform(version) {
  const bg = platformSdk();
  if (!bg) return;
  try {
    Promise.resolve(bg.init({ game: "education", version }))
      .then(() => platformChatApply())   // SDK が後から読めても、いまの画面の出す／隠すをそろえる
      .catch(e => console.warn("[platform] init", e));
  } catch (e) {
    console.warn("[platform] init", e);
  }
  /* 閉じる前に、まだ送っていない分を送る */
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && platformPending) { platformSend(platformPending); platformPending = null; }
    });
  }
}

/* ---- 全体チャット（共通基盤 SPEC-004。SDK 1.6.0 から） ----
   窓そのものは SDK が描きます（右下の 💬）。ここでは出す・隠すだけです。
   **出題の最中（quiz / wave / challenge）と、最初の学年選び（grade）では隠します。**
   問題を解いているあいだは問題に集中してもらうため、学年選びは説明も案内も置かない1画面だからです（決定1）。
   SDK が無い・古い（chat が無い）ときは何もしません */
let platformChatWanted = true;

function platformChatApply() {
  const bg = platformSdk();
  if (!bg || !bg.chat || typeof bg.chat.setVisible !== "function") return;
  try { bg.chat.setVisible(platformChatWanted); } catch (e) { console.warn("[platform] chat", e); }
}

/** 💬 を出す（true）／隠す（false）。SDK が後から読めたときは、覚えておいた値をそろえます */
export function platformChatVisible(on) {
  platformChatWanted = !!on;
  platformChatApply();
}

/** 出題の画面と学年選びでは隠す。純粋関数 */
export function platformChatHiddenFor(view) {
  return view === "quiz" || view === "wave" || view === "challenge" || view === "grade";
}

/* ---- bearko.games 共通のアイコン（共通基盤 SPEC-005 5.3。SDK 1.7.0） ----
   このゲームのユーザーアイコン（手持ちの英雄）とは別のものです。共通基盤のほうは、すべてのゲームとチャットで同じ絵になります。
   選ぶ窓は SDK が持っているので、ここでは開くだけ。SDK が無い・古いときは入口を出しません */
export function platformCanPickAvatar() {
  const bg = platformSdk();
  return !!(bg && typeof bg.openAvatarPicker === "function");
}
export function platformOpenAvatarPicker() {
  const bg = platformSdk();
  if (!bg || typeof bg.openAvatarPicker !== "function") return false;
  try { bg.openAvatarPicker(); } catch (e) { console.warn("[platform] avatar", e); }
  return true;
}

/* ---- トロフィー（docs/game-clear.md §5。定義は共通基盤の platform/trophies.js） ---- */

export const PLATFORM_CARDS_TROPHY = 300;

/** 満たしているトロフィーの ID。純粋関数。どれも持ち物の数だけで決まり、答え方や速さでは変わらない */
export function platformTrophies(db, S) {
  const m = platformMetrics(db, S);
  const map = knowledgeMapProgress(db, S);
  const out = [];
  if (m.heroes > 0) out.push("education.hero1");
  if (m.cleared) out.push("education.clear");
  if (map.total > 0 && map.done >= map.total) out.push("education.map");
  if (m.cards >= PLATFORM_CARDS_TROPHY) out.push("education.cards300");
  return out;
}

const platformTrophiesSent = new Set(); // このページを開いてから送ったもの（保存しない）
/* 1つずつ順に送る。未ログインで同時に送ると、Cookie がまだないので仮アカウントが送った数だけできてしまう */
let platformTrophyChain = Promise.resolve();

/** まだ送っていないトロフィーを送る、ただ1か所。通知は SDK が出す（はじめて取ったときだけ） */
export function platformSyncTrophies(db, S) {
  const bg = platformSdk();
  if (!bg || typeof bg.unlockTrophy !== "function") return platformTrophyChain;
  for (const id of platformTrophies(db, S)) {
    if (platformTrophiesSent.has(id)) continue;
    platformTrophiesSent.add(id);
    platformTrophyChain = platformTrophyChain
      .then(() => bg.unlockTrophy(id))
      .then(r => { if (r && r.ok === false) console.warn("[platform] trophy", id, r.error); })
      .catch(e => console.warn("[platform] trophy", id, e));
  }
  return platformTrophyChain;
}

/** 保存のたびに呼ぶ。どれかが増えたときだけ、1分に1回まで送る。
    **クリアした瞬間だけは待たずに送り、自己ベストの通知を出す**（ほかは積み上げなので通知なし） */
export function notePlatformProgress(db, S) {
  if (!platformSdk()) return;
  platformSyncTrophies(db, S); // トロフィー（§5）。増えたかどうかに関係なく、まだ送っていないものを送る
  const m = platformMetrics(db, S);
  if (platformWasCleared === null) platformWasCleared = m.cleared;
  if (!platformAhead(m, platformSent)) return;
  if (m.cleared && !platformWasCleared) { platformWasCleared = true; platformSend(m, false); platformPending = null; }
  else if (Date.now() - platformLastAt >= PLATFORM_EVERY) { platformSend(m); platformPending = null; }
  else platformPending = m;
}

/** RTA の区切り（docs/game-clear.md §4）を送る、ただ1か所。
    **計測中（Education のレギュレーション）のときだけ送ります。** いまは計測を始める入口がないので、ふだんは何もしません */
export function platformCheckpoint(id) {
  const bg = platformSdk();
  const rta = bg && bg.rta;
  if (!rta || typeof rta.current !== "function" || typeof rta.checkpoint !== "function") return;
  try {
    const cur = rta.current();
    if (!cur || !String(cur.regulation || "").startsWith("education")) return;
    Promise.resolve(rta.checkpoint(id)).catch(e => console.warn("[platform] rta", e));
  } catch (e) {
    console.warn("[platform] rta", e);
  }
}
