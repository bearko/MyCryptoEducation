#!/usr/bin/env node
/* 問題DBの整合性チェック。CIで走らせる。
   使い方: npm run validate                                        */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
/* 回答方式の判定はここに集約する。アプリと2箇所に分けると必ずズレる */
import { answerMode, hintGroup, hintsFor, normalizeHints, answerText, numericParts }
  from "../src/answer-mode.js";
import { panelLayout, MAX_LEVEL, levelOf, blockSize } from "../src/engine.js";
/* 釣り合いはアプリと同じ式から導く。2箇所に分けると必ずズレる */
import { buildExtensions } from "../src/data.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_LENGTH = 10;
const SUBJECTS = ["国語", "算数・数学", "理科", "社会", "外国語", "情報"];
const GRADES = ["e1","e2","e3","e4","e5","e6","j1","j2","j3","w"];
const BANDS = { e: ["e1","e2","e3","e4","e5","e6"], j: ["j1","j2","j3"], w: ["w"] };

/* 画面と同じ形式名。出力にだけ使う */
const MODE_LABEL_V = { elimination: "消去法", numeric: "数値入力", range: "レンジ",
                       panel: "文字パネル", multi: "複数選択", choice: "4択", swipe: "スワイプ" };

/* 写真に使えるライセンス。CC BY-SA は改変物に波及するので入れない */
const ALLOWED_LICENSES = [];

/* 難モードで選択肢が見えないとき、ヒントは別系統が要る */
const HINT_GROUPS = ["choice", "hidden"];
const HINT_MIN = 3;
/* 数値の答えから単位を落とした形。ヒントが素の数値を漏らしていないか見る */
const bareNumber = t => String(t).replace(/[^\d０-９.．]/g, "");
const squash = t => String(t).replace(/[\s。、，,]/g, "");

const errors = [];
const warnings = [];
const err  = (id, msg) => errors.push(`${id}: ${msg}`);
const warn = (msg) => warnings.push(msg);

const json = async p => JSON.parse(await readFile(join(ROOT, p), "utf8"));

const questions = [];
for (const file of await readdir(join(ROOT, "data/questions"))) {
  if (!file.endsWith(".json")) continue;
  const list = await json(`data/questions/${file}`);
  if (!Array.isArray(list)) { err(file, "配列ではありません"); continue; }
  list.forEach(q => questions.push({ ...q, _file: file }));
}
const figures    = await json("data/figures.json");
const heroes     = await json("data/heroes.json");
const curated    = await json("data/extensions-curated.json");
const crystals   = await json("data/crystals.json");
const curriculum = await json("data/curriculum.json");
const imageBook  = await json("data/images.json");
ALLOWED_LICENSES.push(...(imageBook.allow || []).map(x => String(x).toLowerCase()));
if (!ALLOWED_LICENSES.length) err("images.json", "allow が空です");
for (const bad of ALLOWED_LICENSES)
  if (bad.includes("-sa") || bad.includes("nc") || bad.includes("nd"))
    err("images.json", `allow に "${bad}" が入っています。SA・NC・ND は使いません`);

/* ---- 1問ごとの検証 ---- */
const seenIds = new Set();
const promptsBySubject = {};
const allPrompts = new Map();
const cardOwner = new Map();

for (const q of questions) {
  const id = q.id || `(id未設定 in ${q._file})`;

  const format = q.format || "choice";
  if (!["choice", "range", "swipe"].includes(format)) err(id, `未知の出題形式 "${format}"`);

  const common = ["id","chapter","grade","gradeLabel","subject","unit","prompt","hints","lesson","tip","card"];
  /* **スワイプにヒントと Tips は要りません。** 途中で何も挟まないのがこの形式の芯で、
     出す場所が無いものを必須にすると、書けない欄を埋めるためだけの文が増えます */
  const needed = format === "range" ? [...common, "year"]
    : format === "swipe"
      ? ["id","chapter","grade","gradeLabel","subject","unit","prompt","lesson","card",
         "choices","answer","image","alt"]
      : [...common, "choices", "answer"];
  for (const k of needed) {
    if (q[k] === undefined || q[k] === null || q[k] === "") err(id, `必須項目 ${k} がありません`);
  }
  if (seenIds.has(q.id)) err(id, "IDが重複しています");
  seenIds.add(q.id);

  if (!SUBJECTS.includes(q.subject)) err(id, `未知の教科 "${q.subject}"`);
  if (!GRADES.includes(q.grade))     err(id, `未知の学年キー "${q.grade}"`);
  // カリキュラムに無い組み合わせに問題を置くと、どの教育課程にも対応しない作り物になる
  const shape = curriculum.exists[q.subject];
  if (shape && !shape.includes(q.grade))
    err(id, `${q.subject} は ${q.grade} に存在しません（data/curriculum.json）`);
  if (!crystals.subjectToFamily?.[q.subject]) err(id, `教科 "${q.subject}" に対応する族がありません`);

  if (format === "range") {
    if (!Number.isInteger(q.year)) err(id, `year は整数で書いてください（紀元前は負の数）`);
    else if (q.year > new Date().getFullYear()) err(id, `year が未来です (${q.year})`);
    if (q.choices || q.answer !== undefined) err(id, "レンジ回答に choices / answer は要りません");
    if (q.precision !== undefined && !(q.precision > 0)) err(id, `precision は正の数にしてください (${q.precision})`);
    if (q.applied) err(id, "レンジ回答の応用編はまだ扱えません");
  } else if (!Array.isArray(q.choices) || q.choices.length < 2) err(id, "選択肢が2つ未満です");
  else {
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length)
      err(id, `answer が選択肢の範囲外です (${q.answer} / 0-${q.choices.length - 1})`);
    if (new Set(q.choices).size !== q.choices.length) err(id, "選択肢に重複があります");
  }

  /* ---- ヒントのグループ ---- */
  const mode = answerMode(q);
  const hints = Array.isArray(q.hints) ? normalizeHints(q.hints) : [];
  for (const h of hints) {
    if (!h.text || typeof h.text !== "string") err(id, "ヒントに text がありません");
    if (h.only !== undefined && !HINT_GROUPS.includes(h.only))
      err(id, `ヒントの only は "choice" か "hidden" です（いま ${JSON.stringify(h.only)}）`);
  }
  if (format !== "swipe") for (const g of HINT_GROUPS) {
    const n = hintsFor(q.hints || [], g).length;
    if (n < HINT_MIN)
      err(id, `${g} で使えるヒントが ${n}本しかありません（${HINT_MIN}本必要）`);
  }

  /* 選択肢が見えないモードでは、ヒントが答えや誤答を漏らしていないか見る */
  if (hintGroup(mode) === "hidden") {
    const ans = answerText(q).trim();
    const bare = bareNumber(ans);
    const wrongs = (q.choices || []).filter((_, i) => i !== q.answer).map(squash);
    for (const h of hintsFor(q.hints || [], "hidden")) {
      const body = squash(h.text);
      const leaks = (ans.length >= 2 && body.includes(squash(ans)))
        || (bare.length >= 2 && body.includes(bare));
      if (leaks) err(id, `${mode} のヒントが答え「${ans}」を含んでいます: ${h.text}`);
      const touched = wrongs.filter(w => w.length >= 2 && body.includes(w));
      if (touched.length)
        warn(`${id}: ${mode} のヒントが誤答「${touched.join("・")}」に触れています: ${h.text}`);
    }
  }

  /* 数値入力は、答えを「数」と「単位」に分けられることが前提 */
  if (mode === "numeric" && !numericParts(q))
    err(id, `数値入力に振り分けましたが、答え「${answerText(q)}」を数と単位に分けられません`);

  /* 文字パネルに要る読み */
  if (q.reading !== undefined) {
    if (!/^[ぁ-んァ-ヶー]{2,12}$/.test(q.reading))
      err(id, `reading は2〜12文字のかな・カナで書いてください（いま ${JSON.stringify(q.reading)}）`);
  }
  if (q.hardMode === "panel" && !q.reading)
    err(id, "文字パネルに振り分けていますが reading がありません");

  /* 文字パネルは、実際に経路を引けるかまで確かめる。
     100回で引けない問題をCIで落とす（experience-design-framework の決定4） */
  if (mode === "panel") {
    if (!panelLayout(q.reading, q.id))
      err(id, `文字パネルの経路を100回で引けませんでした（読み「${q.reading}」）`);
    // 読みの一部をヒントに書くと、知識ではなく探索の短縮を渡すことになる
    const kana = [...q.reading];
    for (const h of hintsFor(q.hints || [], "hidden")) {
      const body = squash(h.text);
      for (let n = 3; n <= kana.length; n++) {
        const part = kana.slice(0, n).join("");
        if (body.includes(part)) {
          warn(`${id}: ヒントが読みの一部「${part}」を含んでいます: ${h.text}`);
          break;
        }
      }
      if (/^\s*\d+文字/.test(h.text) || /(\d+)文字(だ|です)/.test(h.text))
        warn(`${id}: ヒントが文字数を明かしています: ${h.text}`);
    }
  }

  if (format !== "swipe" && (!Array.isArray(q.hints) || q.hints.length < 3))
    err(id, "ヒントは3つ以上必要です");
  else if (format === "range") {
    // 第3ヒントが年をそのまま書いていないか
    if (hints[2]?.text && hints[2].text.includes(String(q.year)))
      warn(`${id}: 第3ヒントに正解の年「${q.year}」がそのまま書かれています`);
  } else {
    // 第3ヒントが正解をそのまま書いていないか
    const correct = q.choices?.[q.answer] ?? "";
    const bare = squash(correct);
    if (bare.length >= 2 && hints[2]?.text && squash(hints[2].text).includes(bare))
      warn(`${id}: 第3ヒントに正解「${correct}」がそのまま含まれています`);
  }

  if (q.figure && !figures[q.figure]) err(id, `図版 "${q.figure}" が figures.json にありません`);

  /* 写真。クレジットを出せない画像は載せない（CC BY の条件） */
  if (q.image) {
    const p = imageBook.images?.[q.image];
    const where = q.imageAt || "lesson";
    if (!p) err(id, `写真 "${q.image}" が images.json にありません`);
    else {
      if (!p.file) err(id, `写真 "${q.image}" はまだ取り込まれていません（node scripts/fetch-commons.mjs）`);
      else if (!existsSync(join(ROOT, "public/commons", p.file + ".webp")))
        err(id, `写真の実体がありません: public/commons/${p.file}.webp`);
      for (const k of ["alt", "title", "author", "license", "source"])
        if (!p[k]) err(id, `写真 "${q.image}" に ${k} がありません（クレジットを出せません）`);
      if (p.license && !ALLOWED_LICENSES.includes(p.license.toLowerCase()))
        err(id, `写真 "${q.image}" のライセンス "${p.license}" は使えません（images.json の allow を参照）`);
    }
    if (!["prompt", "hint", "lesson"].includes(where))
      err(id, `imageAt は prompt / hint / lesson のどれかです（いま "${where}"）`);
    // ヒントに置く画像は、それだけで答えが割れてはいけない。
    // 選択肢そのものを写した写真は検出できないので、ここは形だけ見る
    if (where === "hint" && format === "choice" && /どれ|どちら|何という/.test(q.prompt) === false)
      warn(`${id}: ヒントに写真を置いています。それだけで答えが割れないか確かめてください`);
  }
  if (q.imageAt && !q.image) err(id, "imageAt があるのに image がありません");

  if (q.applied) {
    const a = q.applied;
    if (!Array.isArray(a.choices) || a.choices.length < 2) err(id, "応用編の選択肢が2つ未満です");
    else if (!Number.isInteger(a.answer) || a.answer < 0 || a.answer >= a.choices.length)
      err(id, "応用編の answer が範囲外です");
  }

  (promptsBySubject[q.subject] ??= new Map());
  const key = q.prompt.replace(/\s/g, "");
  if (promptsBySubject[q.subject].has(key))
    err(id, `同じ教科に同一の問題文があります（${promptsBySubject[q.subject].get(key)}）`);
  promptsBySubject[q.subject].set(key, q.id);

  // 教科をまたいだ重複も見る。数が増えるほど起きやすい
  if (allPrompts.has(key)) err(id, `他の教科に同一の問題文があります（${allPrompts.get(key)}）`);
  allPrompts.set(key, q.id);

  // 知識カード名の重複。同じ名前だとゲージ計算でひとまとめに数えられてしまう
  if (cardOwner.has(q.card) && cardOwner.get(q.card) !== q.id)
    warn(`${id}: 知識カード「${q.card}」が ${cardOwner.get(q.card)} と重複しています`);
  else cardOwner.set(q.card, q.id);
}

/* ---- 絵の選択肢（choiceArt）---- */
/**
 * **語のかわりに絵と ◯ を出す選択肢。**
 *
 * 「かたかなで書く言葉はどれ?」を語のまま並べると、カタカナの語が1つだけ
 * 見た目で浮いて、読まずに当てられます。絵にすると、その語がかなで書くものか
 * 外来語かは見ただけでは分かりません。◯ の数はその語の文字数で、
 * **どの絵が何のことかを言い当てるための手がかり**です。
 *
 * 気をつけるところが3つあります。
 *   1. **選択肢が見えない方式では、絵も出ません。** 文字パネルや数値入力に
 *      回る問題に付けても意味がない
 *   2. **文字数が答えを教えてしまう問いには使えません。** ◯ の数だけ他と違う
 *      選択肢が正解だと、絵を見なくても当たります
 *   3. 図版がそろっていないと、一部だけ語のまま出て不ぞろいになります
 */
{
  for (const q of questions) {
    if (q.choiceArt === undefined) continue;
    const id = q.id;
    if ((q.format || "choice") !== "choice")
      err(id, `choiceArt は4択・消去法の問題にだけ置けます（いま "${q.format}"）`);
    if (!Array.isArray(q.choiceArt) || q.choiceArt.length !== (q.choices || []).length) {
      err(id, `choiceArt は選択肢と同じ数の配列にしてください（絵 ${
        Array.isArray(q.choiceArt) ? q.choiceArt.length : "?"} / 選択肢 ${(q.choices || []).length}）`);
      continue;
    }
    q.choiceArt.forEach(k => {
      const photo = imageBook.images?.[k];
      if (photo) {
        // **写真はクレジットとセットでしか出せません**（原則どおり）
        if (!photo.file) err(id, `choiceArt の写真 "${k}" はまだ取り込まれていません（node scripts/fetch-commons.mjs）`);
        else {
          if (!existsSync(join(ROOT, `public/commons/${photo.file}.webp`)))
            err(id, `choiceArt の写真の実体がありません: public/commons/${photo.file}.webp`);
          for (const f of ["author", "license", "source"])
            if (!photo[f]) err(id, `choiceArt の写真 "${k}" に ${f} がありません（クレジットを出せません）`);
          if (photo.license && !ALLOWED_LICENSES.includes(String(photo.license).toLowerCase()))
            err(id, `choiceArt の写真 "${k}" のライセンス "${photo.license}" は使えません`);
          /* **題名は、要るものにだけ付けます。** CC BY 1.0〜3.0 は「題名があれば
             表示する」が条件で、4.0 で外れました。PD と CC0 は表示義務そのものが
             ありません。4枚ぶんの題名を全部並べると選択肢より背が高くなるので、
             `views.needsTitle` がこの見分けをして、要るものにだけ付けています */
          else if (/^cc by [123](\.|$)/i.test(String(photo.license)) && !photo.title)
            err(id, `choiceArt の写真 "${k}" は ${photo.license} なので題名の表示が要りますが、` +
                    `台帳に title がありません`);
        }
      } else if (!figures[k]) {
        err(id, `choiceArt の "${k}" が figures.json にも images.json にもありません`);
      }
    });
    let mode = answerMode(q);
    if (mode === "panel" && !panelLayout(q.reading, q.id)) mode = "elimination";
    if (hintGroup(mode) === "hidden")
      err(id, `choiceArt を置いていますが ${MODE_LABEL_V[mode] || mode} は選択肢を出しません`);
    // **文字数だけで当てられないか。** 正解の文字数が1つだけ違うと、絵を見ずに済む
    const len = q.choices.map(c => [...String(c)].length);
    const same = len.filter(n => n === len[q.answer]).length;
    if (same === 1)
      err(id, `◯の数（文字数）が正解だけ他と違います（${len.join("・")}）。` +
              `絵を見なくても当てられます`);
  }
  const withArt = questions.filter(q => q.choiceArt);
  if (withArt.length)
    console.log(`\n絵の選択肢 ・ ${withArt.length}問（${withArt.map(q => q.id).join(" / ")}）`);
}

/* ---- 問題文と回答方式の噛み合わせ ---- */
/**
 * **選択肢が見えない方式に、選択肢を前提にした問題文を回さないでください。**
 *
 * 文字パネル・数値入力・レンジは選択肢を出しません。そこへ「どれですか?」と
 * 聞く問題を回すと、**問いが別物になります。**
 *
 * 実際に出た例：「ふつうかたかなで書く言葉はどれ?」（`kokugo-012`）。
 * 4択なら やま／パン／たまご／いぬ から選ぶので成立しますが、文字パネルでは
 * 盤面をなぞるだけなので、**ジャパンでもジャンルでも問いの答えになります。**
 * 盤面にたまたまその字が並んでいると、正しくなぞったのに不正解になります。
 *
 * 直し方は2つです。
 *   1. 答えが一意に決まるなら、**問題文を直す**（「どれですか?」→「何ですか?」）
 *   2. 条件を満たすものが複数あるなら、**その方式に回さない**
 *      （`reading` を外して消去法へ落とすか、`hardMode` で指定する）
 */
{
  const NEEDS_LIST =
    /どれ|次のうち|正しいもの|適切なの|あてはまるもの|ふくまれない|含まれない|誤っているもの/;
  for (const q of questions) {
    let mode = answerMode(q);
    if (mode === "panel" && !panelLayout(q.reading, q.id)) mode = "elimination";
    if (hintGroup(mode) !== "hidden") continue;
    const hit = String(q.prompt || "").match(NEEDS_LIST);
    if (hit)
      err(q.id, `${MODE_LABEL_V[mode] || mode} は選択肢を出さないのに、問題文が選択肢を前提にしています` +
                `（「${hit[0]}」）: ${q.prompt}`);
  }
}

/* ---- 形式ごとの段（Lv.1〜Lv.3）---- */
/**
 * **学年は「どの教育課程の問題か」、段は「同じ学年の中でどれだけ踏みこむか」。**
 * 別の軸なので、どちらか一方だけでは難易度の梯子になりません。
 *
 * 目安：
 *   Lv.1 … 用語と定義が1対1。基本の計算。教科書の見出しに出る語をそのまま問う
 *   Lv.2 … 似たものを見分ける。条件がひとつ付く。公式を当てはめる
 *   Lv.3 … 複数の知識を結ぶ。理由・例外・境界を問う。逆向きに問う
 *
 * 出題は**形式ごとの束**で組むので、在庫は 形式 × 段 で見ます。
 * ここが空だと、その段に上がった人の束が組めません。
 */
{
  for (const q of questions) {
    if (q.level === undefined) continue;
    if (!Number.isInteger(q.level) || q.level < 1 || q.level > MAX_LEVEL)
      err(q.id, `level は 1〜${MAX_LEVEL} の整数にしてください（いま ${JSON.stringify(q.level)}）`);
  }

  const grid = {};
  questions.forEach(q => {
    const m = answerMode(q);
    (grid[m] ??= {})[levelOf(q)] = (grid[m][levelOf(q)] || 0) + 1;
  });
  const rows = [];
  for (const [m, d] of Object.entries(grid)) {
    const row = { 形式: MODE_LABEL_V[m] || m, 束: blockSize(m) };
    let total = 0;
    for (let l = 1; l <= MAX_LEVEL; l++) { row[`Lv.${l}`] = d[l] || 0; total += d[l] || 0; }
    row.計 = total;
    rows.push(row);
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const n = d[l] || 0;
      // **その段に上がった人は、その形式の束をこの段から組みます。**
      // 束1つぶん無いと、すぐ下の段に落ちて段が意味を失う
      /* **Lv.1 が空なのは壊れています。**みんなそこから始まるので、
         その形式の束が最初から組めません。上の段が空なのは、**梯子がまだ短いだけ**
         （`engine.rankPool` が一段ずつ下りて拾うので、出題は成立します）*/
      if (n === 0 && l === 1) err("段", `${MODE_LABEL_V[m] || m} に Lv.1 の問題がありません`);
      else if (n === 0)
        warn(`${MODE_LABEL_V[m] || m} に Lv.${l} の問題がありません（そこまで梯子が伸びていません）`);
      else if (n < blockSize(m))
        warn(`${MODE_LABEL_V[m] || m} の Lv.${l} は ${n}問しかありません（1束 ${blockSize(m)}問）`);
    }
  }
  console.log("\n形式 × 段の在庫");
  console.table(rows);

  // マス（教科×学年）の中に段の差があるか。無いと「同じ学年の中の梯子」にならない
  const cellLv = {};
  questions.forEach(q => {
    const k = q.subject + "|" + q.grade;
    (cellLv[k] ??= new Set()).add(levelOf(q));
  });
  const flat = Object.entries(cellLv).filter(([, set]) => set.size < 2).map(([k]) => k);
  if (flat.length)
    warn(`段が1つしか無いマスが ${flat.length}あります（同じ学年の中の梯子になりません）: ` +
         flat.slice(0, 8).join(" / ") + (flat.length > 8 ? " ほか" : ""));
}

/* ---- スワイプ（2択・テンポ優先）---- */
/**
 * **スワイプは、写真1枚と2択だけで成り立たせます。**
 *
 * 途中に解説もヒントも挟まないので、画面に出るのは「問い・写真・左右の答え」だけ。
 * そこに入り込む抜け道を3つ塞ぎます。
 *
 * 1. **題名から答えが割れないか。** コモンズの題名は被写体の名前そのものです
 *    （"Dmitri Mendeleev 1890s"）。PD と CC0 は表示義務が無いので出題中は題名を
 *    伏せられますが、CC BY は作者・ライセンス・出典に加えて題名も出すのが条件なので
 *    伏せられません。**CC BY を使うなら、題名を見ても答えにならない問いにしてください**
 * 2. **alt から答えが割れないか。** 台帳の alt は被写体を名指ししているので、
 *    スワイプでは問題ごとに書き直した alt を使います
 * 3. **左右の偏り。** いつも同じ側が正解だと、読まずに払えてしまいます
 */
{
  const swipes = questions.filter(q => (q.format || "choice") === "swipe");
  const titleFree = p => /^(public domain|pdm|cc0)/i.test(p?.license || "");

  for (const q of swipes) {
    const id = q.id;
    if (Array.isArray(q.choices) && q.choices.length !== 2)
      err(id, `スワイプは2択にしてください（いま ${q.choices.length}つ）`);
    for (const k of ["hints", "tip", "applied", "reading", "accept", "hardMode", "imageAt", "figure", "needs"]) {
      if (q[k] !== undefined && q[k] !== null)
        err(id, `スワイプに ${k} は置けません（途中で何も挟まない形式です）`);
    }
    const p = imageBook.images?.[q.image];
    if (p && !titleFree(p))
      warn(`${id}: 写真「${q.image}」は ${p.license} なので、出題中も題名「${p.title}」が出ます。` +
           `題名から答えが割れないか確かめてください`);
    // alt が答えをそのまま言っていないか。写真の説明で答えを配ってしまうと 2択が消える
    const alt = squash(q.alt || "");
    (q.choices || []).forEach((c, i) => {
      const t = squash(c);
      if (t.length >= 2 && alt.includes(t))
        err(id, `alt が選択肢「${c}」をそのまま含んでいます: ${q.alt}`);
    });
    if (String(q.prompt || "").length > 30)
      warn(`${id}: スワイプの問いが ${q.prompt.length}文字あります。短いほうがテンポに乗ります`);
  }

  // 左右の偏り
  if (swipes.length >= 10) {
    const d = [0, 0];
    swipes.forEach(q => { if (q.answer === 0 || q.answer === 1) d[q.answer]++; });
    const top = Math.max(...d);
    if (top / swipes.length > 0.7)
      err("スワイプ", `正解が ${(top / swipes.length * 100).toFixed(0)}% 同じ側に寄っています（左 ${d[0]} / 右 ${d[1]}）`);
  }

  /* **最初から遊べるか。** 第3章（世界）は英雄の解放で開くので、
     開いていない状態でも1セッションぶん（10問）そろっているかを見る */
  const openNow = swipes.filter(q => q.chapter <= 1).length;
  if (swipes.length && openNow < RUN_LENGTH)
    warn(`スワイプの在庫が、解放前の範囲では ${openNow}問しかありません（1セッション ${RUN_LENGTH}問）`);
  if (swipes.length) {
    const bySub = {};
    swipes.forEach(q => { bySub[q.subject] = (bySub[q.subject] || 0) + 1; });
    console.log(`\nスワイプ ・ 全${swipes.length}問（解放前 ${openNow}問） ・ ` +
      Object.entries(bySub).map(([k, v]) => `${k} ${v}`).join(" / "));
  }
}

/* ---- 写真の台帳 ---- */
/* **台帳に載っていない webp が転がっていないか。**
   `git reset --hard` は追跡されていないファイルを消さないので、取り込んだあとに
   走らせると「画像だけ残り、作者もライセンスも台帳から消えた」状態になります。
   クレジットを出せないので、その写真は永久に使えません。 */
{
  const known = new Set(Object.values(imageBook.images || {})
    .filter(p => p.file).map(p => p.file + ".webp"));
  let orphans = [];
  try {
    orphans = (await readdir(join(ROOT, "public/commons")))
      .filter(f => f.endsWith(".webp") && !known.has(f));
  } catch { /* ディレクトリが無ければ何もしない */ }
  if (orphans.length)
    warn(`台帳に載っていない写真が public/commons にあります（作者もライセンスも` +
         `分からないので使えません）: ${orphans.join(" / ")}`);
}

// 使い先を書いたまま配線し忘れると、取り込んだ写真が誰の目にも触れない
const usedPhotos = new Set(questions.filter(q => q.image).map(q => q.image));
for (const [key, p] of Object.entries(imageBook.images || {})) {
  if (p.use && p.file && !usedPhotos.has(key))
    warn(`写真「${key}」は取り込み済みですが、どの問題からも参照されていません（使い先: ${p.use}）`);
  if (p.file && !existsSync(join(ROOT, "public/commons", p.file + ".webp")))
    warn(`写真「${key}」の実体がありません: public/commons/${p.file}.webp`);
}

/* ---- 英雄 ---- */
const heroIds = new Set();
for (const h of heroes) {
  if (heroIds.has(h.id)) err(h.id, "英雄IDが重複しています");
  heroIds.add(h.id);
  if (h.ch) {
    const CH_NEED = { Common: 1, Uncommon: 1, Rare: 2, Epic: 2, Legendary: 3 };
    if (!Array.isArray(h.ch.qs) || h.ch.qs.length !== 3)
      err(h.name, `チャレンジは3問構成にしてください（いま ${h.ch.qs?.length ?? 0}問）`);
    (h.ch.qs || []).forEach((q, i) => {
      const at = `${h.name} 第${i + 1}問`;
      if (!Array.isArray(q.v) || q.v.length !== 4) err(at, "問い方は4段階必要です");
      else {
        // 段階が進むほどやさしくなるように、v は難しい順に並べる。
        // 目安として、後ろほど長いか同じくらいの説明が付いているはず
        if (q.v.some(t => typeof t !== "string" || !t.trim())) err(at, "空の問い方があります");
        if (new Set(q.v).size !== q.v.length) err(at, "同じ問い方が重複しています");
      }
      if (!Array.isArray(q.ans) || q.ans.length === 0) err(at, "受理解答がありません");
      else if (q.ans.some(a => typeof a !== "string" || !a.trim())) err(at, "空の受理解答があります");
      // 問い方の中に答えがそのまま入っていないか
      (q.v || []).forEach((t, k) => {
        const bare = String(q.ans[0]).replace(/[\s。、]/g, "");
        if (bare.length >= 2 && String(t).replace(/[\s。、]/g, "").includes(bare))
          warn(`${at} 段階${k}: 問い方に答え「${q.ans[0]}」がそのまま入っています`);
      });
    });
    if (!CH_NEED[h.rarity]) err(h.name, `レアリティ "${h.rarity}" の必要正答数が決まっていません`);
  }
  if (h.rel) {
    h.rel.subjects.forEach(s => {
      if (!SUBJECTS.includes(s)) err(h.name, `未知の関連教科 "${s}"`);
    });
    h.rel.cards.forEach(c => {
      if (!questions.some(q => q.card === c))
        err(h.name, `関連カード "${c}" に対応する問題がありません`);
    });
  }
}

/* ---- エクステンション ---- */
const extensions = buildExtensions(curated, crystals);

/**
 * 台帳（data/extensions-curated.json）に書くのは由来が参照できる事実だけで、
 * ゲージ寄与・クリスタルの要求・知識カードの条件は data.js が導きます。
 * ここで見るのは台帳のほうと、導いた結果が破綻していないかの両方です。
 */
const RANKS = ["初伝", "中伝", "奥伝"];
const extIds = new Set();
for (const e of curated) {
  const k = e.id || "(id未設定)";
  if (extIds.has(e.id)) err(k, "エクステンションIDが重複しています");
  extIds.add(e.id);
  for (const f of ["id", "name", "series", "rank", "subjects", "origin"]) {
    if (e[f] === undefined || e[f] === null || e[f] === "") err(k, `必須項目 ${f} がありません`);
  }
  if (!RANKS.includes(e.rank)) err(k, `未知のランク "${e.rank}"`);
  (e.subjects || []).forEach(x => { if (!SUBJECTS.includes(x)) err(k, `未知の分野 "${x}"`); });
  if (!(e.subjects || []).length) err(k, "subjects が空です");
  if (new Set(e.subjects).size !== (e.subjects || []).length) err(k, "subjects に同じ教科が2回あります");

  // **ランクは、由来がいくつの教科にまたがるかで決まる。** ここがずれると、
  // 「越境しているものほど上」というランクの意味が崩れる
  const n = new Set(e.subjects || []).size;
  const want = n >= 3 ? "奥伝" : n === 2 ? "中伝" : "初伝";
  if (e.rank !== want)
    err(k, `ランクが教科数と合いません（${n}教科なら ${want}、いまは ${e.rank}）`);

  if (e.upgrade && (!e.upgrade.id || !e.upgrade.name)) err(k, "upgrade は id と name の両方が要ります");

  /**
   * **由来カードは、奥伝だけが持ちます。** その品の元になった人物や出来事の問題を
   * 解くと手に入るので、対応する問題がDBに1つだけ実在していなければなりません。
   * 無いと、その品は永久に作れなくなります。
   */
  if (e.originCard) {
    if (e.rank !== "奥伝") err(k, `由来カードは奥伝だけです（いまは ${e.rank}）`);
    const src = questions.filter(x => x.card === e.originCard);
    if (!src.length) err(k, `由来カード "${e.originCard}" を配る問題がありません`);
    else if (src.length > 1)
      err(k, `由来カード "${e.originCard}" を配る問題が ${src.length}問あります（1問にしてください）`);
    else if (src[0].needs)
      err(k, `由来カードを配る問題 ${src[0].id} 自身が needs で閉じています（たどり着けません）`);
  } else if (e.rank === "奥伝") {
    err(k, "奥伝には originCard が要ります（素材と教科の広さだけでは作れないようにするため）");
  }
  if (!existsSync(join(ROOT, `public/extensions/${e.id}.webp`)))
    err(k, "画像が public/extensions にありません");
}

/* 導いた結果のほう。釣り合いは data.js が決めるので、壊れていないかだけ見る */
for (const [k, e] of Object.entries(extensions)) {
  const fams = crystals.families || [];
  const keys = Object.keys(e.crystals || {});
  if (!keys.length) err(k, "クリスタルの要求が空です");
  const want = new Set(e.subs.map(x => crystals.subjectToFamily?.[x]));
  keys.forEach(f => {
    if (!fams.includes(f)) err(k, `未知の族 "${f}"`);
    if (!want.has(f)) err(k, `族 "${f}" は、この品の分野（${e.subs.join("・")}）と噛み合いません`);
    if (!Number.isInteger(e.crystals[f]) || e.crystals[f] <= 0)
      err(k, `${f} のポイントが正の整数ではありません (${e.crystals[f]})`);
  });
  // **知識カードは、またがる教科すべてで要る。** 1つでも抜けると素材だけで作れてしまう
  const cardSubs = Object.keys(e.cards || {});
  if (cardSubs.length !== e.subs.length || !e.subs.every(x => cardSubs.includes(x)))
    err(k, `知識カードの条件が分野とそろっていません（分野 ${e.subs.join("・")} / 条件 ${cardSubs.join("・")}）`);
  cardSubs.forEach(x => {
    if (!Number.isInteger(e.cards[x]) || e.cards[x] <= 0) err(k, `${x} の必要枚数がおかしい (${e.cards[x]})`);
    // その教科に、条件を満たせるだけのカードが実在するか
    const stockCards = new Set(questions.filter(q => q.subject === x).map(q => q.card)).size;
    if (stockCards < e.cards[x])
      err(k, `${x} の知識カードは ${stockCards}種しかなく、条件の ${e.cards[x]}枚に届きません`);
  });
  if (!(e.gauge > 0)) err(k, `ゲージ寄与がおかしい (${e.gauge})`);
}

// upgrade の指す先は、台帳にあってもなくてもよい（「真・」は未実装）。
// ただし台帳にあるなら、由来は同じでなければならない
for (const e of curated) {
  const up = e.upgrade && curated.find(x => x.id === e.upgrade.id);
  if (up && up.rank !== e.rank)
    err(e.id, `上位 "${up.name}" のランクが違います（${up.rank} / ${e.rank}）`);
}

const byRank = {};
for (const e of curated) (byRank[e.rank] ??= []).push(e);
RANKS.forEach(r => { if (!byRank[r]?.length) err("extensions", `ランク "${r}" の品がありません`); });

/* ---- 長音符（JIS Z 8301・2019年改正）---- */
/**
 * **英語の -er / -or / -ar 由来のカタカナ語は、語尾に長音符を付けます。**
 * 2019年の JIS Z 8301 改正で、原則つけると改められました。それ以前は3音以上の語で
 * 省くとされていて、古い表記が混ざります。**混ざっていること自体が読み手の負担**なので、
 * DBの中では揃えます。省いた形も誤りではないので、答えになる語は `accept` で受け、
 * なぜ両方正しいかを `note` に書きます。
 *
 * メモリー（-ory）やソフトウェア（-ware）は別の決まりなので、ここには入れません。
 */
const LONG_VOWEL = ["コンピュータ", "センサ", "サーバ", "ブラウザ", "プリンタ", "ルータ",
  "アクチュエータ", "パラメータ", "モニタ", "ユーザ", "フォルダ", "ドライバ", "スキャナ",
  "プロセッサ", "モータ", "コンデンサ", "トランジスタ", "タイマ", "カウンタ", "スピーカ",
  "アダプタ", "エディタ", "コネクタ", "レーザ"];
{
  const bare = new RegExp("(" + LONG_VOWEL.join("|") + ")(?!ー)", "g");
  for (const q of questions) {
    // accept と note は、短い形をわざと引き合いに出す欄なので見ない
    const { accept, note, ...rest } = q;
    const hit = JSON.stringify(rest).match(bare);
    if (hit) err(q.id, `語尾の長音符が抜けています: ${[...new Set(hit)].join("・")}（JIS Z 8301）`);
  }
}

/* ---- 別表記（accept）と注釈（note）---- */
for (const q of questions) {
  if (q.accept !== undefined) {
    if (!Array.isArray(q.accept) || !q.accept.length) err(q.id, "accept は空でない配列にしてください");
    else {
      if (!q.reading) err(q.id, "accept は文字パネル（reading のある問題）でだけ効きます");
      q.accept.forEach(a => {
        if (typeof a !== "string" || !a) err(q.id, "accept の中身が文字列ではありません");
        else if (a === q.reading) err(q.id, `accept "${a}" が reading と同じです`);
        else if ([...a].some(c => ![...(q.reading || "")].includes(c)))
          err(q.id, `accept "${a}" に、盤面（reading）に無い文字が入っています`);
      });
    }
    // **別表記を受けるなら、なぜ両方正しいかを注釈で言う。** 黙って通すと、
    // 片方が誤りだと思ったまま終わる
    if (!q.note) err(q.id, "accept を置くなら note で理由を書いてください");
  }
  if (q.note !== undefined && (typeof q.note !== "string" || !q.note.trim()))
    err(q.id, "note が空です");
}

/* ---- 正解の位置 ---- */
/**
 * **正解がいつも同じ位置にあると、読まずに当てられます。**
 * 一度、4択482問のうち92.7%が先頭でした。書いていると自然に「正解を先に書いて、
 * あとから誤答を足す」形になるので、放っておくと必ずこうなります。
 * 選択肢の並べ替えは問題IDから決まる（scripts のワンショット）ので、
 * 足した問題もここで引っかかります。
 */
{
  const tally = (list, pick) => {
    const d = [0, 0, 0, 0];
    list.forEach(x => { const i = pick(x); if (i >= 0 && i < 4) d[i]++; });
    return d;
  };
  const report = (label, d, total, limit) => {
    const top = Math.max(...d);
    const line = d.map((n, i) => `${i + 1}番目 ${n}`).join(" / ");
    if (total >= 40 && top / total > limit)
      err("選択肢", `${label}の正解が ${(top / total * 100).toFixed(1)}% 同じ位置に寄っています（${line}）`);
    return line;
  };
  const ch = questions.filter(q => (q.format || "choice") === "choice" && q.choices);
  const ap = questions.filter(q => q.applied?.choices);
  const dAll = tally(ch, q => q.answer);
  report("4択", dAll, ch.length, 0.35);
  report("応用編", tally(ap, q => q.applied.answer), ap.length, 0.45);
  SUBJECTS.forEach(sub => {
    const list = ch.filter(q => q.subject === sub);
    report(`4択（${sub}）`, tally(list, q => q.answer), list.length, 0.45);
  });
  console.log("\n4択の正解の位置 ・ " + dAll.map((n, i) =>
    `${i + 1}番目 ${n}(${(n / ch.length * 100).toFixed(0)}%)`).join(" / "));
}

/* ---- 報酬が開く問い（needs）---- */
{
  const cards = new Set(questions.map(q => q.card));
  const gated = questions.filter(q => q.needs);
  gated.forEach(q => {
    if (!cards.has(q.needs)) err(q.id, `needs "${q.needs}" を配る問題がありません`);
    if (q.card === q.needs) err(q.id, "自分が配るカードで自分を閉じています");
  });
  // 鍵になる問題が、それ自身 needs で閉じていると永久に開かない
  const keyOf = c => questions.find(q => q.card === c);
  gated.forEach(q => {
    const seen = new Set([q.id]);
    let cur = keyOf(q.needs);
    while (cur && cur.needs) {
      if (seen.has(cur.id)) { err(q.id, "needs が輪になっています"); break; }
      seen.add(cur.id);
      cur = keyOf(cur.needs);
    }
  });
  const byKey = {};
  gated.forEach(q => (byKey[q.needs] ??= []).push(q.id));
  if (gated.length) console.log("\n報酬が開く問い ・ " +
    Object.entries(byKey).map(([c, ids]) => `${c} → ${ids.length}問`).join(" / "));
}

/* ---- クリスタル ---- */
const FAMILIES = crystals.families || [];
if (FAMILIES.length !== 6) err("crystals.json", `families は6族にしてください（いまは${FAMILIES.length}）`);
// 教科 ↔ 族 は1対1。どちらかが欠けると、その教科を解いても貯まらない族ができる
{
  const map = crystals.subjectToFamily || {};
  SUBJECTS.forEach(s => {
    if (!map[s]) err("crystals.json", `教科 "${s}" に対応する族がありません`);
    else if (!FAMILIES.includes(map[s])) err("crystals.json", `未知の族 "${map[s]}"（${s}）`);
  });
  const used = Object.values(map);
  if (new Set(used).size !== used.length)
    err("crystals.json", "教科と族が1対1になっていません（同じ族が2教科に付いています）");
  FAMILIES.filter(f => !used.includes(f))
    .forEach(f => err("crystals.json", `族 "${f}" に対応する教科がありません`));
}
const crystalIds = new Set();
for (const c of crystals.crystals || []) {
  const id = c.id || "(id未設定)";
  if (crystalIds.has(c.id)) err(id, "クリスタルIDが重複しています");
  crystalIds.add(c.id);
  if (!/^\d{3}$/.test(String(c.id))) err(id, "IDは3桁の数字にしてください");
  for (const k of ["name", "en", "family", "scarcity", "fact"]) {
    if (c[k] === undefined || c[k] === null || c[k] === "") err(id, `必須項目 ${k} がありません`);
  }
  if (!FAMILIES.includes(c.family)) err(id, `未知の族 "${c.family}"`);
  if (typeof c.scarcity !== "number" || !(c.scarcity > 0) || c.scarcity > 100)
    err(id, `希少度が 0〜100% の範囲にありません (${c.scarcity})`);
  // 図鑑のアートが取れているか
  if (!existsSync(join(ROOT, `public/materials/crystals/${c.id}.webp`)))
    err(id, "アートが public/materials/crystals にありません");
}

// 族が空だと、その族を要求するレシピが永久に満たせなくなる
{
  const n = {};
  (crystals.crystals || []).forEach(c => { n[c.family] = (n[c.family] || 0) + 1; });
  FAMILIES.forEach(f => { if (!n[f]) err("crystals.json", `族 "${f}" に鉱物が1つもありません`); });
  console.log("\n族ごとの鉱物 ・ " + FAMILIES.map(f =>
    `${f} ${n[f] || 0}種（${crystals.subjectToFamily
      ? Object.entries(crystals.subjectToFamily).find(([, v]) => v === f)?.[0] ?? "-" : "-"}）`).join(" / "));
}

/* ---- 在庫（同じ問題が繰り返し出る原因になる） ---- */
/* **スワイプはふつうのセッションに出てこないので、マス目の数には入れません。**
   入れると、表の数字と実際に出題される数がずれます（engine.inventory が分けています）*/
const normal = questions.filter(q => (q.format || "choice") !== "swipe");
const stock = (band, subject) => normal.filter(q =>
  (band === "auto" || BANDS[band].includes(q.grade)) &&
  (subject === "auto" || q.subject === subject)).length;

const GRADE_LABEL = { e1: "小1", e2: "小2", e3: "小3", e4: "小4", e5: "小5", e6: "小6",
                      j1: "中1", j2: "中2", j3: "中3", w: "世界" };
const cell = {};
normal.forEach(q => { cell[q.subject + "|" + q.grade] = (cell[q.subject + "|" + q.grade] || 0) + 1; });

/* 教科 × 学年のマス目。「−」はカリキュラムに存在しない組み合わせ */
const table = [];
let realCells = 0, emptyCells = 0, thinCells = 0;
for (const s of SUBJECTS) {
  const shape = curriculum.exists[s] || GRADES;
  const row = { 教科: s };
  for (const g of GRADES) {
    if (!shape.includes(g)) { row[GRADE_LABEL[g]] = "−"; continue; }
    realCells++;
    const n = cell[s + "|" + g] || 0;
    if (n === 0) emptyCells++;
    // 1マスが1セッションぶんに満たないと、その学年を選んだ人の体験が薄いまま終わる
    else if (n < RUN_LENGTH) thinCells++;
    row[GRADE_LABEL[g]] = n || "・";
  }
  row.計 = stock("auto", s);
  table.push(row);
  if (row.計 > 0 && row.計 < RUN_LENGTH)
    warn(`在庫不足: ${s} は ${row.計}問しかありません（1セッション ${RUN_LENGTH}問）`);
  if (row.計 === 0) warn(`在庫ゼロ: ${s} に問題がありません`);
}
for (const s of SUBJECTS) {
  const shape = curriculum.exists[s] || GRADES;
  const holes = shape.filter(g => !(cell[s + "|" + g] || 0)).map(g => GRADE_LABEL[g]);
  if (holes.length) warn(`空きマス: ${s} の ${holes.join("・")} に問題がありません`);
  const thin = shape.filter(g => {
    const n = cell[s + "|" + g] || 0;
    return n > 0 && n < RUN_LENGTH;
  }).map(g => `${GRADE_LABEL[g]}(${cell[s + "|" + g]})`);
  if (thin.length) warn(`1セッションに満たないマス: ${s} の ${thin.join("・")}`);
}

/* ---- 出力 ---- */
console.log(`\n問題 ${questions.length}問（うちスワイプ ${questions.length - normal.length}問） / 英雄 ${heroes.length}体 / エクステンション ${curated.length}種（${
  RANKS.map(r => `${r}${byRank[r].length}`).join("・")}） / クリスタル ${(crystals.crystals || []).length}種\n`);
console.table(table);
console.log(`実在マス ${realCells} ・ 空き ${emptyCells} ・ ${RUN_LENGTH}問未満 ${thinCells}` +
  `　（「−」はカリキュラムに無い組み合わせ）`);

/* 難モードの内訳。reading を足すほど消去法から文字パネルへ移る */
const MODE_LABEL = MODE_LABEL_V;
const modeTally = {};
questions.forEach(q => { const m = answerMode(q); modeTally[m] = (modeTally[m] || 0) + 1; });
const JA_ANSWER = /^[ぁ-んァ-ヶ一-龥ー]{2,12}$/;
const panelReady = questions.filter(q =>
  answerMode(q) === "elimination" && JA_ANSWER.test(answerText(q).trim())).length;
console.log("難モードの内訳 ・ " +
  Object.entries(modeTally).sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${MODE_LABEL[m] || m} ${n}`).join(" / ") +
  `　（reading を足せば文字パネルに回せる候補 ${panelReady}問）`);

if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  warnings.forEach(w => console.log("  - " + w));
}
if (errors.length) {
  console.log(`\n✗ エラー ${errors.length}件`);
  errors.forEach(e => console.log("  - " + e));
  process.exit(1);
}
console.log("\n✓ 検証を通過しました\n");
