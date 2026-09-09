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

/* ---- 修正1: 重複しない出題 ---- */
d.getElementById("toquiz").click();
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
check("リザルトに到達", !!d.getElementById("again"), txt().slice(0, 80));

const c = d.getElementById("craft");
if (c) { c.click(); const m = [...d.querySelectorAll(".mini")].filter(b => !b.disabled);
  check("クラフトできる", m.length > 0); if (m.length) m[0].click();
  d.querySelector(".mapbtn").click(); }

ev('S.view="home";render()');
d.getElementById("tochal").click();
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

check("実行時エラーなし", errs.length === 0, errs.slice(0, 3).join(" / "));
console.log(failed ? `\n${failed}件 失敗\n` : "\nすべて通過\n");
process.exit(failed ? 1 : 0);
