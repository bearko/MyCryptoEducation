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
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* 環境によって Chromium の置き場所が違う。CHROMIUM_PATH があればそれを使う。
   **無ければ PLAYWRIGHT_BROWSERS_PATH の下を自分で探します。** playwright を
   上げると期待する版番号（chromium-1243 など）が動くのに、置いてある実体は
   古いままのことがあり、そのたびに「browsers を入れ直せ」と言われて止まります。
   実体はあるので、見つけて渡せば動きます                                        */
const findChromium = () => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return null;
  for (const d of readdirSync(root).filter(x => x.startsWith("chromium-")).sort().reverse()) {
    const exe = join(root, d, "chrome-linux", "chrome");
    if (existsSync(exe)) return exe;
  }
  return null;
};
const exe = findChromium();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
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

/* **盤面のマスが1つでも画面の外に出ていないか。**
   `document.elementFromPoint` は画面の外を拾えないので、はみ出したマスは
   **指でなぞれません**。図版の大きい問題で実際に3問はみ出しました */
const offBoard = async () => {
  const ids = await p.evaluate(`DB.questions.filter(q => q.mode === "panel").map(q => q.id)`);
  const bad = [];
  for (const id of ids) {
    const n = await p.evaluate(`(() => {
      const x = DB.byId["${id}"];
      S.run = { ids: [x.id], i: 0, picked: null, hintsUsed: 0, tipOpen: false, applied: null,
                right: 0, wrong: 0, appliedRight: 0, shortage: 0, gum: 0, results: {},
                noReward: true, done: false, hard: {} };
      S.view = "quiz"; render(); window.scrollTo(0, 0);
      return [...document.querySelectorAll(".pcell")].filter(e => {
        const r = e.getBoundingClientRect();
        return r.top < 0 || r.bottom > window.innerHeight;
      }).length;
    })()`);
    if (n) bad.push(`${id} ${n}マス`);
  }
  ok.push([`盤面のマスが全${ids.length}問とも画面の中にある`, bad.length === 0, bad.slice(0, 3).join(" / ")]);
};
await offBoard();
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

/* **はらったカードは、わざと画面の外へ飛ばしています**（`.swp-stage` が
   `overflow:hidden` で切る）。要素の矩形だけを見ると、この演出まで
   「はみ出し」と数えてしまう。見るべきは**ページが横に動くかどうか**のほう。
   前はたまたま最初のスワイプ問題の正解が右側で、カードが左へ飛んでいたので通っていた */
const swScroll = async label => {
  const r = await p.evaluate(`({
    scrollable: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    w: document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth,
  })`);
  ok.push([`スワイプの画面は横に動かない（${label}）`, !r.scrollable, r.w]);
};
await swScroll("はらったあと");
// 出題中の画面に戻して、切り取られていない要素のはみ出しも見る
await swipeSetup();
await swScroll("出題中");
const swOver = await p.evaluate(`(() => {
  const w = document.documentElement.clientWidth;
  return [...document.querySelectorAll("#app *")]
    .filter(e => e.getBoundingClientRect().right > w + 1)
    .filter(e => !e.closest(".swp-stage"))   // 演出で飛ばす場所は除く
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

/* ---- ヒントのポップアップ ------------------------------------------------
   **開いても元の画面が動かないこと。** 流れの中に置いていたころは、開いた
   瞬間に解答エリアが下へ押し出されて、答えるのにスクロールが要りました。
   jsdom には寸法が無いので、ここでしか確かめられません                     */
await p.evaluate(`(() => {
  const list = DB.questions.filter(q => q.mode === "elimination" && (q.hints || []).length >= 2);
  S.introDone = true; S.runs = 3;
  S.run = { ids: list.slice(0, 2).map(q => q.id), i: 0, picked: null, hintsUsed: 0,
            tipOpen: false, applied: null, found: [], cut: null, right: 0, wrong: 0,
            appliedRight: 0, shortage: 0, gum: 0, results: {}, noReward: true, done: false,
            hard: {}, verdict: null, hintOpen: false,
            plan: [{ mode: "elimination", n: 2, level: 1 }] };
  S.view = "quiz"; render(); window.scrollTo(0, 0);
})()`);
const hintBox = async () => p.evaluate(`(() => {
  const c = document.querySelector(".choices");
  return { top: Math.round(c.getBoundingClientRect().top),
           page: document.documentElement.scrollHeight,
           open: !!document.querySelector("#hintmodal .modal"),
           used: S.run.hintsUsed };
})()`);
const hBefore = await hintBox();
await p.click("#hint"); await p.waitForTimeout(250);
const hOpen = await hintBox();
ok.push(["ヒントを開いても解答エリアが動かない",
  hOpen.open && hOpen.top === hBefore.top && hOpen.page === hBefore.page,
  JSON.stringify({ hBefore, hOpen })]);
/* **ポップアップそのものが画面に収まっているか**を見ます。ページ全体の高さで
   見ていたころは、設問の帯が伸びただけで落ちていました（ポップアップは
   `position:fixed` なので、ページの高さとは関係がありません） */
const hSheet = await p.evaluate(`(() => {
  const el = document.querySelector("#hintmodal .msheet");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
})()`);
ok.push(["ヒントのポップアップが画面に収まる",
  !!hSheet && hSheet.top >= 0 && hSheet.bottom <= 844 + 1, JSON.stringify(hSheet)]);
await p.click("#hintmore"); await p.waitForTimeout(200);
const hMore = await hintBox();
await p.click("#hintclose"); await p.waitForTimeout(200);
const hShut = await hintBox();
await p.click("#hint"); await p.waitForTimeout(200);
const hAgain = await hintBox();
ok.push(["もう一段でだけ本数が増える（開き直しでは増えない）",
  hBefore.used === 0 && hOpen.used === 1 && hMore.used === 2 && hAgain.used === 2,
  JSON.stringify([hBefore.used, hOpen.used, hMore.used, hAgain.used])]);
ok.push(["とじると元の位置に戻る",
  !hShut.open && hShut.top === hBefore.top && hShut.page === hBefore.page,
  JSON.stringify(hShut)]);

/* ---- 黒ウィズ型リデザイン（見た目の崩れは、ここでしか捕まりません） ---- */

/** 消去法の1問を立てて、バトルの層ごと描く */
const battleUp = async () => p.evaluate(`(() => {
  const q = DB.questions.find(x => x.mode === "elimination" && x.subject === "国語");
  S.select.subject = "国語"; S.select.seed = 3;
  startRun({ built: { ids: [q.id], plan: [{ mode: "elimination", n: 1, level: 1 }] } });
  document.getElementById("wvgo").click();
  return true;
})()`);

/* **座標は書類の側で測ります。** ビューポート基準だと、playwright が
   押す前に要素を見える位置へスクロールした時点で数字が動きます
   （実際に「SSを開くと解答エリアが動いた」と出ました。動いたのは画面のほうです） */
const boxOf = async sel => p.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top + window.scrollY),
           w: Math.round(r.width), h: Math.round(r.height) };
})()`);

await battleUp();
await p.waitForTimeout(300);

/* **持ち時間のバーは幅ではなく transform を動かします**（width を動かすと
   再レイアウトが走ります）。細い帯のまま、横いっぱいに出ていること */
const tbar = await boxOf(".tbar");
ok.push(["持ち時間のバーが細い帯として出る",
  !!tbar && tbar.h <= 8 && tbar.w > 250, JSON.stringify(tbar)]);

/* 1秒たってもレイアウトが動かない（減るのは中の塗りだけ） */
const answersBefore = await boxOf(".choices");
await p.waitForTimeout(1000);
const answersAfter = await boxOf(".choices");
ok.push(["時間が減っても解答エリアが動かない",
  !!answersBefore && answersAfter.y === answersBefore.y, 
  JSON.stringify({ answersBefore, answersAfter })]);

/* **デッキ5枠が横に並ぶ。** 顔が読めない大きさに潰れていないこと */
const slots = await p.evaluate(`(() => {
  const list = [...document.querySelectorAll(".bt-slots .slot")];
  return list.map(el => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top),
             w: Math.round(r.width), h: Math.round(r.height) }; });
})()`);
ok.push(["デッキ5枠が横に並ぶ",
  slots.length === 5 && slots.every(s => s.y === slots[0].y) && slots.every(s => s.w >= 40),
  JSON.stringify(slots)]);
ok.push(["デッキ行が画面の外へはみ出さない", await p.evaluate(`(() => {
  const el = document.querySelector(".bt-deck");
  const r = el.getBoundingClientRect();
  return r.left >= -1 && r.right <= window.innerWidth + 1;
})()`), "bt-deck"]);

/* **チェインは右上**（黒ウィズと同じ位置） */
const chain = await p.evaluate(`(() => {
  const el = document.querySelector(".bt-chain");
  const s = document.querySelector(".bt-stage");
  if (!el || !s) return null;
  const r = el.getBoundingClientRect(), b = s.getBoundingClientRect();
  return { x: Math.round(r.left), fromTop: Math.round(r.top - b.top) };
})()`);
ok.push(["チェインはバトル層の右上に出る",
  !!chain && chain.x > 390 / 2 && chain.fromTop < 40, JSON.stringify(chain)]);

/* **SSのポップアップは元の画面を動かしません**（ヒントと同じ線） */
await p.evaluate(`(() => {
  const ext = Object.values(DB.extensions).find(e => DB.extSkills[e.id].effect <= 2);
  S.exts[ext.id] = 1;
  S.deckExt[S.run.battle.deck[0].id] = ext.id;
  S.run.battle.ss[0] = ssNeed(ext);
  drawBattle();
})()`);
await p.waitForTimeout(200);
const ssBefore = await boxOf(".choices");
await p.click(".bt-slots .slot.ready");
await p.waitForTimeout(250);
const ssOpen = await boxOf(".choices");
const sheet = await boxOf(".sssheet");
ok.push(["SSを開いても解答エリアが動かない",
  !!sheet && ssOpen.y === ssBefore.y, JSON.stringify({ ssBefore, ssOpen })]);
ok.push(["SSのポップアップが画面に収まる",
  !!sheet && sheet.h <= 844, JSON.stringify(sheet)]);
/* **開いているあいだは時計が止まります**（撃つかどうかの判断を急かさない） */
ok.push(["SSを開くと持ち時間が止まる", await p.evaluate("!!S.run.qPauseAt"), "qPauseAt"]);
await p.click("#ssclose"); await p.waitForTimeout(200);
ok.push(["とじると時計が動き出す", await p.evaluate("!S.run.qPauseAt"), "qPauseAt"]);

/* **デッキ編成（S-35）が1画面の幅に収まるか** */
await p.evaluate(`(() => { S.view = "deck"; render(); })()`);
await p.waitForTimeout(250);
ok.push(["デッキ編成が横にはみ出さない", await p.evaluate(`(() => {
  return [...document.querySelectorAll(".dk-slot, .dk-order, .dk-cost")]
    .every(el => { const r = el.getBoundingClientRect();
      return r.left >= -1 && r.right <= window.innerWidth + 1; });
})()`), "dk-*"]);
ok.push(["5枠ぶんが並ぶ", await p.evaluate(`document.querySelectorAll(".dk-slot").length`) === 5,
  String(await p.evaluate(`document.querySelectorAll(".dk-slot").length`))]);
/* **見せたいことは1つだけ —— 左が先で、右ほど落ちる** */
ok.push(["判定ごとにどこまで届くかが4段で出る",
  await p.evaluate(`document.querySelectorAll(".dk-j").length`) === 4,
  String(await p.evaluate(`document.querySelectorAll(".dk-j").length`))]);

ok.forEach(([n, v, x]) => console.log((v ? "✓ " : "✗ ") + n + (v ? "" : "  ← " + x)));
await b.close();
process.exit(ok.every(o => o[1]) ? 0 : 1);
