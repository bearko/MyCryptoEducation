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

ok.forEach(([n, v, x]) => console.log((v ? "✓ " : "✗ ") + n + (v ? "" : "  ← " + x)));
await b.close();
process.exit(ok.every(o => o[1]) ? 0 : 1);
