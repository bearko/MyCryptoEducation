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
check("GUMは桁区切りで出す", (() => {
  ev("S.gum=999999;render()");
  const ok = d.querySelector(".st-gum").textContent.includes("999,999");
  ev("S.gum=0;render()");
  return ok;
})());
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
check("ホームから魔石・カード枚数・英雄一覧を外した",
  !txt().includes("手持ちの英雄") && !d.querySelector(".gemrow"), txt().slice(0, 120));

// クラフトの通知ドットは、素材が足りているときだけ出す
check("素材0なら通知ドットなし", !d.querySelector("#tocraft .dot"));
const keptGems = ev("JSON.stringify(S.gems)");
ev("S.gems={ifrit:99,levia:99,tiamat:99,garuda:99};render()");
check("クラフトできると通知ドット", !!d.querySelector("#tocraft .dot"));
ev(`S.gems=${keptGems};render()`);

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

// 在庫が1セッションぶんに満たない範囲を選ぶ。以前はここで同じ問題が繰り返し出ていた。
// 問題を足すと在庫は変わるので、範囲（学年帯×教科）もデータから探す
const thin = ev(`(() => {
  for (const band of ["auto", "e", "j", "w"]) {
    const counts = inventoryBySubject(DB, S, band);
    const hit = Object.entries(counts).find(([, n]) => n > 0 && n < RUN_LENGTH);
    if (hit) return JSON.stringify({ band, subject: hit[0], n: hit[1] });
  }
  return "null";
})()`);
check("1セッションに満たない範囲がある（この検査の前提）", thin !== "null",
  "どの学年帯・教科も10問以上になった");
const { band: thinBand, subject: thinSub, n: thinN } = JSON.parse(thin);
// 学年帯を選び直すと教科は「おまかせ」に戻るので、帯を先に押す
if (thinBand !== "auto")
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

/* ---- 修正2: 解説スキップ ---- */
// レンジ回答が混ざるようになったので、この節は4択だけで組む
const answerChoice = () => {
  const i = ev("DB.byId[S.run.ids[S.run.i]].answer");
  const btns = d.querySelectorAll(".choices > .choice");
  btns[i].click();
};
ev(`(() => {
  const ids = DB.questions.filter(q => (q.format || "choice") === "choice").slice(0, 6).map(q => q.id);
  S.settings.showExplanationOnCorrect = true;
  startRun({ ids });
})()`);
let ai = ev("DB.byId[S.run.ids[S.run.i]].answer");
d.querySelectorAll(".choices > .choice")[ai].click();
check("ONなら解説が出る", !!d.getElementById("next") && txt().includes("知識カード"));
check("ONなら応用編ボタンが出る", !!d.getElementById("tostretch"));

ev('S.settings.showExplanationOnCorrect=false');
const before = ev("S.run.i");
d.getElementById("next").click();
ai = ev("DB.byId[S.run.ids[S.run.i]].answer");
d.querySelectorAll(".choices > .choice")[ai].click();
check("OFFなら解説パネルを出さない", !d.getElementById("next"));
check("OFFならトーストが出る", !!d.querySelector(".toast"), "toast なし");
await wait(950);
check("OFFなら自動で次へ進む", ev("S.run.i") === before + 2, `i=${ev("S.run.i")} (期待 ${before + 2})`);
check("トーストが消えている", !d.querySelector(".toast"));

// 不正解のときは設定に関わらず解説を出す
const q = ev("JSON.stringify({a:DB.byId[S.run.ids[S.run.i]].answer, n:DB.byId[S.run.ids[S.run.i]].choices.length})");
const { a, n } = JSON.parse(q);
d.querySelectorAll(".choices > .choice")[(a + 1) % n].click();
await wait(60);
check("OFFでも不正解なら解説が出る", !!d.getElementById("next") && txt().includes("面白い単元"));

/* ---- 報酬とチャレンジが壊れていないか ---- */
ev(`(() => {
  const ids = DB.questions.filter(q => (q.format || "choice") === "choice").slice(0, 10).map(q => q.id);
  S.settings.showExplanationOnCorrect = true;
  startRun({ ids });
})()`);
for (let k = 0; k < 10; k++) {

  const idx = ev("DB.byId[S.run.ids[S.run.i]].answer");
  const btns = d.querySelectorAll(".choices > .choice");
  if (!btns.length) break;
  btns[idx].click();
  const st = d.getElementById("tostretch");
  if (st) { st.click(); const ex = d.querySelectorAll("#exch > .choice");
    if (ex.length) ex[ev("DB.byId[S.run.ids[S.run.i]].applied.answer")].click(); }
  d.getElementById("next").click();
}
check("魔石が貯まる", ev("Object.values(S.gems).reduce((x,y)=>x+y,0)") > 0,
  ev("JSON.stringify(S.gems)"));

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

// Common は魔石だけで作れる
ev('S.gems={ifrit:0,levia:3,tiamat:0,garuda:0};S.exts={};S.crystals={};render()');
const common = [...d.querySelectorAll(".mini[data-k]")].filter(b => !b.disabled);
check("Commonは魔石だけで作れる", common.length === 1 && common[0].dataset.k === "1003",
  common.map(b => b.dataset.k).join(","));
common[0].click();
check("作ると魔石が減る", ev("S.gems.levia") === 0, `${ev("S.gems.levia")}`);
check("作ったものが手元に入る", ev(`S.exts["1003"]`) === 1);

// Uncommon はクリスタルが要る
ev('S.gems={ifrit:0,levia:5,tiamat:0,garuda:0};render()');
check("クリスタルが無いとUncommonは作れない",
  d.querySelector('.mini[data-k="2003"]').disabled);
ev('S.crystals={"003":7};render()');   // 銅8GUM ×7 = 56相当 ≧ 50
check("クリスタルがあれば作れる", !d.querySelector('.mini[data-k="2003"]').disabled);
check("使うクリスタルを前もって見せる", txt().includes("使うクリスタル"), txt().slice(0, 40));
d.querySelector('.mini[data-k="2003"]').click();
check("クリスタルは安いものから減る", ev(`S.crystals["003"] || 0`) === 0,
  `残り ${ev(`S.crystals["003"] || 0`)}`);

// Rare は下位を1つ食う
ev('S.gems={ifrit:0,levia:8,tiamat:0,garuda:0};S.crystals={"003":20};S.exts={};render()');
check("下位が無いとRareは作れない", d.querySelector('.mini[data-k="3003"]').disabled,
  `2003の所持 ${ev(`S.exts["2003"] || 0`)}`);
ev(`S.exts["2003"]=1;render()`);
check("下位があればRareを作れる", !d.querySelector('.mini[data-k="3003"]').disabled);
d.querySelector('.mini[data-k="3003"]').click();
check("Rareを作ると下位が消える", !ev(`S.exts["2003"]`), `残り ${ev(`S.exts["2003"] || 0`)}`);

// Legendary は知識カードの所持も条件
ev('S.gems={ifrit:0,levia:12,tiamat:0,garuda:0};S.crystals={"003":60};S.exts={"4003":1};render()');
const cardCount0 = ev("Object.keys(S.cards).length");
check("知識カードが足りないとLegendaryは作れない",
  cardCount0 >= 30 || d.querySelector('.mini[data-k="5003"]').disabled,
  `カード ${cardCount0}枚`);

ev('S.view="craft";S.craftTab="ペン";S.gems={ifrit:0,levia:0,tiamat:0,garuda:0};S.exts={};S.crystals={};render()');
d.querySelector(".mapbtn").click();

ev('S.view="home";render()');
d.getElementById("tochal").click();
check("挑戦先を選ぶ画面を挟む", txt().includes("どの英雄に挑むか"), txt().slice(0, 80));
check("削れ具合はここで見せる", /ゲージを \d+% 削れます/.test(txt()), txt().slice(0, 200));
check("未解放の英雄がすべて並ぶ",
  d.querySelectorAll(".trow").length === ev("lockedHeroes(DB,S).length"),
  `${d.querySelectorAll(".trow").length}件`);
d.querySelector(".trow").click();
check("チャレンジ画面", txt().includes("持っている知識で削る"));
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
check("Legendaryのゲージ上限は140", ev('DB.heroById["5016"].hp') === 140,
  String(ev('DB.heroById["5016"].hp')));
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
  gems: ev("Object.values(S.gems).reduce((a,b)=>a+b,0)"),
  cards: ev("Object.keys(S.cards).length"),
  runs: ev("S.runs"),
  score: ev("S.score"),
};
d.getElementById("replay").click();
check("再挑戦が始まる", ev("S.run.noReward") === true && ev("S.run.ids.length") > 0);
for (let i = 0; i < 40 && ev('S.view==="quiz"'); i++) {
  const btns = d.querySelectorAll(".choices > .choice");
  if (!btns.length) break;
  btns[ev(`DB.byId[S.run.ids[S.run.i]].answer`)].click();
  const n = d.getElementById("next");
  if (n) n.click(); else await wait(900);
}
const now = {
  gum: ev("S.gum"),
  gems: ev("Object.values(S.gems).reduce((a,b)=>a+b,0)"),
  cards: ev("Object.keys(S.cards).length"),
  runs: ev("S.runs"),
  score: ev("S.score"),
};
check("再挑戦では魔石が増えない", now.gems === had.gems, `${had.gems} -> ${now.gems}`);
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
check("クリスタルは10種", ev("DB.crystals.crystals.length") === 10,
  `${ev("DB.crystals.crystals.length")}種`);
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
check("どの鉱物も GUM あたりの重みが同じ", ev(`(() => {
  const es = DB.crystals.crystals.map(c => c.scarcity * crystalPrice(c.scarcity));
  return Math.max(...es) / Math.min(...es) < 1.05;   // ずれは整数への丸めぶんだけ
})()`), ev(`JSON.stringify(DB.crystals.crystals.map(c => +(c.scarcity * crystalPrice(c.scarcity)).toFixed(2)))`));
check("クラフトの重みは払ったGUMそのもの",
  ev(`DB.crystals.crystals.every(c => crystalValue(c.scarcity) === crystalPrice(c.scarcity))`));
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
check("10種すべて並ぶ", d.querySelectorAll(".shopitem").length === 10,
  `${d.querySelectorAll(".shopitem").length}件`);
check("品揃えは安い順で固定", (() => {
  const read = () => [...d.querySelectorAll(".shopitem .sn")].map(e => e.textContent.trim());
  const a = read(); ev("render()"); const b = read();
  const prices = ev("JSON.stringify(shopList(DB).map(c => c.price))");
  const p = JSON.parse(prices);
  return a.join("|") === b.join("|") && p.every((v, i) => i === 0 || v >= p[i - 1]);
})(), "並びが変わる、または安い順でない");
check("持っていない鉱物の豆知識は伏せる",
  d.querySelectorAll(".sfact.hide").length === 10);

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
check("買うと豆知識が読める", d.querySelectorAll(".sfact.hide").length === 9,
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
            gems: {}, right: 0, wrong: 0, appliedRight: 0, shortage: 0,
            gum: 0, results: {}, noReward: false, done: false };
  S.view = "quiz"; render();
})()`);
check("レンジ問題では選択肢を出さない",
  !!d.getElementById("ra") && d.querySelectorAll(".choices .choice").length === 0);
check("幅を入れるまで答えられない", d.getElementById("rsubmit").disabled);
check("点数の見込みは出さない", !/点/.test(d.getElementById("rlive").textContent),
  d.getElementById("rlive").textContent);

const ry = ev(`DB.byId[S.run.ids[0]].year`);
const gemsBefore = ev("Object.values(S.gems).reduce((a,b)=>a+b,0)");
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
check("精度が高いと魔石がもう1つ落ちる",
  ev("Object.values(S.gems).reduce((a,b)=>a+b,0)") - gemsBefore >= 2,
  `+${ev("Object.values(S.gems).reduce((a,b)=>a+b,0)") - gemsBefore}`);
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
            gems: {}, right: 0, wrong: 0, appliedRight: 0, shortage: 0,
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

/* ---- 原則1: 装備はゲージで知識を超えない ---- */
check("知識が0なら装備も効かない", ev(`(() => {
  const st = JSON.parse(JSON.stringify(S));
  st.cards = {}; st.owned = { "10001": 1, "10002": 1, "10003": 1 };
  st.exts = { "5003": 1 }; st.equip = { "10001": "5003" };
  return gaugeBreakdown(DB, st, DB.heroById["3030"]).damage;
})()`) === 0);

check("装備の合計は知識カードの合計を超えない", ev(`(() => {
  const st = JSON.parse(JSON.stringify(S));
  st.cards = {}; st.owned = { "10001": 1, "10002": 1, "10003": 1 };
  const hero = DB.heroById["3030"];
  st.cards[hero.rel.cards[0]] = true;                 // 直結1枚 = 8
  st.exts = { "5003": 1 }; st.equip = { "10001": "5003" };   // Legendary +60（噛み合えば120）
  const g = gaugeBreakdown(DB, st, hero);
  return g.damage;
})()`) === 16, "知識8 + 装備は同額まで = 16 のはず");

check("上限が効いたことを内訳に出す", ev(`(() => {
  const st = JSON.parse(JSON.stringify(S));
  st.cards = {}; st.owned = { "10001": 1, "10002": 1, "10003": 1 };
  const hero = DB.heroById["3030"];
  st.cards[hero.rel.cards[0]] = true;
  st.exts = { "5003": 1 }; st.equip = { "10001": "5003" };
  return gaugeBreakdown(DB, st, hero).rows.some(r => r.label === "装備は知識を超えない");
})()`) === true);

check("知識が増えれば装備も効くようになる", ev(`(() => {
  const st = JSON.parse(JSON.stringify(S));
  st.owned = { "10001": 1, "10002": 1, "10003": 1 };
  const hero = DB.heroById["3030"];
  st.cards = {}; hero.rel.cards.forEach(c => st.cards[c] = true);   // 直結4枚 = 32
  // damage は英雄のHPで頭打ちになるので、頭打ち前の raw で見る
  const bare = gaugeBreakdown(DB, st, hero).raw;
  st.exts = { "5003": 1 }; st.equip = { "10001": "5003" };
  const geared = gaugeBreakdown(DB, st, hero).raw;
  return geared === bare * 2;                                       // 装備は最大で倍まで
})()`) === true);

check("レアリティが上がるほどゲージ寄与も上がる", ev(`(() => {
  const ids = ["1003", "2003", "3003", "4003", "5003"];
  const g = ids.map(id => DB.extensions[id].gauge);
  return g.every((v, i) => i === 0 || v > g[i - 1]);
})()`) === true);

check("実行時エラーなし", errs.length === 0, errs.slice(0, 3).join(" / "));
console.log(failed ? `\n${failed}件 失敗\n` : "\nすべて通過\n");
process.exit(failed ? 1 : 0);
