/* bearko.games 共通基盤への窓口（総合スコア。bearko/mycryptoportfolio の SPEC-002 3.6、docs/game-clear.md）。
   送るのは「知識カード・クリア・解放した英雄・称号・知識マップのマス」の数だけ。点の計算は共通基盤のサーバーが行う。
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
    Promise.resolve(bg.init({ game: "education", version })).catch(e => console.warn("[platform] init", e));
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

/** 保存のたびに呼ぶ。どれかが増えたときだけ、1分に1回まで送る。
    **クリアした瞬間だけは待たずに送り、自己ベストの通知を出す**（ほかは積み上げなので通知なし） */
export function notePlatformProgress(db, S) {
  if (!platformSdk()) return;
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
