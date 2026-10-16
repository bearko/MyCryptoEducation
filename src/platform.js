/* bearko.games 共通基盤への窓口（総合スコア。bearko/mycryptoportfolio の SPEC-002 3.6）。
   送るのは「知識カードの枚数」だけ。点の計算は共通基盤のサーバーが行う。
   **報酬にも遊び方にも触りません**（原則3-2）。カードの枚数は速さで変わらないので、点も速さで変わりません。
   SDK（https://bearko.games/sdk/v1.js）が読めない・通信に失敗しても何もしません。
   単一ファイル版はモジュールを結合するので、名前は platform〜 で始めて重ならないようにしています */

const PLATFORM_EVERY = 60 * 1000; // 送るのは多くても1分に1回
let platformSent = -1;             // 最後に送った枚数
let platformLastAt = 0;
let platformPending = null;

const platformSdk = () => (typeof window !== "undefined" ? window.BearkoGames : undefined);

/** 送る成績。純粋関数 */
export function platformMetrics(S) {
  return { cards: Object.keys((S && S.cards) || {}).length };
}

function platformSend(metrics) {
  const bg = platformSdk();
  if (!bg || typeof bg.submitScore !== "function") return;
  platformSent = metrics.cards;
  platformLastAt = Date.now();
  try {
    Promise.resolve(bg.submitScore(metrics, { quiet: true }))
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

/** 保存のたびに呼ぶ。カードが増えたときだけ、1分に1回まで送る */
export function notePlatformProgress(S) {
  if (!platformSdk()) return;
  const m = platformMetrics(S);
  if (m.cards <= platformSent || m.cards === 0) return;
  if (Date.now() - platformLastAt >= PLATFORM_EVERY) { platformSend(m); platformPending = null; }
  else platformPending = m;
}
