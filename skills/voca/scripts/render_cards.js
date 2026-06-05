const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function usage() {
  console.error("Usage: node render_cards.js <input.json> <output-dir>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function list(items) {
  const values = Array.isArray(items) ? items : [];
  return values.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function normalizeVisualText(value) {
  return String(value ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\s*->\s*/g, " &rarr; ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

function visualParagraphs(value) {
  return escapeHtml(normalizeVisualText(value))
    .replace(/&amp;rarr;/g, "&rarr;")
    .replace(/\n/g, "<br>");
}

function htmlForCard(entry) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --ink: #1f2933;
      --muted: #64748b;
      --line: #d8dee6;
      --soft: #f6f8fb;
      --blue: #1d4ed8;
      --blue-soft: #eaf1ff;
      --green-soft: #e9f8f1;
      --orange: #b45309;
      --orange-soft: #fff7ed;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ffffff;
      color: var(--ink);
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.45;
    }
    .page {
      width: 794px;
      min-height: 1123px;
      padding: 54px;
      background: #fff;
    }
    header {
      display: grid;
      grid-template-columns: 1fr 230px;
      gap: 18px;
      align-items: start;
      padding-bottom: 18px;
      border-bottom: 3px solid var(--ink);
    }
    .label {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      color: var(--blue);
      font-size: 56px;
      line-height: 1;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .pronunciation {
      margin-top: 10px;
      color: var(--muted);
      font-size: 17px;
      font-weight: 700;
    }
    .meta {
      display: grid;
      gap: 8px;
    }
    .pill {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      padding: 5px 10px;
      border: 1px solid #b8c8ee;
      border-radius: 999px;
      background: var(--blue-soft);
      color: #183b7a;
      font-size: 12px;
      font-weight: 700;
      text-align: center;
    }
    .date-line {
      height: 28px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }
    .main-grid {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 14px;
      margin-top: 18px;
    }
    .section-stack {
      display: grid;
      gap: 12px;
    }
    .box {
      padding: 13px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .box.soft { background: var(--soft); }
    .box.green {
      border-color: #a7dfc1;
      background: var(--green-soft);
    }
    .box.orange {
      border-color: #fed7aa;
      background: var(--orange-soft);
    }
    h2 {
      margin: 0 0 8px;
      color: var(--blue);
      font-size: 14px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    p {
      margin: 0 0 7px;
      font-size: 15px;
    }
    ul {
      margin: 0;
      padding-left: 20px;
      font-size: 15px;
    }
    li { margin: 5px 0; }
    strong { color: #111827; }
    .vn {
      color: var(--muted);
      font-style: italic;
    }
    .memory-drawing {
      display: grid;
      place-items: center;
      min-height: 160px;
      margin-top: 8px;
      border: 2px dashed #f6b64b;
      border-radius: 8px;
      background: #fffdf8;
      color: var(--orange);
      font-size: 30px;
      font-weight: 800;
      text-align: center;
      white-space: pre-line;
    }
    .practice-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 14px;
    }
    .line-area {
      min-height: 132px;
      background-image: linear-gradient(to bottom, transparent 25px, var(--line) 26px);
      background-size: 100% 26px;
    }
    .footer-review {
      margin-top: 14px;
      padding: 12px;
      border: 2px solid var(--ink);
      border-radius: 8px;
    }
    .big-note {
      min-height: 164px;
      background-image: linear-gradient(to bottom, transparent 27px, var(--line) 28px);
      background-size: 100% 28px;
    }
    .answer-line {
      display: inline-block;
      min-width: 170px;
      border-bottom: 1px solid var(--ink);
      transform: translateY(-2px);
    }
  </style>
</head>
<body>
  <section class="page">
    <header>
      <div>
        <p class="label">Vocabulary Focus</p>
        <h1>${escapeHtml(entry.word)}</h1>
        <div class="pronunciation">${escapeHtml(entry.pronunciation)}</div>
      </div>
      <div class="meta">
        <span class="pill">${escapeHtml(entry.partOfSpeech)}</span>
        <span class="pill">${escapeHtml(entry.topic)}</span>
        <span class="pill">${escapeHtml(entry.frequency)}</span>
        <div class="date-line">Date:</div>
      </div>
    </header>

    <div class="main-grid">
      <div class="section-stack">
        <section class="box green">
          <h2>1. Meaning</h2>
          <p><strong>Simple English:</strong> ${escapeHtml(entry.meaningEn)}</p>
          <p class="vn"><strong>Tiếng Việt:</strong> ${escapeHtml(entry.meaningVi)}</p>
        </section>
        <section class="box">
          <h2>2. Common Use Cases</h2>
          <ul>${list(entry.useCases)}</ul>
        </section>
        <section class="box">
          <h2>3. Examples</h2>
          <ul>${list(entry.examples)}</ul>
        </section>
      </div>

      <div class="section-stack">
        <section class="box orange">
          <h2>4. Memory Tip</h2>
          <p>${escapeHtml(entry.memoryTip)}</p>
          <div class="memory-drawing">${visualParagraphs(entry.drawing)}</div>
        </section>
        <section class="box soft">
          <h2>5. TOEIC Trap</h2>
          <p>${escapeHtml(entry.toeicTrap)}</p>
        </section>
      </div>
    </div>

    <div class="practice-grid">
      <section class="box">
        <h2>Mini Practice</h2>
        <p>${escapeHtml(entry.practicePrompt).replace("______", '<span class="answer-line"></span>')}</p>
        <p><strong>Answer:</strong> ${escapeHtml(entry.answer)}</p>
      </section>
      <section class="box">
        <h2>My Sentence</h2>
        <div class="line-area"></div>
      </section>
    </div>

    <section class="footer-review">
      <h2>Quick Review</h2>
      <div class="big-note"></div>
    </section>
  </section>
</body>
</html>`;
}

async function main() {
  const [inputPath, outputDir] = process.argv.slice(2);
  if (!inputPath || !outputDir) {
    usage();
    process.exit(1);
  }

  const entries = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(entries)) {
    throw new Error("Input JSON must be an array of vocabulary entries.");
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 794, height: 1123 },
    deviceScaleFactor: 2,
  });

  const generated = [];
  for (const entry of entries) {
    await page.setContent(htmlForCard(entry), { waitUntil: "networkidle" });
    const filename = `${slugify(entry.word)}.png`;
    const outputPath = path.join(outputDir, filename);
    await page.locator(".page").screenshot({ path: outputPath });
    generated.push(outputPath);
  }

  await browser.close();
  for (const file of generated) {
    console.log(file);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
