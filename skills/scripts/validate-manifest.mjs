import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "cards.json");
const cardsDir = path.join(root, "cards");

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "word";
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.cards)) return parsed.cards;
  throw new Error("cards.json must be either an array or an object with a cards array");
}

function duplicates(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

const cards = readManifest();
const pngFiles = new Set(fs.existsSync(cardsDir) ? fs.readdirSync(cardsDir).filter((file) => file.endsWith(".png")) : []);
const manifestFiles = cards.map((card) => card.file);
const missing = manifestFiles.filter((file) => !pngFiles.has(file));
const orphan = [...pngFiles].filter((file) => !manifestFiles.includes(file));

const issues = {
  entries: cards.length,
  pngFiles: pngFiles.size,
  duplicateWords: duplicates(cards.map((card) => String(card.word || "").trim().toLowerCase())),
  duplicateSlugs: duplicates(cards.map((card) => card.slug || slugify(card.word))),
  duplicateFiles: duplicates(manifestFiles),
  missing,
  orphan,
};

console.log(JSON.stringify(issues, null, 2));

if (
  issues.duplicateWords.length ||
  issues.duplicateSlugs.length ||
  issues.duplicateFiles.length ||
  issues.missing.length
) {
  process.exit(1);
}
