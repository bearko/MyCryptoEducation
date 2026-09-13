import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync("dist/index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const w = dom.window, d = w.document;
const errs = [];
w.addEventListener("error", e => errs.push(e.message));
const ev = s => w.eval(s);
const txt = () => d.getElementById("app").textContent.replace(/\s+/g, " ");
const wait = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
const check = (name, cond, extra = "") => {
  console.log((cond ? "✓ " : "✗ ") + name + (cond ? "" : "  ← " + extra));
  if (!cond) failed++;
};

await wait(200);
check("起動", !!d.getElementById("toquiz"), txt().slice(0, 60));

/* ---- UI基盤: 1画面完結レイアウト ---- */
check("ホームは3層", d.querySelectorAll("#app.home > .layer").length === 3,
  `${d.querySelectorAll("#app > *").length}要素`);
check("ステータス層にマイちゃんの助言", (d.getElementById("advice")?.textContent || "").length > 5,
  d.getElementById("advice")?.textContent);
check("助言は吹き出しに入る", d.getElementById("advice").classList.contains("bubble"));
check("背景はホーム全体に敷く", !!d.querySelector("#app.home > .home-bg") && !d.querySelector(".stage-bg"));
check("ユーザーアイコンが出る", !!d.querySelector(".st-ava"));
check("称号の枠がある", !!d.querySelector(".st-title"), txt().slice(0, 60));
check("ユーザー名の枠がある", d.querySelector(".st-name").textContent.trim() === "旅人",
  d.querySelector(".st-name")?.textContent);
check("GUMの所持数はホームに出さない", (() => {
  ev("S.gum=999999;render()");
  const ok = !d.querySelector(".st-gum") && !/999,999/.test(txt());
  ev("S.gum=0;render()");
  return ok;
})(), txt().slice(0, 120));
check("一等地は知識マップに渡した", (() => {
  const el = d.getElementById("tomap");
  return !!el && /知識 \d+\/\d+/.test(el.textContent) && !!el.querySelector(".mp-bar i");
})(), d.getElementById("tomap")?.textContent);
check("GUMはショップ画面で桁区切りで出す", (() => {
  ev("S.gum=999999;go('shop')");
  const ok = txt().includes("999,999");
  ev("S.gum=0;go('home')");
  return ok;
})());
check("知識マップはホームから1タップで開く", (() => {
  d.getElementById("tomap").click();
  const ok = txt().includes("どこまで来たか") && !!d.querySelector("table.map");
  ev('go("home")');
  return ok;
})(), txt().slice(0, 80));
check("電池はAPIが無い環境では隠す", d.getElementById("batt").hidden);
check("ユーザー名は255文字まで", ev('capName("あ".repeat(400)).length') === 255,
  String(ev('capName("あ".repeat(400)).length')));
check("長い名前でも1行に収める", (() => {
  ev('S.profile.name="あ".repeat(120);render()');
  const el = d.querySelector(".st-name");
  const ok = el.textContent.length === 120;
  ev('S.profile.name="旅人";render()');
  return ok;
})());
check("ナビが4枠そろっている",
  ["toheroes", "toshop", "tocraft", "toquiz"].every(id => !!d.getElementById(id)));
check("ショップは押せる", !d.getElementById("toshop").disabled);
check("挑戦ボタンは主役層にある", !!d.querySelector(".layer-stage #tochal"));
check("挑戦ボタンは文字だけ", d.getElementById("tochal").textContent.trim() === "挑戦",
  d.getElementById("tochal").textContent.trim());
check("挑む相手はボタンの外に大きく出る", !!d.querySelector(".layer-stage .tv-figure img"));
check("相手の名前とレアリティはアートと組で出る",
  /Common/.test(d.querySelector(".tv-name").textContent) &&
  d.querySelector(".tv-name").textContent.includes("ピタゴラス"),
  d.querySelector(".tv-name")?.textContent);
check("削れ具合はホームに出さない", !/削れ/.test(txt()), txt().slice(0, 160));

// カルーセルは自動送り。矢印は置かず、末尾に先頭のクローンを1枚足して繋ぐ
const lockedN = ev("lockedHeroes(DB,S).length");
check("矢印は置かない", !d.getElementById("nexthero") && !d.getElementById("prevhero"));
check("カルーセルのドットが未解放ぶんある",
  d.querySelectorAll(".tv-dots i").length === lockedN,
  `${d.querySelectorAll(".tv-dots i").length}個`);
check("トラックはクローン1枚ぶん多い",
  d.querySelectorAll("#tvtrack .tv-figure").length === lockedN + 1,
  `${d.querySelectorAll("#tvtrack .tv-figure").length}枚 / 未解放 ${lockedN}体`);
check("末尾のクローンは先頭と同じ絵", (() => {
  const f = [...d.querySelectorAll("#tvtrack .tv-figure img")];
  return f[0].getAttribute("src") === f[f.length - 1].getAttribute("src");
})());
check("巡回インデックスは端で回り込む",
  ev("nextIndex(8,9,1)") === 0 && ev("nextIndex(0,9,-1)") === 8 && ev("nextIndex(3,9,1)") === 4,
  `${ev("nextIndex(8,9,1)")} / ${ev("nextIndex(0,9,-1)")}`);
check("ナビのアイコンはラベルと分けて重ねる",
  d.querySelectorAll(".nav3 .tile .lab b").length === 3,
  `${d.querySelectorAll(".nav3 .tile .lab b").length}件`);
check("ホームから素材・カード枚数・英雄一覧を外した",
  !txt().includes("手持ちの英雄") && !d.querySelector(".fams"), txt().slice(0, 120));

// クラフトの通知ドットは、素材が足りているときだけ出す
check("素材0なら通知ドットなし", !d.querySelector("#tocraft .dot"));
const keptPoints = ev("JSON.stringify(S.points)");
ev(`S.points=Object.fromEntries(DB.families.map(f => [f, 9999]));render()`);
check("クラフトできると通知ドット", !!d.querySelector("#tocraft .dot"));
ev(`S.points=${keptPoints};render()`);

// 英雄詳細と図鑑への入口は、ホームからヒーロー画面へ移した
d.getElementById("toheroes").click();
check("ヒーロー画面の手持ちタブ", txt().includes("手持ちの英雄"), txt().slice(0, 80));
[...d.querySelectorAll("#htab button")].find(b => b.dataset.t === "codex").click();
check("図鑑タブに知識マップ", txt().includes("知識マップ"), txt().slice(0, 80));
d.getElementById("back").click();
check("ホームへ戻れる", !!d.getElementById("toquiz"));

/* ---- 修正1: 重複しない出題 ---- */
d.getElementById("toquiz").click();
check("ホーム以外は方眼紙のまま", !d.getElementById("app").classList.contains("home"));
// 開始時は第3・4章が未解放。期待値は問題データから出す（問題を足すたびに直さないため）
const openStock = ev("inventory(DB,S,'auto','auto').length");
check("在庫バッジが出ている", new RegExp(`おまかせ\\s*${openStock}`).test(txt()),
  `在庫 ${openStock} / ${txt().slice(0, 120)}`);
check("未解放ぶんは在庫から外れる", openStock < ev("DB.questions.length"),
  `${openStock} / 全 ${ev("DB.questions.length")}問`);
check("未解放の教科は選べない",
  [...d.querySelectorAll("#sub button")].find(b => b.dataset.k === "情報").disabled);

// 在庫が1セッションぶんに満たない範囲での挙動を見る。以前はここで同じ問題が繰り返し出ていた。
// 問題を足すと薄い範囲は無くなるので、検査のあいだだけ在庫を削って作り、あとで戻す
const THIN_BAND = "e", THIN_SUB = "国語", THIN_N = 4;
const thin = ev(`(() => {
  window.__allQs = DB.questions;
  const pool = inventory(DB, S, "${THIN_BAND}", "${THIN_SUB}");
  if (pool.length <= ${THIN_N}) return "null";
  const drop = new Set(pool.slice(${THIN_N}).map(q => q.id));
  DB.questions = DB.questions.filter(q => !drop.has(q.id));
  render();
  return JSON.stringify({ n: inventory(DB, S, "${THIN_BAND}", "${THIN_SUB}").length });
})()`);
check("薄い在庫を作れた（この検査の前提）", thin !== "null" && JSON.parse(thin).n === THIN_N, thin);
const thinBand = THIN_BAND, thinSub = THIN_SUB, thinN = THIN_N;
// 学年帯を選び直すと教科は「おまかせ」に戻るので、帯を先に押す
[...d.querySelectorAll("#band button")].find(b => b.dataset.k === thinBand).click();
[...d.querySelectorAll("#sub button")].find(b => b.dataset.k === thinSub).click();
check("在庫不足の警告", txt().includes(`この範囲は現在 ${thinN}問です`),
  `${thinSub} ${thinN}問 / ${txt().slice(0, 160)}`);
check("開始ボタンが問題数に追従",
  d.getElementById("start").textContent.includes(`${thinN}問を始める`),
  d.getElementById("start").textContent);

d.getElementById("start").click();
const ids = ev("JSON.stringify(S.run.ids)");
const arr = JSON.parse(ids);
check("在庫ぶんだけ出す（旧: 同じ問題が繰り返し出ていた）", arr.length === thinN,
  `${arr.length}問 / 在庫 ${thinN}問`);
check("同じ問題が出ない", new Set(arr).size === arr.length, ids);

// 削った在庫を戻す
ev('DB.questions = window.__allQs; render();');

// おまかせで10問
ev('S.view="select";S.select.band="auto";S.select.subject="auto";render()');
d.getElementById("start").click();
const arr2 = JSON.parse(ev("JSON.stringify(S.run.ids)"));
check("おまかせは10問", arr2.length === 10);
check("10問すべて別問題", new Set(arr2).size === 10);
check("最後は越境問題", ev(`DB.byId["${arr2[9]}"].chapter`) >= 2 ||
  ["j3", "w"].includes(ev(`DB.byId["${arr2[9]}"].grade`)),
  ev(`DB.byId["${arr2[9]}"].gradeLabel + " ch" + DB.byId["${arr2[9]}"].chapter`));

/* 20セッション連続で重複が出ないか */
let dup = 0;
for (let i = 0; i < 20; i++) {
  ev('S.view="select";render()'); d.getElementById("start").click();
  const a = JSON.parse(ev("JSON.stringify(S.run.ids)"));
  if (new Set(a).size !== a.length) dup++;
}
check("20セッション連続で重複ゼロ", dup === 0, `${dup}件`);

/* 難モードが既定になったので、答えるときは方式に合わせる。
   消去法なら違うものを潰し、4択ならそのまま押す（experience-design-framework の決定2・決定4） */
// 判定を写すとズレるので、アプリが使っている modeOf をそのまま呼ぶ
const modeNow = () => ev(`modeOf(DB.byId[S.run.ids[S.run.i]])`);
const answerNow = (correct = true) => {
  const a = ev("DB.byId[S.run.ids[S.run.i]].answer");
  const n = ev("(DB.byId[S.run.ids[S.run.i]].choices || []).length");
  const mode = modeNow();
  if (mode === "panel") {
    const path = JSON.parse(ev(`JSON.stringify(DB.byId[S.run.ids[S.run.i]].panel.path)`));
    const order = correct ? path : path.slice(0, 2).reverse();
    order.forEach(i => d.querySelector(`.pcell[data-i="${i}"]`)?.click());
    d.getElementById("psubmit").click();
    return true;
  }
  if (mode === "numeric") {
    const want = ev(`JSON.stringify(numericParts(DB.byId[S.run.ids[S.run.i]]))`);
    const v = JSON.parse(want).value;
    const typed = correct ? v : String(Number(v) + 1);
    [...typed].forEach(c => d.querySelector(`.keypad .key[data-k="${c}"]`)?.click());
    d.getElementById("nsubmit").click();
    return true;
  }
  const btns = [...d.querySelectorAll(".choices > .choice")];
  if (!btns.length) return false;
  if (mode === "elimination") {
    // 誤っているものを3つ選んでから決める。正解を選んでいたら不正解になる
    if (!correct) { btns[a].click(); for (let i = 0, k = 1; i < n && k < n - 1; i++)
      if (i !== a) { btns[i].click(); k++; } }
    else for (let i = 0; i < n; i++) if (i !== a) btns[i].click();
    d.getElementById("esubmit").click();
  } else {
    btns[correct ? a : (a + 1) % n].click();
  }
  return true;
};

/* ---- 修正2: 解説スキップ ---- */
// レンジ回答が混ざるようになったので、この節は4択だけで組む
ev(`(() => {
  const ids = DB.questions.filter(q => (q.format || "choice") === "choice").slice(0, 6).map(q => q.id);
  S.settings.showExplanationOnCorrect = true;
  startRun({ ids });
})()`);
answerNow();
check("ONなら解説が出る", !!d.getElementById("next") && txt().includes("知識カード"));
check("ONなら応用編ボタンが出る", !!d.getElementById("tostretch"));

ev('S.settings.showExplanationOnCorrect=false');
const before = ev("S.run.i");
d.getElementById("next").click();
answerNow();
check("OFFなら解説パネルを出さない", !d.getElementById("next"));
check("OFFならトーストが出る", !!d.querySelector(".toast"), "toast なし");
await wait(950);
check("OFFなら自動で次へ進む", ev("S.run.i") === before + 2, `i=${ev("S.run.i")} (期待 ${before + 2})`);
check("トーストが消えている", !d.querySelector(".toast"));

// 不正解のときは設定に関わらず解説を出す
answerNow(false);
await wait(60);
check("OFFでも不正解なら解説が出る", !!d.getElementById("next") && txt().includes("面白い単元"));

/* ---- 消去法（難モード） ---- */
// 消去法の問題だけを並べたセッションを作って、3つ潰す／正解を潰す／4択へ降りるを見る
const elimRun = `(() => {
  S.settings.showExplanationOnCorrect = true;
  const ids = DB.questions.filter(q => q.mode === "elimination").slice(0, 3).map(q => q.id);
  S.run = { ids, i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, found: [],
            results: {}, noReward: true, done: false, hard: {} };
  S.view = "quiz"; render();
  return JSON.stringify({ id: ids[0], answer: DB.byId[ids[0]].answer, n: ids.length });
})()`;
const e1 = JSON.parse(ev(elimRun));
check("消去法の問題がある", e1.n === 3, JSON.stringify(e1));
check("消去法では選択肢が出る", d.querySelectorAll(".choices.elim > .choice").length === 4,
  String(d.querySelectorAll(".choices > .choice").length));
// 4択と消去法は選択肢が並ぶ見た目が同じで、押す意味は正反対。読まずに分かる必要がある
check("何をするかを帯で出す", (d.querySelector(".band.cut .bmain")?.textContent || "")
  .includes("誤っているものを 3つ 選ぶ"), d.querySelector(".band")?.textContent);
check("4択とは色で分ける", !!d.querySelector(".band.cut") && !d.querySelector(".band.pick"));
check("いくつ選んだかが出る", d.getElementById("ecnt").textContent === "0 / 3",
  d.getElementById("ecnt")?.textContent);
check("4択へ降りる道が常にある", !!d.getElementById("tochoice"));
check("選ぶ前は答えられない", d.getElementById("esubmit").disabled);

// 3つそろうまで答えられない。1手目で終わらないので、取りちがえても取り返せる
const wrong = [0, 1, 2, 3].filter(i => i !== e1.answer);
[...d.querySelectorAll(".choices > .choice")][wrong[0]].click();
check("選んだ選択肢に印がつく",
  d.querySelectorAll(".choice.x").length === 1, String(d.querySelectorAll(".choice.x").length));
check("数が増える", d.getElementById("ecnt").textContent === "1 / 3",
  d.getElementById("ecnt").textContent);
check("1つでは答えられない", d.getElementById("esubmit").disabled);
[...d.querySelectorAll(".choices > .choice")][wrong[0]].click();
check("押し直すと戻せる", d.querySelectorAll(".choice.x").length === 0 &&
  d.getElementById("ecnt").textContent === "0 / 3");
check("選んだだけでは決まらない", ev("S.run.picked") === null);

wrong.forEach(i => [...d.querySelectorAll(".choices > .choice")][i].click());
check("3つそろうと答えられる", !d.getElementById("esubmit").disabled);
d.getElementById("esubmit").click();
await wait(60);
check("誤りを3つ消せば正解になる", ev("S.run.results['" + e1.id + "']") === "ok",
  ev("S.run.results['" + e1.id + "']"));
check("正解でも解説は出る", txt().includes("知識カード"));

// 正解を混ぜて消したら不正解
const e2 = JSON.parse(ev(`(() => {
  S.run.i = 1; S.run.picked = null; S.run.hintsUsed = 0; render();
  const id = S.run.ids[1];
  return JSON.stringify({ id, answer: DB.byId[id].answer });
})()`));
const mix = [e2.answer, ...[0, 1, 2, 3].filter(i => i !== e2.answer).slice(0, 2)];
mix.forEach(i => [...d.querySelectorAll(".choices > .choice")][i].click());
d.getElementById("esubmit").click();
await wait(60);
check("正解を消したら外れる", ev("S.run.results['" + e2.id + "']") === "ng",
  ev("S.run.results['" + e2.id + "']"));
check("外しても解説と知識カードは出る（原則3）",
  txt().includes("面白い単元") && txt().includes("知識カード"));

// 4択へは自分で降りる。システムは勝手に降ろさない
const e3 = JSON.parse(ev(`(() => {
  S.run.i = 2; S.run.picked = null; S.run.hintsUsed = 0; render();
  return JSON.stringify({ id: S.run.ids[2] });
})()`));
check("降りる前は消去法のまま", !!d.querySelector(".choices.elim"));
d.getElementById("tochoice").click();
check("4択に降りられる", !d.querySelector(".choices.elim") && !d.getElementById("tochoice"),
  txt().slice(0, 80));
check("降りたのはその問題だけ", ev(`JSON.stringify(S.run.hard)`) === `{"${e3.id}":"choice"}`,
  ev("JSON.stringify(S.run.hard)"));
const e3a = ev(`DB.byId["${e3.id}"].answer`);
[...d.querySelectorAll(".choices > .choice")][e3a].click();
await wait(60);
check("降りた先でもふつうに答えられる", ev("S.run.results['" + e3.id + "']") === "ok");
// 報酬は答え方で変えない（原則3-2）
check("難モードでも4択でも報酬は同じ", ev(`(() => {
  const a = DB.questions.find(q => q.mode === "elimination");
  return String(gumFor(a));
})()`) === ev(`(() => {
  const a = DB.questions.find(q => q.mode === "elimination");
  return String(gumFor(a));
})()`));

/* ---- 文字パネル（難モード） ---- */
const pan = JSON.parse(ev(`(() => {
  S.settings.showExplanationOnCorrect = true;
  const ids = DB.questions.filter(q => q.mode === "panel").slice(0, 2).map(q => q.id);
  S.run = { ids, i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null, found: [],
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, results: {},
            noReward: true, done: false, hard: {} };
  S.view = "quiz"; render();
  const q = DB.byId[ids[0]];
  return JSON.stringify({ id: ids[0], reading: q.reading, size: q.panel.size, path: q.panel.path });
})()`));
check("文字パネルの問題がある", !!pan.reading, JSON.stringify(pan).slice(0, 90));
check("盤面は読みの長さで決まる", pan.size === (pan.reading.length <= 6 ? 3 : 4),
  `${pan.reading}(${pan.reading.length}) → ${pan.size}×${pan.size}`);
check("マスは盤面のぶんだけ出る",
  d.querySelectorAll(".pcell").length === pan.size * pan.size,
  String(d.querySelectorAll(".pcell").length));
check("選択肢は出さない", d.querySelectorAll(".choices > .choice").length === 0);
check("文字数の枠は出さない", !/\d\s*文字/.test(txt()), txt().slice(0, 120));
check("1文字目のマークは出さない", d.querySelectorAll(".pcell.on").length === 0,
  String(d.querySelectorAll(".pcell.on").length));
check("なぞる前は答えられない", d.getElementById("psubmit").disabled);

// マスの形。内側を向いた角だけを落とすので、中は八角形・辺は六角形・隅は五角形になる。
// 角を残すと、ななめにたどったとき隣のマスの角をかすめて拾ってしまう
const corners = t => t.split(",").length;
check("中のマスは八角形", corners(ev(`cellShape(4, 3)`)) === 8, ev(`cellShape(4, 3)`));
check("辺のマスは六角形", corners(ev(`cellShape(1, 3)`)) === 6, ev(`cellShape(1, 3)`));
check("隅のマスは五角形", corners(ev(`cellShape(0, 3)`)) === 5, ev(`cellShape(0, 3)`));
check("4×4でも内は八角形・隅は五角形",
  corners(ev(`cellShape(5, 4)`)) === 8 && corners(ev(`cellShape(15, 4)`)) === 5);
check("隣り合うマスを結ぶ線が敷いてある",
  d.querySelectorAll(".panellattice line").length > 0,
  String(d.querySelectorAll(".panellattice line").length));

// 隣り合っていないマスへは飛べない
const far = ev(`(() => {
  const p = DB.byId["${pan.id}"].panel, n = p.size, a = p.path[0];
  for (let i = 0; i < n * n; i++) {
    const dr = Math.abs(Math.floor(a / n) - Math.floor(i / n)), dc = Math.abs(a % n - i % n);
    if (dr > 1 || dc > 1) return i;
  }
  return -1;
})()`);
d.querySelector(`.pcell[data-i="${pan.path[0]}"]`).click();
if (far >= 0) {
  d.querySelector(`.pcell[data-i="${far}"]`).click();
  check("隣り合わないマスへは飛べない", d.querySelectorAll(".pcell.on").length === 1,
    String(d.querySelectorAll(".pcell.on").length));
}
// 直前のマスに戻ると1つ取り消す
d.querySelector(`.pcell[data-i="${pan.path[1]}"]`).click();
check("たどると文字が並ぶ",
  d.getElementById("pword").textContent === pan.reading.slice(0, 2),
  d.getElementById("pword").textContent);
d.querySelector(`.pcell[data-i="${pan.path[0]}"]`).click();
check("直前のマスに戻ると取り消せる",
  d.getElementById("pword").textContent === pan.reading.slice(0, 1),
  d.getElementById("pword").textContent);

// 違う読みを作っても問題は終わらない
ev(`(() => { S.run.picked = null; render(); })()`);
const rev = pan.path.slice(0, 2).reverse();
rev.forEach(i => d.querySelector(`.pcell[data-i="${i}"]`).click());
d.getElementById("psubmit").click();
await wait(30);
check("違う読みでも問題は終わらない", ev("S.run.picked") === null, String(ev("S.run.picked")));
check("パネルは生きたまま3択になる",
  txt().includes("まだ続けてもいい") && !d.querySelector(".pcell").disabled);

// 連続タップでも正解にできる
pan.path.forEach(i => d.querySelector(`.pcell[data-i="${i}"]`).click());
d.getElementById("psubmit").click();
await wait(40);
check("連続タップでも読みを作れる", ev(`S.run.results["${pan.id}"]`) === "ok",
  ev(`S.run.results["${pan.id}"]`));
check("決着したらマスは止まる", d.querySelector(".pcell").disabled);

// 盤面は問題ごとに決まっていて、描き直しても変わらない
check("盤面は描き直しても変わらない", ev(`(() => {
  const q = DB.byId["${pan.id}"];
  return String(JSON.stringify(panelLayout(q.reading, q.id)) === JSON.stringify(q.panel));
})()`) === "true");
// 実機でつまずいた2点。タッチのポインタは押したマスに暗黙でキャプチャされる
ev(`(() => { S.run.i = 0; S.run.picked = null; S.run.results = {}; render(); })()`);
const cap = ev(`(() => {
  const b = document.querySelector('.pcell');
  let released = false;
  b.hasPointerCapture = () => true;
  b.releasePointerCapture = () => { released = true; };
  b.onpointerdown({ preventDefault() {}, pointerId: 1 });
  return String(released);
})()`);
check("押したマスのキャプチャを放す（放さないと1文字目しか反応しない）", cap === "true", cap);

// jsdom には座標が無いので、マスの位置を自分で用意して指の動きを作る。
// なぞりは座標で拾うようにしたので、ここを通さないと検査にならない
ev(`(() => {
  S.run.i = 0; S.run.picked = null; S.run.results = {}; render();
  const n = DB.byId[S.run.ids[0]].panel.size, W = 100;
  const cells = [...document.querySelectorAll('.pcell')];
  cells.forEach((c, i) => {
    const left = (i % n) * W, top = Math.floor(i / n) * W;
    c.getBoundingClientRect = () => ({ left, top, width: W, height: W,
      right: left + W, bottom: top + W });
  });
  document.elementFromPoint = (x, y) => cells.find(c => {
    const r = c.getBoundingClientRect();
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  }) || null;
  window.__center = i => ({ x: (i % n) * W + W / 2, y: Math.floor(i / n) * W + W / 2 });
})()`);
const drag = path => ev(`(() => {
  const cells = [...document.querySelectorAll('.pcell')];
  const wrap = document.querySelector('.panelwrap');
  const p = ${JSON.stringify(path)};
  cells[p[0]].onpointerdown({ preventDefault() {}, pointerId: 3 });
  for (const i of p.slice(1)) {
    const c = window.__center(i);
    wrap.onpointermove({ preventDefault() {}, clientX: c.x, clientY: c.y });
  }
  return document.getElementById('pword').textContent;
})()`);
const p3 = JSON.parse(ev(`JSON.stringify(DB.byId[S.run.ids[0]].panel.path)`));
check("座標でなぞると読みが組み上がる",
  drag(p3) === ev(`DB.byId[S.run.ids[0]].reading`), drag(p3));

// マスの角をかすめただけでは拾わない。ここを緩めると途中のマスが混ざる
const brush = ev(`(() => {
  S.run.picked = null; render();
  const cells = [...document.querySelectorAll('.pcell')];
  const wrap = document.querySelector('.panelwrap');
  const n = DB.byId[S.run.ids[0]].panel.size, W = 100, a = ${p3[0]}, b = ${p3[1]};
  cells[a].onpointerdown({ preventDefault() {}, pointerId: 4 });
  // 隣のマスの「角」を通る。中心から遠いので拾ってはいけない
  const c = window.__center(b);
  wrap.onpointermove({ preventDefault() {}, clientX: c.x + W * 0.46, clientY: c.y + W * 0.46 });
  return document.getElementById('pword').textContent;
})()`);
check("マスの角をかすめても拾わない", brush.length === 1, brush);

// 指を離す監視を once にすると、最初のタップで外れて以降のなぞりが死ぬ
ev(`(() => { S.run.picked = null; render(); })()`);
d.dispatchEvent(new w.Event("pointerup"));
drag(p3);
d.dispatchEvent(new w.Event("pointerup"));
await wait(40);
check("タップのあとでも、なぞりが確定する", ev("S.run.picked") !== null,
  String(ev("S.run.picked")));

check("読みが長すぎるとパネルにしない",
  ev(`String(panelLayout("じゅうしちじょうのけんぽう", "x") === null)`) === "true");

/* ---- 数値入力（難モード） ---- */
const numRun = JSON.parse(ev(`(() => {
  S.settings.showExplanationOnCorrect = true;
  const ids = DB.questions.filter(q => q.mode === "numeric").slice(0, 2).map(q => q.id);
  S.run = { ids, i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null, found: [],
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, results: {},
            noReward: true, done: false, hard: {} };
  S.view = "quiz"; render();
  return JSON.stringify({ id: ids[0], want: numericParts(DB.byId[ids[0]]) });
})()`));
check("数値入力の問題がある", !!numRun.want, JSON.stringify(numRun));
check("選択肢は出さない", d.querySelectorAll(".choices > .choice").length === 0);
check("テンキーが出る", d.querySelectorAll(".keypad .key").length === 12,
  String(d.querySelectorAll(".keypad .key").length));
check("単位は固定表示で、打たせない",
  (d.querySelector(".numdisp b")?.textContent || "") === (numRun.want.unit || ""),
  `表示 ${d.querySelector(".numdisp b")?.textContent} / 正解の単位 ${numRun.want.unit}`);
check("入れる前は答えられない", d.getElementById("nsubmit").disabled);

// わざと外す。問題は終わらず、入力欄は生きたまま
const numWrong = String(Number(numRun.want.value) + 7);
[...numWrong].forEach(c => d.querySelector(`.keypad .key[data-k="${c}"]`).click());
d.getElementById("nsubmit").click();
await wait(30);
check("外しても問題は終わらない", ev("S.run.picked") === null, String(ev("S.run.picked")));
check("3択を文言で示す", txt().includes("まだ続けてもいい"), txt().slice(-120));
check("ヒントと4択への道が並ぶ", !!d.getElementById("rhint") && !!d.getElementById("rdown"));
check("「このまま挑み直す」に専用ボタンは置かない",
  d.querySelectorAll(".retry .racts .lnk").length === 2,
  String(d.querySelectorAll(".retry .racts .lnk").length));
check("テンキーは生きている", !d.querySelector(".keypad .key").disabled);

// 続ければ正解にできる
[...numRun.want.value].forEach(c => d.querySelector(`.keypad .key[data-k="${c}"]`).click());
d.getElementById("nsubmit").click();
await wait(40);
check("続けて正解にできる", ev(`S.run.results["${numRun.id}"]`) === "ok",
  ev(`S.run.results["${numRun.id}"]`));
check("決着したらテンキーは止まる", d.querySelector(".keypad .key").disabled);
check("全角でも同じ数として通る", ev(`String(sameNumber("１２", "12"))`) === "true");

// 降りるのはプレイヤーの判断。システムは勝手に降ろさない
const n2 = ev(`(() => { S.run.i = 1; S.run.picked = null; S.run.hintsUsed = 0; render();
  return S.run.ids[1]; })()`);
check("2問目も難モードから始まる", !!d.getElementById("nsubmit"));
d.getElementById("tochoice").click();
check("数値入力からも4択に降りられる",
  d.querySelectorAll(".choices > .choice").length === 4 && !d.getElementById("nsubmit"));
check("降りたのはその問題だけ", ev(`JSON.stringify(S.run.hard)`) === `{"${n2}":"choice"}`,
  ev("JSON.stringify(S.run.hard)"));

/* ---- コモンズの写真とクレジット ---- */
// 実体のバイト列が無くても描画は確かめられるので、台帳に仮の1件を差して戻す
ev(`(() => {
  window.__photoBackup = { photos: DB.photos, q: null };
  DB.photos = Object.assign({}, DB.photos, { __t: {
    file: "__t", alt: "テスト用の説明", title: "テスト写真",
    author: "撮影者", license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Test.jpg" } });
  const id = S.run.ids[S.run.i];
  const q = DB.byId[id];
  window.__photoBackup.q = id;
  q.image = "__t"; q.imageAt = "prompt";
  S.run.picked = null; render();
})()`);
check("問題文の下に写真を出せる", d.querySelectorAll(".qtext + .photo img").length === 1,
  String(d.querySelectorAll(".photo").length));
check("写真にaltが付く", d.querySelector(".photo img")?.getAttribute("alt") === "テスト用の説明",
  d.querySelector(".photo img")?.getAttribute("alt"));
check("クレジットに作者とライセンスと出典を出す", (() => {
  const c = d.querySelector(".photo figcaption")?.textContent || "";
  return c.includes("撮影者") && c.includes("CC BY 4.0") && c.includes("Wikimedia Commons");
})(), d.querySelector(".photo figcaption")?.textContent);
check("ライセンスと出典はリンクになる",
  d.querySelectorAll(".photo figcaption a").length === 2,
  String(d.querySelectorAll(".photo figcaption a").length));
// クレジットの欄が欠けた画像は出さない（CC BY の条件を満たせないため）
ev('DB.photos.__t.author = ""; DB.photos.__t.license = ""; render();');
check("ライセンス不明の写真は出さない", d.querySelectorAll(".photo").length === 0,
  String(d.querySelectorAll(".photo").length));
ev(`(() => {
  const q = DB.byId[window.__photoBackup.q];
  delete q.image; delete q.imageAt;
  DB.photos = window.__photoBackup.photos;
  render();
})()`);
check("写真を外せば元に戻る", d.querySelectorAll(".photo").length === 0);

/* ---- 報酬とチャレンジが壊れていないか ---- */
// クリスタルは確率で落ちるので、ここだけ乱数を止めて必ず当たるようにする。
// 止めないと、外国語なら1セッションで出ない確率のほうが高く、検査が気まぐれになる
ev("window.__rnd = Math.random; Math.random = () => 0");
ev(`(() => {
  const ids = DB.questions.filter(q => (q.format || "choice") === "choice").slice(0, 10).map(q => q.id);
  S.settings.showExplanationOnCorrect = true;
  startRun({ ids });
})()`);
for (let k = 0; k < 10; k++) {

  if (!answerNow()) break;
  const st = d.getElementById("tostretch");
  if (st) { st.click(); const ex = d.querySelectorAll("#exch > .choice");
    if (ex.length) ex[ev("DB.byId[S.run.ids[S.run.i]].applied.answer")].click(); }
  d.getElementById("next").click();
}
check("族ポイントが貯まる", ev("Object.values(S.points).reduce((x,y)=>x+y,0)") > 0,
  ev("JSON.stringify(S.points)"));
check("出会った鉱物は図鑑に残る", ev("crystalKinds(S)") > 0, `${ev("crystalKinds(S)")}種`);
check("解いた教科に対応する族に入る", ev(`(() => {
  const subs = new Set(S.run.ids.map(id => DB.byId[id].subject));
  const want = new Set([...subs].map(s => DB.subjectToFamily[s]));
  return Object.keys(S.points).every(f => want.has(f));
})()`) === true, ev("JSON.stringify(S.points)"));
ev("Math.random = window.__rnd");

/* ---- GUM は難易度なり（1〜10） ---- */
check("易しい問題は1GUM", ev('gumFor({grade:"e1"})') === 1);
check("世界の問題は10GUM", ev('gumFor({grade:"w"})') === 10);
check("学年が上がるほど増える",
  ["e1","e2","e3","e4","e5","e6","j1","j2","j3","w"]
    .map(g => ev(`gumFor({grade:"${g}"})`)).every((v, i, a) => i === 0 || v > a[i - 1]));
check("未知の学年でも1〜10に収まる",
  ev('gumFor({grade:"zz"})') === 1 && ev('gumFor({})') === 1);
// ここまでに何セッションか回しているので、所持は今回ぶん以上になる
check("正解した問題ぶんGUMが貯まる", ev("S.run.gum") > 0 && ev("S.gum") >= ev("S.run.gum"),
  `所持 ${ev("S.gum")} / 今回 ${ev("S.run.gum")}`);
check("今回のGUMは正解数と釣り合う",
  ev("S.run.gum") >= ev("S.run.right") && ev("S.run.gum") <= ev("S.run.right") * 10,
  `${ev("S.run.gum")} GUM / 正解 ${ev("S.run.right")}問`);
check("リザルトに到達", !!d.getElementById("again"), txt().slice(0, 80));

/* ---- クラフト（40種・クリスタル込み） ---- */
ev('S.view="craft";S.craftTab="ペン";render()');
check("40種そろっている", ev("Object.keys(DB.extensions).length") === 40,
  `${ev("Object.keys(DB.extensions).length")}種`);
check("系統ごとのタブは8つ", d.querySelectorAll("#linetab button").length === 8,
  `${d.querySelectorAll("#linetab button").length}件`);
check("1つの系統は5段階", d.querySelectorAll(".ext").length === 5,
  `${d.querySelectorAll(".ext").length}件`);

// Common も少しだけクリスタルが要る（魔石を廃止したので、ここが入口の関門になる）
ev('S.points={};S.exts={};S.crystals={};render()');
check("素材が無ければCommonも作れない",
  [...d.querySelectorAll(".mini[data-k]")].every(b => b.disabled));
ev('S.points={"生物起源":10,"宝石":10};render()');   // ノービスペンは 生物起源10 ＋ 宝石10
const common = [...d.querySelectorAll(".mini[data-k]")].filter(b => !b.disabled);
check("Commonは少しのクリスタルで作れる", common.length === 1 && common[0].dataset.k === "1003",
  common.map(b => b.dataset.k).join(","));
common[0].click();
check("作るとポイントが減る", ev('familyPoints(S, "生物起源")') === 0,
  `${ev('familyPoints(S, "生物起源")')}pt`);
check("作ったものが手元に入る", ev(`S.exts["1003"]`) === 1);

// Uncommon はもっと要る
ev('S.points={};render()');
check("クリスタルが無いとUncommonは作れない",
  d.querySelector('.mini[data-k="2003"]').disabled);
// エリートペン（国語・外国語）は 生物起源30pt ＋ 宝石20pt。
// **別の族をいくら積んでも作れない。** ここが族ごとの要求の要
ev('S.points={"貴金属":240};render()');   // 貴金属を240pt 持っていても
check("別の族のポイントでは作れない",
  d.querySelector('.mini[data-k="2003"]').disabled,
  `貴金属 ${ev('familyPoints(S, "貴金属")')}pt`);
ev('S.points={"生物起源":102,"宝石":57};S.crystals={"046":1,"036":3};render()');
check("要求された族があれば作れる", !d.querySelector('.mini[data-k="2003"]').disabled,
  `生物起源 ${ev('familyPoints(S, "生物起源")')}pt / 宝石 ${ev('familyPoints(S, "宝石")')}pt`);
// 足りているときは要求だけ、足りないときは「持ち高/要求」を出す
check("足りない族は、持ち高と要求を並べて見せる", (() => {
  ev('S.points={"生物起源":5,"宝石":5};render()');
  const short = /生物起源 5\/30pt/.test(txt()) && /宝石 5\/20pt/.test(txt());
  ev('S.points={"生物起源":102,"宝石":57};render()');
  return short && /生物起源 30pt/.test(txt()) && !/生物起源 \d+\/30pt/.test(txt());
})(), txt().slice(0, 60));
d.querySelector('.mini[data-k="2003"]').click();
check("要求ぶんだけポイントが減る",
  ev('familyPoints(S, "生物起源")') === 72 && ev('familyPoints(S, "宝石")') === 37,
  `生物起源 ${ev('familyPoints(S, "生物起源")')}pt / 宝石 ${ev('familyPoints(S, "宝石")')}pt`);
// **鉱物そのものは減らない。** 減らすと豆知識が読めなくなり、図鑑が欠ける
check("クラフトしても図鑑は欠けない",
  ev(`S.crystals["046"]`) === 1 && ev(`S.crystals["036"]`) === 3,
  `琥珀 ${ev(`S.crystals["046"] || 0`)} / ジルコニア ${ev(`S.crystals["036"] || 0`)}`);

// Rare は下位を1つ食う
ev('S.points={"生物起源":90,"宝石":60};S.exts={};render()');
check("下位が無いとRareは作れない", d.querySelector('.mini[data-k="3003"]').disabled,
  `2003の所持 ${ev(`S.exts["2003"] || 0`)}`);
ev(`S.exts["2003"]=1;render()`);
check("下位があればRareを作れる", !d.querySelector('.mini[data-k="3003"]').disabled);
d.querySelector('.mini[data-k="3003"]').click();
check("Rareを作ると下位が消える", !ev(`S.exts["2003"]`), `残り ${ev(`S.exts["2003"] || 0`)}`);

// Legendary は知識カードの所持も条件
ev('S.points={"生物起源":240,"宝石":160};S.exts={"4003":1};render()');
const cardCount0 = ev("Object.keys(S.cards).length");
check("知識カードが足りないとLegendaryは作れない",
  cardCount0 >= 30 || d.querySelector('.mini[data-k="5003"]').disabled,
  `カード ${cardCount0}枚`);

ev('S.view="craft";S.craftTab="ペン";S.exts={};S.crystals={};S.points={};render()');
d.querySelector(".mapbtn").click();

ev('S.view="home";render()');
d.getElementById("tochal").click();
check("挑戦先を選ぶ画面を挟む", txt().includes("どの英雄に挑むか"), txt().slice(0, 80));
check("到達度はここで見せる", /到達度 \d+%/.test(txt()), txt().slice(0, 200));
check("未解放の英雄がすべて並ぶ",
  d.querySelectorAll(".trow").length === ev("lockedHeroes(DB,S).length"),
  `${d.querySelectorAll(".trow").length}件`);
d.querySelector(".trow").click();
check("チャレンジ画面", txt().includes("持っている知識で届く"));
d.getElementById("fight").click();
await wait(1500);
const hero = ev("DB.heroById[S.challenge.heroId].name");
check("入力欄が出る", !!d.getElementById("ans"), `相手=${hero}`);
check("3問構成になっている", ev("DB.heroById[S.challenge.heroId].ch.qs.length") === 3);
check("何問目かを見せる", txt().includes("1問目"), txt().slice(0, 80));
check("すすみ具合の点が3つ", d.querySelectorAll(".chprog i").length === 3,
  `${d.querySelectorAll(".chprog i").length}個`);

// 全部外しても、最後まで進んでから判定する
const answerAll = (correct) => {
  for (let k = 0; k < 3; k++) {
    const input = d.getElementById("ans");
    if (!input) break;
    const ansList = JSON.parse(ev(`JSON.stringify(DB.heroById[S.challenge.heroId].ch.qs[S.challenge.qi].ans)`));
    input.value = correct ? ansList[0] : "でたらめ";
    d.getElementById("submit").click();
  }
};
answerAll(false);
check("外しても3問すべて出る", ev("S.challenge.results.length") === 3,
  ev("JSON.stringify(S.challenge.results)"));
check("必要正答数に届かなければ解放しない", ev("S.challenge.won") !== true);
check("挑めば知識カードを1枚持ち帰る", !!ev("S.challenge.gotCard"),
  String(ev("S.challenge.gotCard")));
check("負けても解説と再挑戦が出る", !!d.getElementById("retry") && txt().includes("次はゲージ"),
  txt().slice(0, 80));

// 解放に必要なぶんだけ当てる
d.getElementById("retry").click();
d.getElementById("fight").click();
await wait(1500);
answerAll(true);
check("必要正答数を満たせば解放", ev("S.challenge.won") === true,
  ev("JSON.stringify(S.challenge.results)"));
check("解放されて手持ちに入る", ev(`!!S.owned[S.challenge.heroId]`));
check("レアリティで必要正答数が変わる",
  ev('challengeNeed({rarity:"Common"})') === 1 && ev('challengeNeed({rarity:"Rare"})') === 2 &&
  ev('challengeNeed({rarity:"Legendary"})') === 3);
check("ゲージが削れているほど問いはやさしくなる", ev(`(() => {
  const q = DB.heroById["4007"].ch.qs[0];
  return challengePrompt(q, 0) === q.v[0] && challengePrompt(q, 3) === q.v[3];
})()`), "段階と問い方の対応が逆");
check("レアリティは体力ではなく難度係数になった",
  ev('DB.heroById["5016"].hp') === undefined &&
  ev('difficultyFactor(DB.heroById["5016"])') === 1 &&
  ev('difficultyFactor({rarity:"Common"})') === 0.4,
  String(ev('difficultyFactor(DB.heroById["5016"])')));
check("持ち帰るカードはその英雄の関連カードだけ", ev(`(() => {
  const h = DB.heroById["5016"];
  const st = JSON.parse(JSON.stringify(S));
  st.cards = {};
  const got = [];
  for (let k = 0; k < 10; k++) {
    const c = challengeCard(h, st);
    if (!c) break;
    st.cards[c] = true; got.push(c);
  }
  return got.length === h.rel.cards.length && got.every(c => h.rel.cards.includes(c));
})()`), "無限に増えるか、関係ないカードが出ている");

// 解放すると出題範囲が広がる
ev('S.owned["4007"]=1;S.owned["5016"]=1;S.view="select";S.select.subject="auto";render()');
check("解放で在庫が増える", new RegExp(`おまかせ\\s*${ev("DB.questions.length")}`).test(txt()),
  `全 ${ev("DB.questions.length")}問 / ${txt().slice(0, 120)}`);

/* ---- カレンダー ---- */
ev('S.view="home";render()');
check("カレンダーは押せる", !!d.getElementById("tocal"));
check("1セッションで回数は1だけ増える", ev("S.runs") === 1, `runs=${ev("S.runs")}`);
check("その日の記録が残る", ev("Object.keys(S.days).length") === 1,
  ev("JSON.stringify(Object.keys(S.days))"));
check("記録にGUMも残る", ev("S.days[dayKey()].gum") > 0, `${ev("S.days[dayKey()].gum")} GUM`);
check("記録は解けた数と問題を持つ", ev(`(() => {
  const r = S.days[dayKey()];
  return r.right + r.wrong > 0 && Object.keys(r.results).length > 0;
})()`), ev("JSON.stringify(S.days[dayKey()])").slice(0, 120));

d.getElementById("tocal").click();
check("カレンダー画面が開く", txt().includes("カレンダー"), txt().slice(0, 60));
check("連続日数の話は出さない", !/連続.*ボーナス(?!も)/.test(txt()) && txt().includes("ペナルティもありません"));
const stamped = [...d.querySelectorAll(".cald.on")];
check("解いた日にスタンプが押される", stamped.length === 1, `${stamped.length}日`);
check("解いていない日は押せない",
  [...d.querySelectorAll(".cald[data-k]")].every(b => b.classList.contains("on") || b.disabled),
  `${[...d.querySelectorAll(".cald[data-k]")].filter(b => !b.classList.contains("on") && !b.disabled).length}件が押せてしまう`);

// 月送り
const monthText = d.querySelector(".calmonth").textContent;
d.getElementById("prevmonth").click();
check("前の月へ送れる", d.querySelector(".calmonth").textContent !== monthText);
check("年またぎも壊れない", ev("JSON.stringify(shiftMonth(2026,1,-1))") === '{"year":2025,"month":12}');
d.getElementById("nextmonth").click();
check("戻ってこられる", d.querySelector(".calmonth").textContent === monthText);

stamped[0].click();
check("その日の記録を開ける", txt().includes("セッション"), txt().slice(0, 80));
check("解説を読み返せる", d.querySelectorAll(".panel .extt").length > 0,
  `${d.querySelectorAll(".panel .extt").length}件`);

// 再挑戦は報酬なし
const had = {
  gum: ev("S.gum"),
  points: ev("Object.values(S.points).reduce((a,b)=>a+b,0)"),
  cards: ev("Object.keys(S.cards).length"),
  runs: ev("S.runs"),
  score: ev("S.score"),
};
d.getElementById("replay").click();
check("再挑戦が始まる", ev("S.run.noReward") === true && ev("S.run.ids.length") > 0);
for (let i = 0; i < 40 && ev('S.view==="quiz"'); i++) {
  if (!answerNow()) break;
  const n = d.getElementById("next");
  if (n) n.click(); else await wait(900);
}
const now = {
  gum: ev("S.gum"),
  points: ev("Object.values(S.points).reduce((a,b)=>a+b,0)"),
  cards: ev("Object.keys(S.cards).length"),
  runs: ev("S.runs"),
  score: ev("S.score"),
};
check("再挑戦ではクリスタルが増えない", now.points === had.points,
  `${had.points} -> ${now.points}`);
check("再挑戦では知識カードが増えない", now.cards === had.cards, `${had.cards} -> ${now.cards}`);
check("再挑戦は回数に入らない", now.runs === had.runs, `${had.runs} -> ${now.runs}`);
check("再挑戦では点が入らない", now.score === had.score, `${had.score} -> ${now.score}`);
check("再挑戦ではGUMも増えない", now.gum === had.gum, `${had.gum} -> ${now.gum}`);
check("再挑戦は記録を書き換えない", ev("S.days[dayKey()].runs") === 1,
  `runs=${ev("S.days[dayKey()].runs")}`);

/* ---- マイページと称号 ---- */
ev('S.view="home";render()');
check("ステータス層からマイページへ行ける", !!d.getElementById("tomypage"));
d.getElementById("tomypage").click();
check("マイページが開く", txt().includes("マイページ"), txt().slice(0, 60));

// 名前
d.getElementById("nameinput").value = "テスト太郎";
d.getElementById("savename").click();
check("名前を変えられる", ev("S.profile.name") === "テスト太郎", ev("S.profile.name"));
ev('S.myTab="name";render()');
d.getElementById("nameinput").value = "あ".repeat(400);
d.getElementById("savename").click();
check("名前は255文字で切られる", ev("S.profile.name.length") === 255, `${ev("S.profile.name.length")}文字`);
ev('S.profile.name="旅人";S.myTab="icon";render()');

// アイコン
const iconBtns = [...d.querySelectorAll(".hcard[data-i]")];
check("アイコンは手持ちの英雄から選ぶ", iconBtns.length === ev("heroesOwned().length"),
  `${iconBtns.length}件`);
iconBtns[1].click();
check("アイコンを変えられる", ev("S.profile.icon") === iconBtns[1].dataset.i, ev("S.profile.icon"));

// 称号
ev('S.myTab="title";render()');
check("称号が一覧になる", d.querySelectorAll(".eqi[data-t]").length === ev("DB.titles.titles.length") + 1,
  `${d.querySelectorAll(".eqi[data-t]").length}件`);
check("未取得の称号は選べない",
  [...d.querySelectorAll(".eqi[data-t]")].filter(b => b.classList.contains("lock")).every(b => b.disabled));
check("未取得の称号は名前を伏せる",
  [...d.querySelectorAll(".eqi.lock .tname")].every(e => e.textContent === "？？？"));

// 条件を満たすと選べるようになる
ev(`S.countries={"イギリス":1,"インド":1,"フランス":1};render()`);
const world = [...d.querySelectorAll(".eqi[data-t]")].find(b => b.dataset.t === "世界を渡る者");
check("条件を満たすと称号が開く", !!world && !world.disabled, world ? "disabled" : "見つからない");
world.click();
check("称号を付けられる", ev("S.profile.title") === "世界を渡る者", String(ev("S.profile.title")));
ev('S.view="home";render()');
check("ホームに称号が出る", d.querySelector(".st-title").textContent.includes("世界を渡る者"),
  d.querySelector(".st-title").textContent);
check("越境の称号が量より先に並ぶ",
  ev(`titleProgress(DB,S)[0].kind`) === "越境" && ev(`titleProgress(DB,S).at(-1).kind`) === "量");
check("正解した国が記録される", ev("Object.keys(S.countries).length") >= 3);
ev('S.profile.title=null;render()');

/* ---- クリスタル10種 ---- */
check("クリスタルは100種", ev("DB.crystals.crystals.length") === 100,
  `${ev("DB.crystals.crystals.length")}種`);
check("6族すべてに1種以上ある", ev(`(() => {
  const fam = ["貴金属", "宝石", "元素", "鉱石", "生物起源", "石英"];
  const have = new Set(DB.crystals.crystals.map(c => c.family));
  return fam.every(f => have.has(f)) && have.size === fam.length;
})()`) === true, ev(`JSON.stringify([...new Set(DB.crystals.crystals.map(c => c.family))])`));
check("希少度は Amount から出したものと合う", ev(`(() => {
  const cs = DB.crystals.crystals;
  const tot = cs.reduce((a, c) => a + c.amount, 0);
  return cs.every(c => Math.abs(c.scarcity - Math.round(c.amount / tot * 1e5) / 1e3) < 1e-9);
})()`) === true, "図鑑の Amount と希少度が噛み合っていない");
check("和名と英名が両方ある",
  ev(`DB.crystals.crystals.every(c => c.name && c.en)`),
  ev(`JSON.stringify(DB.crystals.crystals.filter(c => !c.name || !c.en).map(c => c.id))`));
check("価格は希少度から出す（計画表の例と一致）",
  ev("crystalPrice(6.250)") === 8 && ev("crystalPrice(3.950)") === 13,
  `銅 ${ev("crystalPrice(6.250)")} / 黒鉛 ${ev("crystalPrice(3.950)")}`);
check("希少なものほど高い", ev(`(() => {
  const cs = [...DB.crystals.crystals].sort((a,b) => a.scarcity - b.scarcity);
  return cs.every((c,i) => i === 0 || crystalPrice(c.scarcity) <= crystalPrice(cs[i-1].scarcity));
})()`));
check("下限は5GUM", ev("crystalPrice(100)") === 5 && ev("crystalPrice(0)") === 5);
// 族は図鑑の見出しだけ。教科には結び付けない
check("族を教科に結び付けていない", ev("typeof CRYSTAL_FAMILIES") === "undefined");
// 希少度 × 価格 は常に 50。ずれるのは価格を整数に丸めたぶんだけで、
// その幅は 希少度 × 0.5 を超えない。100種に増えても偏りは生まれない
check("どの鉱物も GUM あたりの重みが同じ", ev(`(() => {
  return DB.crystals.crystals.every(c =>
    Math.abs(c.scarcity * crystalPrice(c.scarcity) - 50) <= c.scarcity * 0.5 + 1e-9);
})()`) === true,
  ev(`JSON.stringify(DB.crystals.crystals
    .filter(c => Math.abs(c.scarcity * crystalPrice(c.scarcity) - 50) > c.scarcity * 0.5 + 1e-9)
    .map(c => c.name))`));
check("クラフトの重みは払ったGUMそのもの",
  ev(`DB.crystals.crystals.every(c => crystalPoints(c.scarcity) === crystalPrice(c.scarcity))`));
/* ---- クリスタルの抽選（原則2の唯一の例外）---- */
// rng を渡せるので結果を再現できる。0 を返せば必ず当たり、1 なら必ず外れ
check("確率で落ちる。rng を渡せば結果は決まる", ev(`(() => {
  const always = drawCrystal(DB, "理科", 5, () => 0);
  const never  = drawCrystal(DB, "理科", 5, () => 0.999999);
  return !!always && DB.crystalById[always].family === "元素" && never === null;
})()`) === true, ev(`String(drawCrystal(DB, "理科", 5, () => 0))`));

check("外れても失うものはない", ev(`(() => {
  // 抽選は state を触らない純粋関数。外れは null を返すだけ
  const before = JSON.stringify(S.points);
  drawCrystal(DB, "国語", 5, () => 0.999999);
  return JSON.stringify(S.points) === before;
})()`) === true);

// **どの族を貯めても、規定ポイントに届くまでの時間は変わらない。**
// 出にくい族は1回の当たりが大きく、出やすい族は小刻みに入る
check("どの族でも1問あたりの期待ポイントは揃う", ev(`(() => {
  const e = SUBJECTS.map(sub => {
    const f = DB.subjectToFamily[sub];
    return dropRate(DB, f, 5) * familyExpect(DB, f);
  });
  return Math.max(...e) / Math.min(...e) <= 1 + RARE_BONUS + 1e-9;
})()`) === true, ev(`JSON.stringify(SUBJECTS.map(sub => {
  const f = DB.subjectToFamily[sub];
  return +(dropRate(DB, f, 5) * familyExpect(DB, f)).toFixed(2);
}))`));

check("レア寄りの族のほうが、わずかに期待値が高い", ev(`(() => {
  const v = f => dropRate(DB, f, 5) * familyExpect(DB, f);
  // 宝石（当たりが最も重い）> 元素（最も軽い）。差は RARE_BONUS のぶんだけ
  return v("宝石") > v("元素") && v("宝石") / v("元素") <= 1 + RARE_BONUS + 1e-9;
})()`) === true,
  ev(`"宝石 " + (dropRate(DB,"宝石",5)*familyExpect(DB,"宝石")).toFixed(2) +
      " / 元素 " + (dropRate(DB,"元素",5)*familyExpect(DB,"元素")).toFixed(2)`));

check("出にくい族ほど1回の当たりが大きい", ev(`(() => {
  const fam = SUBJECTS.map(s => DB.subjectToFamily[s])
    .map(f => ({ f, h: dropRate(DB, f, 5), e: familyExpect(DB, f) }))
    .sort((a, b) => a.h - b.h);
  return fam.every((x, i) => i === 0 || x.e <= fam[i - 1].e);
})()`) === true);

// 族の中の出やすさは図鑑の希少度そのもの。こちらで盛っていない
check("族の中は希少度そのままの重み", ev(`(() => {
  // 種を固定した乱数で2万回引き、出た割合が希少度の割合と合うか見る
  let x = 123456789;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const hit = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    // drawCrystal は rng を2回呼ぶ。1回目は当たり判定、2回目がどれを引くか。
    // 1回目を必ず当たりにして、2回目だけを乱数にする
    let call = 0;
    const id = drawCrystal(DB, "理科", 10, () => (++call === 1 ? 0 : rnd()));
    if (id) hit[id] = (hit[id] || 0) + 1;
  }
  const list = DB.crystals.crystals.filter(c => c.family === "元素");
  const sum = list.reduce((a, c) => a + c.scarcity, 0);
  const total = Object.values(hit).reduce((a, b) => a + b, 0);
  // いちばんありふれた鉄と、いちばん稀なセシウムで、期待割合とのずれを見る
  return list.every(c => {
    const want = c.scarcity / sum, got = (hit[c.id] || 0) / total;
    return Math.abs(got - want) < 0.03;
  });
})()`) === true, "出やすさが希少度とずれている");

check("いちばんありふれた鉱物がいちばん出る", ev(`(() => {
  const list = DB.crystals.crystals.filter(c => c.family === "元素")
    .sort((a, b) => b.scarcity - a.scarcity);
  return list[0].name === "鉄" && crystalPoints(list[0].scarcity) <
         crystalPoints(list[list.length - 1].scarcity);
})()`) === true);

check("いちばん難しい問題でも、期待ポイントは揃ったまま", ev(`(() => {
  const e = SUBJECTS.map(sub => {
    const f = DB.subjectToFamily[sub];
    return dropRate(DB, f, 10) * familyExpect(DB, f);   // 確率が1で頭打ちになると崩れる
  });
  return Math.max(...e) / Math.min(...e) <= 1 + RARE_BONUS + 1e-9;
})()`) === true, "どこかの族で確率が頭打ちになっている");

check("難しい問題ほど当たりやすい",
  ev('dropRate(DB, "元素", 10)') > ev('dropRate(DB, "元素", 1)'));

check("確率は1を超えない", ev(`SUBJECTS.every(s => dropRate(DB, DB.subjectToFamily[s], 10) <= 1)`) === true);

check("教科と族は1対1", ev(`(() => {
  const map = DB.subjectToFamily, fam = DB.families;
  const used = SUBJECTS.map(s => map[s]);
  return used.every(f => fam.includes(f)) && new Set(used).size === 6 && fam.length === 6;
})()`) === true, ev("JSON.stringify(DB.subjectToFamily)"));
check("どの族にも鉱物がある", ev(`(() => {
  return DB.families.every(f => DB.crystals.crystals.some(c => c.family === f));
})()`) === true);
check("レシピは族ごとのポイントで要求する", ev(`(() => {
  return Object.values(DB.extensions).every(e => {
    if (!e.crystals) return e.rarity === "Common";
    const keys = Object.keys(e.crystals);
    if (keys.includes("*")) return keys.length === 1;
    const want = new Set(e.subs.map(s => DB.subjectToFamily[s]));
    return keys.every(f => DB.families.includes(f) && want.has(f));
  });
})()`) === true, "族と分野が噛み合わないレシピがある");
check("族をまたいでも 1GUM あたりの重みは同じ", ev(`(() => {
  // どの族の鉱物を買っても、払った GUM がそのままポイントになる
  return DB.families.every(f => {
    const cs = DB.crystals.crystals.filter(c => c.family === f);
    return cs.every(c => crystalPoints(c.scarcity) === crystalPrice(c.scarcity));
  });
})()`) === true);
check("同じGUMなら鉱物を変えても重みは同じ", ev(`(() => {
  const byId = DB.crystalById;
  const spend = id => { const p = crystalPrice(byId[id].scarcity);
    const n = Math.floor(600 / p); return { paid: n * p, weight: crystalsValue({ [id]: n }, byId) }; };
  return DB.crystals.crystals.every(c => { const r = spend(c.id); return r.paid === r.weight; });
})()`));
check("1個ぶんの目安は50GUM", ev("CRYSTAL_UNIT") === 50);

/* ---- ショップ ---- */
ev('S.view="home";render()');
d.getElementById("toshop").click();
check("ショップが開く", txt().includes("ショップ"), txt().slice(0, 60));
check("100種すべて並ぶ", d.querySelectorAll(".shopitem").length === 100,
  `${d.querySelectorAll(".shopitem").length}件`);
check("品揃えは安い順で固定", (() => {
  const read = () => [...d.querySelectorAll(".shopitem .sn")].map(e => e.textContent.trim());
  const a = read(); ev("render()"); const b = read();
  const prices = ev("JSON.stringify(shopList(DB).map(c => c.price))");
  const p = JSON.parse(prices);
  return a.join("|") === b.join("|") && p.every((v, i) => i === 0 || v >= p[i - 1]);
})(), "並びが変わる、または安い順でない");
check("持っていない鉱物の豆知識は伏せる",
  d.querySelectorAll(".sfact.hide").length === 100,
  `${d.querySelectorAll(".sfact.hide").length}件`);

// 買えないときは押せない
ev("S.gum=0;render()");
check("GUMが0なら何も買えない",
  [...d.querySelectorAll(".mini[data-c]")].every(b => b.disabled));

// 買う
ev("S.gum=300;render()");
const cheap = d.querySelector(".mini[data-c]:not([disabled])");
const cheapId = cheap.dataset.c;
const cheapPrice = ev(`shopList(DB).find(c => c.id === "${cheapId}").price`);
cheap.click();
check("買うとGUMが減る", ev("S.gum") === 300 - cheapPrice, `${ev("S.gum")} / 価格 ${cheapPrice}`);
check("買ったぶんが手持ちに入る", ev(`S.crystals["${cheapId}"]`) === 1);
check("買うと豆知識が読める", d.querySelectorAll(".sfact.hide").length === 99,
  `伏せたまま ${d.querySelectorAll(".sfact.hide").length}件`);
check("高いものは買えないままにする",
  ev(`(() => { const d0 = shopList(DB).find(c => c.price > S.gum); return !!d0; })()`));

// 集めると重みが積み上がる
ev(`S.gum=100000;S.crystals={};render()`);
[...d.querySelectorAll(".mini[data-c]")].slice(0, 5).forEach(b => b.click());
check("5種そろう", ev("crystalKinds(S)") === 5, `${ev("crystalKinds(S)")}種`);
check("合計の重みは払ったGUMと同じ", ev(`(() => {
  const spent = 100000 - S.gum;
  return crystalsValue(S.crystals, DB.crystalById) === spent;
})()`), `使った ${ev("100000 - S.gum")} / 重み ${ev("crystalsValue(S.crystals, DB.crystalById)")}`);

// 5種で称号が開く
check("5種集めると「石を読む者」が開く",
  ev(`titleProgress(DB,S).find(t => t.id === "stone-reader").done`) === true,
  ev(`JSON.stringify(titleProgress(DB,S).find(t => t.id === "stone-reader"))`));
check("クリスタルは知識カードにならない",
  ev(`DB.crystals.crystals.every(c => !S.cards[c.name] && !S.cards[c.fact])`));
ev('S.gum=0;S.crystals={};S.view="home";render()');
check("アートを参照できる", ev(`assetPath.crystal("001")`).length > 0, ev(`assetPath.crystal("001")`));
check("豆知識が全種にある", ev(`DB.crystals.crystals.every(c => c.fact && c.fact.length > 8)`));

/* ---- レンジ回答（年代当て） ---- */
check("許容幅は古いほど広い", ev(`(() => {
  const w = [2011, 1945, 1600, 794, -2560].map(y => rangeWidth(y, 1, 2026));
  return w.every((v, i) => i === 0 || v > w[i - 1]);
})()`), ev("JSON.stringify([2011,1945,1600,794,-2560].map(y=>rangeWidth(y,1,2026)))"));
check("計画表の表と一致する", ev(`(() => {
  const want = { 2011: 12, 1989: 14, 1945: 18, 1868: 26, 1600: 53,
                 1467: 66, 1192: 93, 794: 133, "-221": 235, "-2560": 469 };
  return Object.entries(want).every(([y, w]) => rangeWidth(Number(y), 1, 2026) === w);
})()`));
check("許容幅は10〜500に収まる",
  ev("rangeWidth(2026,1,2026)") === 10 && ev("rangeWidth(-99999,1,2026)") === 500,
  `${ev("rangeWidth(2026,1,2026)")} / ${ev("rangeWidth(-99999,1,2026)")}`);
check("precisionで締めたり緩めたりできる",
  ev("rangeWidth(1600,0.5,2026)") < ev("rangeWidth(1600,1,2026)") &&
  ev("rangeWidth(1600,2,2026)") > ev("rangeWidth(1600,1,2026)"));

check("言い切って当てれば満点", ev("scoreRange(1467,1467,1467,66)") === 1000);
check("外せば0点", ev("scoreRange(1500,1600,1467,66)") === 0);
check("広く取るほど点は伸びない",
  ev("scoreRange(1450,1480,1467,66)") > ev("scoreRange(1400,1500,1467,66)"));
check("広すぎても下限50点は残る", ev("scoreRange(1000,1900,1467,66)") === 50);
check("順序を逆に入れても同じ",
  ev("scoreRange(1480,1450,1467,66)") === ev("scoreRange(1450,1480,1467,66)"));

// 画面から実際に答える
ev(`(() => {
  const q = DB.questions.find(x => x.format === "range");
  S.run = { ids: [q.id], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, found: [],
            gum: 0, results: {}, noReward: false, done: false };
  S.view = "quiz"; render();
})()`);
check("レンジ問題では選択肢を出さない",
  !!d.getElementById("ra") && d.querySelectorAll(".choices .choice").length === 0);
check("幅を入れるまで答えられない", d.getElementById("rsubmit").disabled);
check("点数の見込みは出さない", !/点/.test(d.getElementById("rlive").textContent),
  d.getElementById("rlive").textContent);

const ry = ev(`DB.byId[S.run.ids[0]].year`);
const rollsBefore = ev("S.run.found.length");
d.getElementById("ra").value = String(ry);
d.getElementById("rb").value = String(ry);
d.getElementById("ra").dispatchEvent(new w.Event("input", { bubbles: true }));
check("幅を入れると答えられる", !d.getElementById("rsubmit").disabled);
check("入れた幅を見せる", d.getElementById("rlive").textContent.includes("幅 0年"),
  d.getElementById("rlive").textContent);
d.getElementById("rsubmit").click();
check("採点される", ev("S.run.picked && S.run.picked.score") === 1000,
  ev("JSON.stringify(S.run.picked)"));
check("答えたあとに許容幅を明かす", d.getElementById("rlive").textContent.includes("許容幅"),
  d.getElementById("rlive").textContent);
check("正解として数える", ev("S.run.right") === 1);
// 幅を狭く言い切って当てたら、抽選がもう1回。確率なので「出た」ことは保証されない
check("精度が高いと抽選がもう1回",
  txt().includes("抽選がもう1回") && ev("S.run.found.length") >= rollsBefore,
  txt().slice(0, 80));
check("解説は出る", !!d.getElementById("next") && txt().includes("知識カード"));
check("二重に答えられない", (() => {
  const before = ev("S.run.right");
  ev("onRange(DB.byId[S.run.ids[0]])");
  return ev("S.run.right") === before;
})());

// 外したときも解説は出る（原則3）
ev(`(() => {
  const q = DB.questions.filter(x => x.format === "range")[1];
  S.run = { ids: [q.id], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, found: [],
            gum: 0, results: {}, noReward: false, done: false };
  S.view = "quiz"; render();
})()`);
d.getElementById("ra").value = "1000";
d.getElementById("rb").value = "1010";
d.getElementById("ra").dispatchEvent(new w.Event("input", { bubbles: true }));
d.getElementById("rsubmit").click();
check("外しても解説は出る", !!d.getElementById("next") && txt().includes("面白い単元"),
  txt().slice(0, 80));
check("外したら正解の年を明かす", d.getElementById("rlive").textContent.includes("正解は"),
  d.getElementById("rlive").textContent);
check("外したぶんは記録に残る", ev("S.run.wrong") === 1);

/* ---- 原則1: 到達度を上げるのは知識であって装備ではない ---- */
const gaugeEnv = `(() => {
  const st = JSON.parse(JSON.stringify(S));
  st.owned = { "10001": 1, "10002": 1, "10003": 1 };
  st.exts = { "5003": 1 };
  st.equip = {};
  st.cards = {};
  return st;
})()`;

check("知識が0なら装備も効かない", ev(`(() => {
  const st = ${gaugeEnv};
  st.equip = { "10001": "5003" };                       // Legendary を装備
  const g = gaugeBreakdown(DB, st, DB.heroById["3030"]);
  return g.percent === 0 && g.gear > 1;                 // 倍率は立つが、かける元が0
})()`) === true, "知識0でも到達度が出てしまう");

check("装備は到達度を最大で倍までしか上げない", ev(`(() => {
  const st = ${gaugeEnv};
  const hero = DB.heroById["3030"];
  hero.rel.cards.forEach(c => st.cards[c] = true);
  const bare = gaugeBreakdown(DB, st, hero);
  // 英雄をすべて解放し、全員に Legendary を装備しても、倍率は2倍で頭打ち
  DB.heroes.forEach(x => { st.owned[x.id] = 1; st.equip[x.id] = "5003"; });
  const geared = gaugeBreakdown(DB, st, hero);
  return bare.gear === 1 && geared.gear === 2 &&
         Math.abs(geared.reach - Math.min(1, bare.base * 2 / bare.factor)) < 1e-9;
})()`) === true, "装備の倍率が2倍を超えている");

check("装備をつければ到達度は動く", ev(`(() => {
  const st = ${gaugeEnv};
  const hero = DB.heroById["3030"];
  st.cards[hero.rel.cards[0]] = true;
  const bare = gaugeBreakdown(DB, st, hero).percent;
  st.equip = { "10001": "5003" };
  return gaugeBreakdown(DB, st, hero).percent > bare;
})()`) === true);

check("内訳は直結と関連に分かれて出る", ev(`(() => {
  const st = ${gaugeEnv};
  const hero = DB.heroById["3030"];
  st.cards[hero.rel.cards[0]] = true;
  const other = Object.keys(DB.cardSubject).find(c =>
    !c.endsWith("（応用）") && hero.rel.subjects.includes(DB.cardSubject[c]) &&
    !hero.rel.cards.includes(c));
  st.cards[other] = true;
  const rows = gaugeBreakdown(DB, st, hero).rows.map(r => r.label);
  return rows.some(l => l.startsWith("直結する知識カード")) &&
         rows.some(l => l.startsWith("関連分野の知識カード"));
})()`) === true);

check("総量ではなく網羅率で測る", ev(`(() => {
  const st = ${gaugeEnv};
  const hero = DB.heroById["3030"];
  hero.rel.cards.forEach(c => st.cards[c] = true);      // 直結を全部＝網羅率1
  const g = gaugeBreakdown(DB, st, hero);
  // 直結を埋めきっても、関連分野が空なら基礎は 0.6 のまま。問題が増えても飽和しない
  return Math.abs(g.base - 0.6) < 1e-9 && g.direct.rate === 1 && g.related.rate === 0;
})()`) === true);

check("難度係数が低いほど早く届く", ev(`(() => {
  const st = ${gaugeEnv};
  Object.keys(DB.cardSubject).forEach(c => st.cards[c] = true);
  const pct = r => {
    const h = DB.heroes.find(x => x.rarity === r && x.rel);
    return h ? gaugeBreakdown(DB, st, h).percent : null;
  };
  return pct("Common") >= pct("Legendary");
})()`) === true);

/* ---- 装備画面の before/after（docs/reward-economy.md §2）---- */
ev(`window.__cards = JSON.stringify(S.cards);
    Object.keys(DB.cardSubject).filter(c => !c.endsWith("（応用）"))
      .forEach((c, i) => { if (i % 5 === 0) S.cards[c] = true; });
    S.exts={"5003":1,"1001":1}; S.owned["10001"]=1; delete S.equip["10001"];
    S.heroView="10001"; go("hero")`);
check("装備画面に到達度が出る", /への到達度/.test(txt()), txt().slice(0, 120));
check("誰への到達度を見るか選べる", !!d.getElementById("gtarget"),
  d.querySelector(".reach")?.textContent);
check("装備の候補に、つけたときの到達度が並ぶ",
  [...d.querySelectorAll(".eqi em")].length >= 3,
  `${d.querySelectorAll(".eqi em").length}件`);
check("装備を切り替えると数字が動く", (() => {
  const before = d.querySelector(".rnum b").textContent;
  [...d.querySelectorAll(".eqi")].find(b => b.dataset.k === "1001").click();
  const after = d.querySelector(".rnum b").textContent;
  return after !== before && after.includes("→");
})(), d.querySelector(".rnum b")?.textContent);
check("分野が噛み合わない装備では動かない", (() => {
  // 劇作家の羽ペンは国語・外国語。算数・数学のピタゴラスへは効かない
  [...d.querySelectorAll(".eqi")].find(b => b.dataset.k === "5003").click();
  return !d.querySelector(".rnum b").textContent.includes("→");
})(), d.querySelector(".rnum b")?.textContent);
check("外せば元に戻る", (() => {
  [...d.querySelectorAll(".eqi")].find(b => b.dataset.k === "").click();
  return !d.querySelector(".rnum b").textContent.includes("→");
})(), d.querySelector(".rnum b")?.textContent);
ev('S.cards = JSON.parse(window.__cards); S.view="home"; render()');

check("レアリティが上がるほどゲージ寄与も上がる", ev(`(() => {
  const ids = ["1003", "2003", "3003", "4003", "5003"];
  const g = ids.map(id => DB.extensions[id].gauge);
  return g.every((v, i) => i === 0 || v > g[i - 1]);
})()`) === true);

check("実行時エラーなし", errs.length === 0, errs.slice(0, 3).join(" / "));
console.log(failed ? `\n${failed}件 失敗\n` : "\nすべて通過\n");
process.exit(failed ? 1 : 0);
