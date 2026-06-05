const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function usage() {
  console.error("Usage: node sync_dictionary.js <input.json> <png-dir> <voca-dictionary-dir>");
}

function slugify(value) {
  return String(value || "word")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "word";
}

function compact(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function nowInVietnam() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}+07:00`;
}

function cleanTopic(value) {
  return compact(value).replace(/^TOEIC:\s*/i, "") || "General";
}

function tagValues(entry) {
  const topic = cleanTopic(entry.topic);
  const pos = compact(entry.partOfSpeech).split("/")[0].trim();
  return [topic.toLowerCase(), pos.toLowerCase(), "custom"].filter(Boolean);
}

function pronunciationValue(entry) {
  return compact(entry.pronunciation || entry.ipa || entry.IPA);
}

function createdAtValue(entry) {
  return compact(entry.createdAt || entry.created_at) || nowInVietnam();
}

function createdAtRank(entry) {
  const timestamp = Date.parse(entry.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function levelValue(entry) {
  const value = compact(entry.level).toLowerCase();
  return ["new", "learning", "known", "mastered"].includes(value) ? value : "new";
}

function stripExtendedAttributes(filePath) {
  if (process.platform !== "darwin") {
    return;
  }
  try {
    execFileSync("xattr", ["-c", filePath], { stdio: "ignore" });
  } catch {
    // Best effort only: the copied PNG is still valid if xattr is unavailable.
  }
}

function manifestEntry(entry, filename) {
  const item = {
    word: compact(entry.word),
    file: filename,
    partOfSpeech: compact(entry.partOfSpeech) || "unknown",
    topic: cleanTopic(entry.topic),
    tags: tagValues(entry),
    createdAt: createdAtValue(entry),
    level: levelValue(entry),
  };
  const pronunciation = pronunciationValue(entry);
  if (pronunciation) {
    item.pronunciation = pronunciation;
  }
  return item;
}

function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, data, "utf8");
  fs.renameSync(tempPath, filePath);
}

function main() {
  const [inputPath, pngDir, dictionaryDir] = process.argv.slice(2);
  if (!inputPath || !pngDir || !dictionaryDir) {
    usage();
    process.exit(1);
  }

  const entries = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(entries)) {
    throw new Error("Input JSON must be an array of vocabulary entries.");
  }

  const dictionaryCardsDir = path.join(dictionaryDir, "cards");
  const manifestPath = path.join(dictionaryDir, "cards.json");
  if (!fs.existsSync(dictionaryDir)) {
    throw new Error(`Dictionary not found: ${dictionaryDir}`);
  }
  if (!fs.existsSync(manifestPath)) {
    writeJsonAtomic(manifestPath, "[]\n");
  }
  fs.mkdirSync(dictionaryCardsDir, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const seenWords = new Set(manifest.map((item) => compact(item.word).toLowerCase()));
  const seenFiles = new Set(manifest.map((item) => compact(item.file).toLowerCase()));
  const seenSlugs = new Set(manifest.map((item) => slugify(item.word || item.file)));
  const copied = [];
  const skipped = [];

  for (const entry of entries) {
    const word = compact(entry.word);
    const slug = slugify(word);
    const filename = `${slug}.png`;
    const sourcePng = path.join(pngDir, filename);
    const targetPng = path.join(dictionaryCardsDir, filename);
    const duplicate = seenWords.has(word.toLowerCase())
      || seenFiles.has(filename.toLowerCase())
      || seenSlugs.has(slug)
      || fs.existsSync(targetPng);

    if (duplicate) {
      skipped.push({ word, file: filename, reason: "already exists" });
      continue;
    }

    if (!fs.existsSync(sourcePng)) {
      skipped.push({ word, file: filename, reason: "png missing" });
      continue;
    }

    fs.writeFileSync(targetPng, fs.readFileSync(sourcePng));
    fs.chmodSync(targetPng, 0o644);
    stripExtendedAttributes(targetPng);
    manifest.push(manifestEntry(entry, filename));
    seenWords.add(word.toLowerCase());
    seenFiles.add(filename.toLowerCase());
    seenSlugs.add(slug);
    copied.push({ word, file: filename });
  }

  if (copied.length) {
    manifest.sort(
      (a, b) =>
        createdAtRank(b) - createdAtRank(a)
        || String(a.word || "").localeCompare(String(b.word || "")),
    );
    writeJsonAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    dictionaryDir,
    copied,
    skipped,
    manifestTotal: manifest.length,
  }, null, 2));
}

main();
