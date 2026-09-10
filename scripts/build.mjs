#!/usr/bin/env node
/* データ・画像・スクリプトを1枚のHTMLに畳んで dist/index.html を作る。
   ローカルでサーバを立てずに開けるので、テストプレイの配布に使う。
   使い方: npm run build                                            */

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFile(join(ROOT, p), "utf8");
const json = async p => JSON.parse(await read(p));

/* --- データ --- */
const questions = [];
for (const f of (await readdir(join(ROOT, "data/questions"))).filter(f => f.endsWith(".json"))) {
  questions.push(...await json(`data/questions/${f}`));
}
const db = {
  questions,
  figures:    await json("data/figures.json"),
  heroes:     await json("data/heroes.json"),
  extensions: await json("data/extensions.json"),
  gemstones:  await json("data/gemstones.json"),
  advice:     await json("data/advice.json"),
  titles:     await json("data/titles.json"),
};

/* --- 画像を data URI に --- */
const MIME = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const assets = {};
async function embed(dir, prefix) {
  let files;
  try { files = await readdir(join(ROOT, dir)); } catch { return; }
  for (const f of files) {
    const ext = extname(f);
    if (!MIME[ext]) continue;
    const buf = await readFile(join(ROOT, dir, f));
    assets[prefix + f.slice(0, -ext.length)] = `data:${MIME[ext]};base64,${buf.toString("base64")}`;
  }
}
await embed("public/heroes", "h");
await embed("public/materials/gemstones", "g");
await embed("public/icons", "i");
await embed("public/extensions", "e");
/* 背景は縮小コピーのほうを畳む。1080px のまま base64 にすると配布ファイルが実用外の大きさになる */
await embed("public/backgrounds/small", "b");

/* --- スクリプト（import/export を剥がして結合） --- */
const ORDER = ["normalize.js", "engine.js", "data.js", "state.js", "views.js", "main.js"];
const sources = [];
for (const f of ORDER) {
  let src = await read(`src/${f}`);
  src = src
    .replace(/^\s*import[\s\S]*?from\s*["'][^"']+["'];\s*$/gm, "")
    .replace(/^\s*export\s+(const|function|async function|class|let)\s/gm, "$1 ")
    .replace(/^\s*export\s*\{[^}]*\};\s*$/gm, "");
  sources.push(`/* ===== src/${f} ===== */\n${src.trim()}`);
}

const css = await read("src/styles.css");

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>世界の教室</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22%23FBFBF7%22%2F%3E%3Cpath%20d%3D%22M0%2010.5h32M0%2021.5h32M10.5%200v32M21.5%200v32%22%20stroke%3D%22%23E0E8EC%22%20stroke-width%3D%221%22%2F%3E%3Cpath%20d%3D%22M7%2022%20L16%207%20L25%2022%22%20fill%3D%22none%22%20stroke%3D%22%2317243F%22%20stroke-width%3D%222.6%22%20stroke-linejoin%3D%22round%22%20stroke-linecap%3D%22round%22%2F%3E%3Cpath%20d%3D%22M6%2026h20%22%20stroke%3D%22%23C4362C%22%20stroke-width%3D%222.6%22%20stroke-linecap%3D%22round%22%2F%3E%3C%2Fsvg%3E">
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<script>
globalThis.__ASSETS__ = ${JSON.stringify(assets)};
globalThis.__EMBEDDED_DB__ = ${JSON.stringify(db)};
${sources.join("\n\n")}
</script>
</body>
</html>
`;

await mkdir(join(ROOT, "dist"), { recursive: true });
await writeFile(join(ROOT, "dist/index.html"), html);
console.log(`dist/index.html を作成しました  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
console.log(`  問題 ${questions.length}問 / 画像 ${Object.keys(assets).length}点`);
