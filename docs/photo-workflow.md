# 写真を取り込んで push するまで

コモンズからの取り込みは**手元のマシンでしか走らせられません**（開発コンテナから
Wikimedia に出られないため）。毎回の手順をここに置いておきます。

---

## 毎回やること

```powershell
# ① 先に手元を GitHub にそろえる（取り込みの前に、ここまで済ませておく）
git fetch origin
git reset --hard origin/main

# ② 取り込む
node scripts/fetch-commons.mjs        # file が空の行だけを取りに行く

# ③ 確かめて送る
npm run validate
git add -A
git commit -m "◯◯の写真を取り込む"
git push
```

**①と②の順番を入れかえないでください。**

`git reset --hard` は**追跡されていないファイルを消しません。** 取り込んだあとに
走らせると、`data/images.json` に書き戻された欄だけが元に戻り、**webp だけが
残ります。**作者もライセンスも分からない画像になるので、その写真は使えません
（実際に `obj-pan` でこれが起きました）。`npm run validate` が、台帳に載っていない
webp を警告します。

---

## 取り込みが当たらないとき

### 候補を並べてから選ぶ

```powershell
node scripts/fetch-commons.mjs --list obj-pan
```

取り込まずに候補を20件並べます。`○` が `data/images.json` の `allow` にあるライセンス、
`×` はそうでないもの。

```
  obj-pan  filetype:bitmap white bread loaf
   ○  1. Public domain      288x188   File:Sliced bread bag2.jpg
   ×  2. CC BY-SA 2.0      2048x1536  File:Sliced banana bread.jpg
```

**日用品はこれを必ず通してください。** 検索して1件目を採る作りは、人物では効きますが
日用品では当たりません。実際に起きたこと：

- `dog sitting portrait` → 投稿者名 `DogTwo` に当たり、**カフェにいる人の写真**
- `chicken egg white` → **マヨネーズの皿**（卵は脇に写っているだけ）
- `Shakespeare Chandos portrait` → **ヘンデルの肖像画**（同名の絵が別人にもあった）

### 1枚を決め打ちする

候補から選んだら、`data/images.json` のその行に書きます。

```json
"obj-pan": { "commons": "File:〜.jpg", "alt": "…" }
```

`commons` があると検索を飛ばしてその1枚を採ります。`search` と `insource` は消して
構いません。

### 候補がゼロのとき

**絞りこみのかけすぎです。** `insource` と長い検索語を重ねると、条件を全部満たす
ファイルが無くなります。出力の「投げた検索文」を見てください。

```
  obj-yama: 見つかりません
      投げた検索文: filetype:bitmap insource:"Cc-zero" Mount Fuji snow symmetrical cone
```

`--list` で人が選ぶなら `insource` は要りません。検索語も2〜3語に短くします。

---

## 採れた画像は、必ず目で見てください

**ライセンスは機械が保証できますが、写っているものが誰か・何かは保証できません。**
`public/commons/` の webp を開いて確かめます。見るところは3つ。

1. **狙った被写体か。** 上に挙げたとおり、別人・別物がふつうに来ます
2. **画中に名前が書かれていないか。** 切手や版画には名前が刷りこまれていることが
   あります（ガウスの切手、芭蕉の版画）。スワイプで「名前を伏せる」狙いが崩れます
3. **小さくしても分かるか。** 絵の選択肢は 88px 幅です。遠景の風景や、
   皿や袋に隠れたものは、この大きさでは読めません

---

## push が通らないとき

### `local changes would be overwritten`

```powershell
git diff data/images.json
```

**何も出ないなら、中身は同じで改行コードだけの違いです。** 捨てて構いません。

```powershell
git checkout -- data/images.json
git pull
```

`.gitattributes` を入れてあるので、いまは起きにくくなっています。まだ出るようなら
一度だけ `git add --renormalize .` を走らせてください。

### `non-fast-forward` / `tip of your current branch is behind`

**GitHub のほうが進んでいます。** そのまま `git pull` を重ねると
`data/images.json` で衝突することがあります（同じ行を両方から触るため）。

コミットをすでに作ってしまっているなら、**main を触らずに別の枝として送ってください。**

```powershell
git push origin main:refs/heads/bearko-photos
```

こちらで中身を見て取り込み、main へ入れます。そのあと手元をそろえ直します。

```powershell
git fetch origin
git reset --hard origin/main
```

---

## 取り込みの決まり（`CLAUDE.md` から）

- 使えるライセンスは **PD・CC0・CC BY** だけ（`data/images.json` の `allow`）。
  **CC BY-SA・NC・ND は使いません**
- **写真はクレジットとセットでしか出しません。** 作者・ライセンス・出典を必ず表示します
- **スワイプの写真は PD・CC0 に限ります。** この2つだけ、出題中に題名を伏せられます
  （題名が被写体の名前そのものなので、出すと答えになります）
- **絵の選択肢（`choiceArt`）は、題名の要るライセンスにだけ題名を付けます。**
  CC BY 1.0〜3.0 が条件、4.0 で外れました
- **`alt` は問題ごとに書きます。** 台帳の `alt` は被写体を名指ししているので、
  そのまま出すと答えになります
- CI では走らせません（相手先のサーバに負荷をかけないため）。1件ごとに1.2秒待ちます
