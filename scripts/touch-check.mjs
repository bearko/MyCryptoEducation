#!/usr/bin/env node
/* 文字パネルを実物のブラウザで、タッチのポインタでなぞる。
   jsdom では座標も暗黙のポインタキャプチャも再現できないので、ここだけ実機に近い形で見る。
   実行は手動。playwright が要る（npm install --no-save playwright）。
   使い方: npm run build && node scripts/touch-check.mjs
   Chromium の場所が既定でない環境では CHROMIUM_PATH で渡す

   これを足したのは、実機で「最初にタップした1文字目しか反応しない」と報告されたため。
   タッチでは pointerdown したマスにポインタがキャプチャされ、他のマスに
   pointerenter が飛ばない。キャプチャを放し、座標から指の下のマスを引いて直した。   */

import { chromium } from "playwright";
/* 環境によって Chromium の置き場所が違う。CHROMIUM_PATH があればそれを使う */
const b = await chromium.launch(process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const ok = [];
await p.goto("file:///home/user/MyCryptoEducation/dist/index.html");
await p.waitForTimeout(500);

const setup = async () => p.evaluate(`(() => {
  const q = DB.questions.find(x => x.mode === "panel" && x.panel.size === 3);
  S.run = { ids: [q.id], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null, found: [],
            right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, results: {},
            noReward: true, done: false, hard: {} };
  S.view = "quiz"; render();
  return { reading: q.reading, path: q.panel.path };
})()`);

const centers = async path => p.evaluate(`(${JSON.stringify(path)}).map(i => {
  const r = document.querySelector('.pcell[data-i="' + i + '"]').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})`);

// ① 指でなぞる（タッチのポインタで pointerdown → move → up）
let q = await setup();
let pts = await centers(q.path);
await p.mouse.move(pts[0].x, pts[0].y);
await p.dispatchEvent(`.pcell[data-i="${q.path[0]}"]`, "pointerdown",
  { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: pts[0].x, clientY: pts[0].y, buttons: 1 });
for (const pt of pts.slice(1)) {
  await p.dispatchEvent(".panelwrap", "pointermove",
    { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: pt.x, clientY: pt.y, buttons: 1 });
}
const traced = await p.evaluate("document.getElementById('pword').textContent");
ok.push(["なぞりで全文字ひろえる", traced === q.reading, `${traced} / 正 ${q.reading}`]);
await p.evaluate(`document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, pointerType: "touch" }))`);
await p.waitForTimeout(60);
ok.push(["指を離すと確定する", await p.evaluate("S.run.picked !== null"), ""]);

// ② 一度タップしたあとでも、なぞりが効く
q = await setup();
pts = await centers(q.path);
await p.tap(`.pcell[data-i="${q.path[0]}"]`);
await p.waitForTimeout(30);
await p.dispatchEvent(`.pcell[data-i="${q.path[0]}"]`, "pointerdown",
  { pointerId: 2, pointerType: "touch", isPrimary: true, clientX: pts[0].x, clientY: pts[0].y, buttons: 1 });
for (const pt of pts.slice(1)) {
  await p.dispatchEvent(".panelwrap", "pointermove",
    { pointerId: 2, pointerType: "touch", isPrimary: true, clientX: pt.x, clientY: pt.y, buttons: 1 });
}
await p.evaluate(`document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, pointerType: "touch" }))`);
await p.waitForTimeout(60);
ok.push(["タップのあとでも、なぞりが確定する", await p.evaluate("S.run.picked !== null"), ""]);


/* 全問をなぞって、途中のマスが混ざらないか見る。
   ななめにたどると指は隣のマスの角をかすめるので、枠に入っただけで拾う作りだと
   通り過ぎたマスが混ざる。実際に137/160問で混ざっていた。
   指のぶれを何段階か変えて試す。                                              */
const sweep = async wobble => {
  const ids = await p.evaluate(`DB.questions.filter(q => q.mode === "panel").map(q => q.id)`);
  const bad = [];
  for (const id of ids) {
    const q = await p.evaluate(`(() => {
      const x = DB.byId["${id}"];
      S.run = { ids: [x.id], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
                right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, results: {},
                noReward: true, done: false, hard: {} };
      S.view = "quiz"; render(); window.scrollTo(0, 0);
      return { reading: x.reading, path: x.panel.path };
    })()`);
    const pts = await centers(q.path);
    await p.dispatchEvent(`.pcell[data-i="${q.path[0]}"]`, "pointerdown", { pointerId: 9,
      pointerType: "touch", isPrimary: true, clientX: pts[0].x, clientY: pts[0].y, buttons: 1 });
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], c = pts[k];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      const nx = -(c.y - a.y) / len, ny = (c.x - a.x) / len;
      for (let t = 1; t <= 14; t++) {
        const u = t / 14, w = Math.sin(u * Math.PI) * wobble;
        await p.dispatchEvent(".panelwrap", "pointermove", { pointerId: 9, pointerType: "touch",
          isPrimary: true, buttons: 1,
          clientX: a.x + (c.x - a.x) * u + nx * w, clientY: a.y + (c.y - a.y) * u + ny * w });
      }
    }
    const got = await p.evaluate("document.getElementById('pword').textContent");
    if (got !== q.reading) bad.push(`${id} 正 ${q.reading} → ${got}`);
    await p.evaluate(`document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9, pointerType: "touch" }))`);
  }
  ok.push([`ぶれ${wobble}pxでも全${ids.length}問をなぞれる`, bad.length === 0, bad.slice(0, 3).join(" / ")]);
};
for (const w of [3, 9, 14]) await sweep(w);

/* ---- 画面が崩れていないか（実寸で見る）----------------------------------
   jsdom には寸法が無いので、通しテストではレイアウトの崩れを捕まえられない。
   実際に、消去法の ✕ ボタンに `.cut` と付けたら、帯の `class="band cut"` と
   ぶつかって帯が幅46pxの縦長の塊になった。クラス名の衝突は見た目にしか出ない。   */
const box = sel => p.evaluate(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
})()`);

await p.evaluate(`(() => {
  const q = DB.questions.find(x => x.mode === "elimination");
  S.run = { ids: [q.id], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
            found: [], cut: null, right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0,
            results: {}, noReward: true, done: false, hard: {} };
  S.view = "quiz"; render();
})()`);

const view = await p.evaluate("({ w: innerWidth, h: innerHeight })");
const band = await box(".band");
ok.push(["帯は横いっぱいの細い帯", !!band && band.w > view.w * 0.7 && band.h < 60,
  band ? `幅${Math.round(band.w)} 高さ${Math.round(band.h)}（画面幅${view.w}）` : "帯が無い"]);

const xbtn = await box(".xcut");
const row0 = await box('.row[data-r="0"] .choice');
ok.push(["✕ は文字の左に、指で押せる大きさで並ぶ",
  !!xbtn && !!row0 && xbtn.w >= 40 && xbtn.h >= 40 && xbtn.x + xbtn.w <= row0.x + 1,
  xbtn ? `✕ ${Math.round(xbtn.w)}x${Math.round(xbtn.h)} / 文字の左端 ${Math.round(row0?.x)}` : "✕ が無い"]);

const rows = await p.evaluate(`[...document.querySelectorAll(".choices.elim .row")].map(e => {
  const r = e.getBoundingClientRect(); return { y: r.top, w: r.width };
})`);
ok.push(["選択肢は縦に重ならずに並ぶ",
  rows.length === 4 && rows.every((r, i) => i === 0 || r.y > rows[i - 1].y) &&
  rows.every(r => r.w > view.w * 0.7),
  JSON.stringify(rows.map(r => Math.round(r.y)))]);

/* 4択への降り口は、選択肢の下に、指で押せる大きさで出ているか。
   消去法では文字が押せないぶん、ここが唯一の逃げ道になる                      */
const lastRow = await p.evaluate(`(() => {
  const e = [...document.querySelectorAll(".choices.elim .row")].pop();
  const r = e.getBoundingClientRect(); return { y: r.bottom };
})()`);
const downBtn = await box("#tochoice");
ok.push(["4択への降り口が選択肢の下に出る",
  !!downBtn && downBtn.y > lastRow.y && downBtn.h >= 28 && downBtn.w >= 60,
  downBtn ? `y${Math.round(downBtn.y)} / 選択肢の下端 ${Math.round(lastRow.y)} / ${Math.round(downBtn.w)}x${Math.round(downBtn.h)}` : "降り口が無い"]);

// 画面の外へはみ出していないか
const over = await p.evaluate(`(() => {
  const w = document.documentElement.clientWidth;
  return [...document.querySelectorAll("#app *")]
    .filter(e => e.getBoundingClientRect().right > w + 1)
    .slice(0, 3).map(e => e.className || e.tagName);
})()`);
ok.push(["横にはみ出す要素が無い", over.length === 0, over.join(" / ")]);

/* ---- スワイプ（はらう向きがそのまま答え）--------------------------------
   jsdom には座標も寸法も無いので、「はらう」は通しテストでは確かめられない。
   押しても答えられるようにはしてあるが、**指ではらって答えられなければ
   この形式は成立しない**ので、ここで実際にドラッグする。              */
const swipeSetup = async () => p.evaluate(`(() => {
  const list = DB.questions.filter(q => q.mode === "swipe");
  S.run = { ids: list.slice(0, 2).map(q => q.id), i: 0, picked: null, hintsUsed: 0,
            tipOpen: false, applied: null, found: [], cut: null, right: 0, wrong: 0,
            appliedRight: 0, shortage: 0, gum: 0, results: {}, noReward: true,
            done: false, hard: {}, swipe: true, plan: [{ mode: "swipe", n: 2 }] };
  S.view = "quiz"; render(); window.scrollTo(0, 0);
  const q = DB.byId[S.run.ids[0]];
  return { id: q.id, answer: q.answer };
})()`);

const dragCard = async (dx, steps = 12) => {
  const r = await box("#swpcard");
  const y = r.y + r.h / 2, x = r.x + r.w / 2;
  await p.dispatchEvent("#swpcard", "pointerdown", { pointerId: 21, pointerType: "touch",
    isPrimary: true, clientX: x, clientY: y, buttons: 1 });
  for (let t = 1; t <= steps; t++) {
    await p.evaluate(`document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 21,
      pointerType: "touch", isPrimary: true, bubbles: true,
      clientX: ${x + (dx * t) / steps}, clientY: ${y} }))`);
  }
  return { x, y, end: x + dx };
};
const dropCard = async end => p.evaluate(`document.dispatchEvent(
  new PointerEvent("pointerup", { pointerId: 21, pointerType: "touch", bubbles: true,
    clientX: ${end}, clientY: 0 }))`);

let sq = await swipeSetup();
const swView = await p.evaluate("({ w: innerWidth, h: innerHeight })");

// 画面の並び: 問い → 左右の答え → カード。カードは画面に収まっているか
const swCard = await box("#swpcard");
const swPicks = await p.evaluate(`[...document.querySelectorAll(".swp-pick")].map(e => {
  const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };
})`);
ok.push(["左右の答えが横に2つ並ぶ",
  swPicks.length === 2 && swPicks[0].x + swPicks[0].w <= swPicks[1].x + 1 &&
  swPicks.every(b => b.h >= 44 && b.w > 80),
  JSON.stringify(swPicks.map(b => `${Math.round(b.w)}x${Math.round(b.h)}`))]);
ok.push(["カードは答えの下に、画面に収まって出る",
  !!swCard && swCard.y > swPicks[0].y && swCard.w <= swView.w - 24 && swCard.h > 80,
  swCard ? `${Math.round(swCard.w)}x${Math.round(swCard.h)} @${Math.round(swCard.y)}` : "カードが無い"]);

// ① 少しだけ動かして放す → 戻る（**踏み切る前なら取り消せる**）
let d1 = await dragCard(-24);
const leaned = await p.evaluate(`document.querySelector(".swp-pick.l").classList.contains("on")`);
await dropCard(d1.end);
await p.waitForTimeout(80);
ok.push(["少し動かすと、その側が光る", leaned === true]);
ok.push(["途中で放せば答えにならない", await p.evaluate("S.run.picked === null"),
  String(await p.evaluate("S.run.picked"))]);

// ② しっかりはらう → その向きの答えで確定する
sq = await swipeSetup();
const want = sq.answer === 0 ? -140 : 140;
const d2 = await dragCard(want);
await dropCard(d2.end);
await p.waitForTimeout(120);
ok.push(["はらった向きの答えで確定する",
  await p.evaluate(`S.run.results[${JSON.stringify(sq.id)}] === "ok"`),
  String(await p.evaluate(`S.run.results[${JSON.stringify(sq.id)}]`))]);
ok.push(["○ がカードの上に大きく出る", await p.evaluate(`(() => {
  const s = document.getElementById("swpseal");
  if (!s || s.textContent !== "○") return false;
  const r = s.getBoundingClientRect(), c = document.getElementById("swpcard").getBoundingClientRect();
  return parseFloat(getComputedStyle(s).fontSize) >= 60
    && r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
})()`), await p.evaluate(`document.getElementById("swpseal")?.textContent`)]);

// ③ 逆へはらえば外れる。**外しても罰は無い**ので、知識カードは入る
sq = await swipeSetup();
const wrongWay = sq.answer === 0 ? 140 : -140;
const d3 = await dragCard(wrongWay);
await dropCard(d3.end);
await p.waitForTimeout(120);
ok.push(["逆へはらえば ✕ になる",
  await p.evaluate(`document.getElementById("swpseal")?.textContent === "✕"`)]);

const swOver = await p.evaluate(`(() => {
  const w = document.documentElement.clientWidth;
  return [...document.querySelectorAll("#app *")]
    .filter(e => e.getBoundingClientRect().right > w + 1)
    .slice(0, 3).map(e => e.className || e.tagName);
})()`);
ok.push(["スワイプの画面も横にはみ出さない", swOver.length === 0, swOver.join(" / ")]);

/* ---- 形式の束の帯（ヘッダ）----------------------------------------------
   3つの束が、問題数に比例した幅で並ぶ。狭い端末で名前がつぶれていないか見る  */
await p.evaluate(`(() => {
  const r = planRun(DB, S, { subject: "auto" });
  S.run = { ids: r.ids, i: r.plan[0].n, picked: null, hintsUsed: 0, tipOpen: false,
            applied: null, found: [], cut: null, right: 0, wrong: 0, appliedRight: 0,
            shortage: 0, gum: 0, results: {}, noReward: true, done: false, hard: {},
            plan: r.plan };
  S.view = "quiz"; render(); window.scrollTo(0, 0);
})()`);
const segs = await p.evaluate(`[...document.querySelectorAll(".pseg")].map(e => {
  const r = e.getBoundingClientRect();
  return { w: r.width, h: r.height, x: r.left, on: e.classList.contains("on"),
           done: e.classList.contains("done"), label: e.querySelector("b").textContent.trim(),
           lw: e.querySelector("b").getBoundingClientRect().width };
})`);
ok.push(["形式の束が3つ、横に並ぶ",
  segs.length === 3 && segs.every((s, i) => i === 0 || s.x > segs[i - 1].x) &&
  segs.every(s => s.w > 24 && s.h >= 12),
  JSON.stringify(segs.map(s => `${s.label}${Math.round(s.w)}`))]);
ok.push(["いま解いている束だけが光る",
  segs.filter(s => s.on).length === 1 && segs[0].done && segs[1].on,
  JSON.stringify(segs.map(s => (s.done ? "done" : s.on ? "on" : "-")))]);
// 幅は問題数に比例する。重い形式の束が長く見えないように
ok.push(["束の幅は問題数なり", await p.evaluate(`(() => {
  const plan = S.run.plan;
  const w = [...document.querySelectorAll(".pseg")].map(e => e.getBoundingClientRect().width);
  const unit = w.map((x, i) => x / plan[i].n);
  return Math.max(...unit) - Math.min(...unit) < 2.5;
})()`), JSON.stringify(segs.map(s => Math.round(s.w)))]);
ok.push(["束の名前がつぶれていない", segs.every(s => s.lw >= 20 && s.label.length >= 2),
  JSON.stringify(segs.map(s => `${s.label}:${Math.round(s.lw)}`))]);

ok.forEach(([n, v, x]) => console.log((v ? "✓ " : "✗ ") + n + (v ? "" : "  ← " + x)));
await b.close();
process.exit(ok.every(o => o[1]) ? 0 : 1);
