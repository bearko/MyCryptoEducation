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
