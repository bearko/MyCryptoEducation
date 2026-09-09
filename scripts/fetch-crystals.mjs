#!/usr/bin/env node
/* クリスタル100種のアートを public/materials/crystals/ に取り込む。
   出典は CC0（パブリックドメイン）で公開されている素材。
   商標には CC0 が及ばないため、ゲーム内では提供元の名称を使わない。
   実行は手動（毎回叩かない）。
   使い方: node scripts/fetch-crystals.mjs                          */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://cryptocrystalio.s3.us-west-1.amazonaws.com/crystals/characters";
const OUT = "public/materials/crystals";

await mkdir(join(ROOT, OUT), { recursive: true });

let ok = 0, ng = 0;
for (let i = 1; i <= 100; i++) {
  const id = String(i).padStart(3, "0");
  try {
    const res = await fetch(`${BASE}/${id}.png`);
    if (!res.ok) { ng++; console.warn(`  ${id} スキップ (${res.status})`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(join(ROOT, OUT, `${id}.webp`),
      await sharp(buf).resize(96, 96, { fit: "inside" }).webp({ quality: 86 }).toBuffer());
    ok++;
  } catch (e) { ng++; console.warn(`  ${id} 失敗: ${e.message}`); }
  await new Promise(r => setTimeout(r, 120));   // 相手先に負荷をかけない
}
console.log(`取得 ${ok}点 / 失敗 ${ng}点`);
