#!/usr/bin/env node
/* クリスタルのアートを public/materials/crystals/ に取り込む。
   出典は CC0（パブリックドメイン）で公開されている素材。
   商標には CC0 が及ばないため、ゲーム内では提供元の名称を使わない。
   実行は手動（毎回叩かない）。
   まずは 001-010 の10種だけ入れる。素材の種類が多すぎると、
   1種あたりの入手機会が薄まってクラフトが詰まるため。
   増やすときは COUNT を上げて再実行する（既存ファイルは上書きされるだけ）。
   使い方: node scripts/fetch-crystals.mjs [種類数]                  */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://cryptocrystalio.s3.us-west-1.amazonaws.com/crystals/characters";
const OUT = "public/materials/crystals";
const COUNT = Math.max(1, Math.min(100, Number(process.argv[2]) || 10));

await mkdir(join(ROOT, OUT), { recursive: true });

let ok = 0, ng = 0;
for (let i = 1; i <= COUNT; i++) {
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
console.log(`取得 ${ok}点 / 失敗 ${ng}点（001-${String(COUNT).padStart(3, "0")}）`);
