# bearko.games 共通基盤の総合スコア

bearko.games の総合スコア（[bearko/mycryptoportfolio の SPEC-002](https://github.com/bearko/mycryptoportfolio/blob/claude/game-portfolio-page-4afqbc/docs/specs/SPEC-002-total-score.md) 3.6）に参加する。

- 送るのは **知識カードの枚数** だけ（`src/platform.js`）。点の計算は共通基盤のサーバー（1 枚 ≒ 21.3 点。469 枚で 10,000）
- **報酬にも遊び方にも触らない**（原則3-2）。カードの枚数は速さで変わらないので、点も速さで変わらない
- 描画のたびの保存（`render` の `saveState`）のあとに `notePlatformProgress` を呼び、カードが増えたときだけ 1 分に 1 回まで送る。画面を閉じる前（`visibilitychange`）に、まだ送っていない分を送る
- 積み上げなので通知は出さない（`quiet`）。順位・自己ベストは bearko.games のマイページで見る
- SDK（`https://bearko.games/sdk/v1.js`）が読めない・通信に失敗しても何もしない。単一ファイル版（`npm run build`）には SDK を入れない（オフライン配布のため）
- 単一ファイル版はモジュールを結合するので、`src/platform.js` の名前は `platform〜` で始めている。`scripts/build.mjs` の `ORDER` に足してある
- 「ゲームクリア」が決まったら（#1）、節目の点を足すか見直す
