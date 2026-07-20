import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const outDir = join(packageRoot, "assets", "tray-providers");
const svgDir = join(packageRoot, "..", "app", "assets", "icons");

mkdirSync(outDir, { recursive: true });

const namedSvgs = [
  ["claude", "claude.svg"],
  ["codex", "codex.svg"],
];

async function writeTemplatePng(svgSource, outBase) {
  const blackSvg = svgSource
    .replace(/fill="currentColor"/g, 'fill="#000000"')
    .replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="#000000"');

  for (const [size, suffix] of [
    [16, ""],
    [32, "@2x"],
  ]) {
    const buf = await sharp(Buffer.from(blackSvg))
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    writeFileSync(join(outDir, `${outBase}${suffix}.png`), buf);
  }
}

for (const [id, file] of namedSvgs) {
  const path = join(svgDir, file);
  if (!existsSync(path)) {
    console.warn("skip missing", path);
    continue;
  }
  await writeTemplatePng(readFileSync(path, "utf8"), id);
  console.log("wrote", id);
}

const genericSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#000000"/></svg>';
await writeTemplatePng(genericSvg, "generic");
console.log("wrote generic");
