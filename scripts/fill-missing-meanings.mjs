#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = path.join(ROOT, "cards.json");

// 1. Load environment from ~/.voca-menubar.env
function loadEnv() {
  const envPath = path.join(os.homedir(), ".voca-menubar.env");
  if (!fs.existsSync(envPath)) {
    console.log("No ~/.voca-menubar.env found. Using process.env.");
    return;
  }
  
  console.log(`Loading environment from ${envPath}...`);
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

// 2. Query the LLM
async function queryLLM(batch) {
  let apiKey = process.env.OPENAI_API_KEY;
  let baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  let model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // Force public OpenAI API when utilizing official sk-proj keys
  if (apiKey && apiKey.startsWith("sk-proj-")) {
    baseURL = "https://api.openai.com/v1";
    model = "gpt-4o-mini";
  }

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  const prompt = `Provide compact, TOEIC-focused English and Vietnamese meanings for the following vocabulary items.
Rules:
- meaningEn must be a short, clear definition in simple English.
- meaningVi must be a natural, concise Vietnamese translation.
- Ensure the definitions fit the specified part of speech and topic context.

Return ONLY a JSON object containing the updates in this exact schema:
{
  "updates": [
    {
      "word": "stood out",
      "meaningEn": "to be easily noticeable or significantly better than others",
      "meaningVi": "nổi bật, xuất sắc hơn"
    }
  ]
}

Words to define:
${batch.map((c) => `- Word: "${c.word}", Part of speech: "${c.partOfSpeech}", Topic: "${c.topic}"`).join("\n")}`;

  console.log(`Querying LLM (${model}) for a batch of ${batch.length} words...`);
  
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are a professional English-Vietnamese TOEIC dictionary assistant. You must return only valid JSON matching the requested schema.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API returned error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content || "";
  
  try {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.updates)) {
      throw new Error("Invalid output format: missing 'updates' array");
    }
    return parsed.updates;
  } catch (err) {
    console.error("Failed to parse AI response:", text);
    throw err;
  }
}

// 3. Main runner
async function main() {
  loadEnv();

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest file not found at: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  console.log(`Reading manifest from ${MANIFEST_PATH}...`);
  const cards = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  
  // Identify missing cards
  const missing = cards.filter((card) => !card.meaningVi || !card.meaningEn);
  console.log(`Found ${cards.length} cards total. ${missing.length} cards are missing meanings.`);

  if (missing.length === 0) {
    console.log("All cards already have definitions. Nothing to do!");
    return;
  }

  // Group into batches of 10
  const BATCH_SIZE = 10;
  const batches = [];
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    batches.push(missing.slice(i, i + BATCH_SIZE));
  }

  console.log(`Processing ${batches.length} batches...`);
  const updatesMap = new Map();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`\n--- Batch ${i + 1}/${batches.length} ---`);
    try {
      const updates = await queryLLM(batch);
      for (const update of updates) {
        if (update.word && update.meaningVi && update.meaningEn) {
          updatesMap.set(update.word.toLowerCase().trim(), {
            meaningVi: update.meaningVi.trim(),
            meaningEn: update.meaningEn.trim(),
          });
          console.log(`  ✓ ${update.word}: ${update.meaningVi} | ${update.meaningEn}`);
        }
      }
    } catch (error) {
      console.error(`Error processing batch ${i + 1}:`, error.message);
      console.log("Skipping this batch...");
    }
  }

  // Merge updates back into manifest
  let updatedCount = 0;
  const updatedCards = cards.map((card) => {
    const key = card.word.toLowerCase().trim();
    if (updatesMap.has(key)) {
      const update = updatesMap.get(key);
      updatedCount++;
      return {
        ...card,
        meaningEn: update.meaningEn,
        meaningVi: update.meaningVi,
      };
    }
    return card;
  });

  if (updatedCount > 0) {
    console.log(`\nWriting ${updatedCount} updates back to cards.json...`);
    const tempPath = `${MANIFEST_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(updatedCards, null, 2) + "\n", "utf8");
    fs.renameSync(tempPath, MANIFEST_PATH);
    console.log("Successfully saved updates to cards.json!");
  } else {
    console.log("\nNo updates were applied.");
  }
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
