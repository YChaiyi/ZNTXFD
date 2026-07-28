#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

const date = process.argv[2];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node scripts/sync_digest_images.mjs YYYY-MM-DD");
  process.exit(2);
}

const runtimeRoot = process.env.GROUP_DIGEST_RUNTIME || path.join(os.homedir(), ".group-digest-runtime");
const runtimeOut = process.env.GROUP_DIGEST_OUT || path.join(runtimeRoot, "out");
const legacyOut = process.env.GROUP_DIGEST_LEGACY_OUT || path.join(
  os.homedir(),
  "Desktop",
  "项目",
  "群信息",
  "群精华",
);
const outputDir = process.env.ZNT_DIGEST_IMAGES_OUTPUT_DIR || path.join(
  process.cwd(),
  "public",
  "digest-images",
  date,
);

const groups = [
  { key: "group1", label: "一群", dir: "智能体先锋队一群-群精华项目", activeFrom: "2026-05-17" },
  { key: "group2", label: "二群", dir: "智能体先锋队二群-群精华项目", activeFrom: "2026-06-02" },
  { key: "group3", label: "三群", dir: "智能体先锋队三群-群精华项目", activeFrom: "2026-06-14" },
  { key: "group4", label: "四群", dir: "智能体先锋队四群-群精华项目", activeFrom: "2026-06-20" },
  { key: "group5", label: "五群", dir: "智能体先锋队五群-群精华项目", activeFrom: "2026-07-15" },
];

function findSource(group) {
  const roots = [runtimeOut, legacyOut];
  const names = [
    `${date}-v4-2x.png`,
    `${date}-v4.png`,
    `${date}-单群精华-v4-2x.png`,
    `${date}-单群精华-v4.png`,
  ];
  const candidates = roots.flatMap((root) =>
    names.map((name) => path.join(root, group.dir, name)),
  );
  return candidates.find((candidate) => fs.existsSync(candidate));
}

fs.mkdirSync(outputDir, { recursive: true });

let copied = 0;
let missing = 0;

for (const group of groups.filter((item) => date >= item.activeFrom)) {
  const source = findSource(group);
  if (!source) {
    console.warn(`WARN missing digest image: ${date} ${group.label}`);
    missing += 1;
    continue;
  }

  const output = path.join(outputDir, `${group.key}.avif`);
  let written = output;
  try {
    await sharp(source)
      .avif({ quality: 72, effort: 4 })
      .toFile(output);
  } catch {
    fs.rmSync(output, { force: true });
    const pngOutput = path.join(outputDir, `${group.key}.png`);
    fs.copyFileSync(source, pngOutput);
    written = pngOutput;
    console.warn(`WARN avif failed for ${date} ${group.label}; copied png fallback`);
  }
  copied += 1;
  console.log(`Wrote ${written}`);
}

console.log(`Digest images synced: copied=${copied}, missing=${missing}`);
if (copied === 0) {
  console.warn(`WARN no digest images available for ${date}; publishing daily content without images`);
}
