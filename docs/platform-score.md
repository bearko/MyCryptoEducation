# bearko.games 共通基盤の総合スコア

bearko.games の総合スコア（[bearko/mycryptoportfolio の SPEC-002](https://github.com/bearko/mycryptoportfolio/blob/claude/game-portfolio-page-4afqbc/docs/specs/SPEC-002-total-score.md) 3.6）に参加する。何を送るかとその理由は `docs/game-clear.md` 3 章。

- 送るのは **知識カードの枚数・クリアしたか・解放した英雄の数・称号の数・知識マップの埋まったマスの数**（`src/platform.js` の `platformMetrics`）。点の計算は共通基盤のサーバー
- **報酬にも遊び方にも触らない**（原則3-2）。どれも答え方や速さで変わらないので、点も速さで変わらない。ゲーム内の点（`S.score`）は送らない
- 描画のたびの保存（`render` の `saveState`）のあとに `notePlatformProgress` を呼び、どれかが増えたときだけ 1 分に 1 回まで送る。画面を閉じる前（`visibilitychange`）に、まだ送っていない分を送る
- 積み上げなので通知は出さない（`quiet`）。**クリアした瞬間だけは待たずに送り、自己ベストの通知を出す**（開き直したときには出さない）
- RTA の区切り（`hero1` → `clear`）は `platformCheckpoint` の 1 か所から送る。計測中のときだけ送り、ふだんは何もしない（計測を始める入口はまだ無い）
- SDK（`https://bearko.games/sdk/v1.js`）が読めない・通信に失敗しても何もしない。単一ファイル版（`npm run build`）には SDK を入れない（オフライン配布のため）
- 単一ファイル版はモジュールを結合するので、`src/platform.js` の名前は `platform〜` で始めている。`scripts/build.mjs` の `ORDER` に足してある
- **総合ランキングへの導線**（作者の決定 2026-10-17、MyCryptoPortfolio#29）：マイページ（S-24）の名前の下に、小さく「bearko.games の総合ランキング ↗」（`https://bearko.games/score/?game=education`、新しいタブ）。**ゲームの中には順位を出さない**（ホーム・リザルト・チャレンジには置かない。`docs/research-edtech.md` §3 の「順位という外からの圧力」を持ちこまないため）。マイページは自分の記録を見に行く場所なので、そこからだけ外へ出られるようにする
