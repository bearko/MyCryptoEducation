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
check("ショップは準備中で押せない", d.getElementById("toshop").disabled);
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
// 開始時は第3・4章が未解放なので、在庫は38問中25問
check("在庫バッジが出ている", /おまかせ\s*25/.test(txt()), txt().slice(0, 160));
check("未解放の教科は選べない",
  [...d.querySelectorAll("#sub button")].find(b => b.dataset.k === "情報").disabled);

// 外国語（解放済み在庫1問）を選ぶ。以前はここで同じ問題が10回出ていた
[...d.querySelectorAll("#sub button")].find(b => b.dataset.k === "外国語").click();
check("在庫不足の警告", txt().includes("この範囲は現在 1問です"), txt().slice(0, 200));
check("開始ボタンが問題数に追従", d.getElementById("start").textContent.includes("1問を始める"));

d.getElementById("start").click();
const ids = ev("JSON.stringify(S.run.ids)");
const arr = JSON.parse(ids);
check("在庫1問なら1問だけ出す（旧: 同じ問題が10回）", arr.length === 1, ids);
check("同じ問題が出ない", new Set(arr).size === arr.length, ids);

// おまかせで10問
ev('S.view="select";S.select.subject="auto";render()');
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
ev('S.view="select";S.select.subject="auto";S.settings.showExplanationOnCorrect=true;render()');
d.getElementById("start").click();
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
ev('S.settings.showExplanationOnCorrect=true;S.view="select";render()');
d.getElementById("start").click();
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

const c = d.getElementById("craft");
if (c) { c.click(); const m = [...d.querySelectorAll(".mini")].filter(b => !b.disabled);
  check("クラフトできる", m.length > 0); if (m.length) m[0].click();
  d.querySelector(".mapbtn").click(); }

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
const ans = JSON.parse(ev("JSON.stringify(DB.heroById[S.challenge.heroId].ch.ans)"));
const input = d.getElementById("ans");
check("入力欄が出る", !!input, `相手=${hero}`);
if (input) {
  input.value = "でたらめ"; d.getElementById("submit").click();
  check("誤答をはじく", !ev("S.challenge.done"));
  d.getElementById("ans").value = ans[1] || ans[0];
  d.getElementById("submit").click();
  check("正答で解放", ev("S.challenge.done") === true);
}

// 解放すると出題範囲が広がる
ev('S.owned["4007"]=1;S.owned["5016"]=1;S.view="select";S.select.subject="auto";render()');
check("解放で在庫が増える", /おまかせ\s*38/.test(txt()), txt().slice(0, 140));

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
check("族は対応表にある", ev(`DB.crystals.crystals.every(c => CRYSTAL_FAMILIES[c.family])`),
  ev(`JSON.stringify([...new Set(DB.crystals.crystals.map(c => c.family))])`));
check("アートを参照できる", ev(`assetPath.crystal("001")`).length > 0, ev(`assetPath.crystal("001")`));
check("豆知識が全種にある", ev(`DB.crystals.crystals.every(c => c.fact && c.fact.length > 8)`));

check("実行時エラーなし", errs.length === 0, errs.slice(0, 3).join(" / "));
console.log(failed ? `\n${failed}件 失敗\n` : "\nすべて通過\n");
process.exit(failed ? 1 : 0);
