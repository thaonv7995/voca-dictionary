---
name: voca
description: Create printable one-word-per-page PNG vocabulary study cards for English, TOEIC, bilingual English-Vietnamese learning, and personal vocabulary review. Use when the user asks to turn vocabulary words into printable images, flashcard-style study sheets, TOEIC vocabulary cards, or reusable visual word-learning materials.
---

# Voca

## Overview

Create one A4 PNG per vocabulary word. The card should help the learner remember and use the word, not just know its translation.

Default style:
- One word per page.
- Bilingual English + Vietnamese explanations.
- TOEIC-focused use cases, collocations, examples, traps, and a short practice item.
- Simple memory drawing or visual phrase using text symbols.
- Printable A4 layout with enough whitespace for handwriting.

## Workflow

1. Gather 1-3 words from the user.
2. For each word, prepare structured data:
   - `word`
   - `pronunciation`
   - `partOfSpeech`
   - `topic`
   - `frequency`
   - `meaningEn`
   - `meaningVi`
   - `useCases`
   - `examples`
   - `memoryTip`
   - `drawing`
   - `toeicTrap`
   - `practicePrompt`
   - `answer`
   - `createdAt` (optional; sync script defaults to today's `YYYY-MM-DD`)
   - `level` (optional; one of `new`, `learning`, `known`, `mastered`; sync script defaults to `new`)
3. Use one shared output folder for all cards. Default to `output/vocabulary_cards/` inside the current workspace when the user does not specify a folder, except when the current workspace is the `voca-dictionary` app itself; in that case default to `../output/vocabulary_cards/` so generated artifacts stay outside the app repo. Do not create per-batch subfolders unless the user explicitly asks for them.
4. Save the data as a temporary JSON file outside the output folder, for example `/tmp/voca-words.json`.
5. Run `scripts/render_cards.js` to export one PNG per word into the output folder.
6. If a `voca-dictionary/` folder exists in the current workspace, sync the new cards into it:
   - Run `scripts/sync_dictionary.js` with the same temporary JSON, the PNG output folder, and the dictionary folder.
   - The sync step must check existing words, slugs, filenames, and target PNG files before copying.
   - If a word already exists, skip it and report it as skipped instead of overwriting or duplicating it.
   - For new words, copy the PNG into `voca-dictionary/cards/` and append the manifest entry to `voca-dictionary/cards.json`.
   - New manifest entries must include `createdAt` and `level`.
   - Do not rebuild Docker after syncing. The dictionary app is expected to run with `docker compose` bind mounts, so a browser refresh is enough.
7. Delete the temporary JSON file after rendering and dictionary sync unless the user explicitly asks to keep source data.
8. Keep the final response short. Report only:
   - `Đã tạo card cho <word> và sync vào voca-dictionary.`
   - Direct clickable PNG file link(s) in the output folder.
   - If a word was skipped because it already exists, say `Đã có card cho <word> trong voca-dictionary.` and include the existing/generated PNG file link if available.

## Content Rules

Keep explanations compact and practical:
- Use simple English first, Vietnamese second.
- Prefer common TOEIC contexts: business, office, invoices, schedules, travel, hiring, meetings, customer service, marketing, contracts.
- Include collocations, not isolated meanings only.
- Include at least two natural example sentences.
- Include one TOEIC trap or pattern when useful.
- Make the memory drawing simple enough to print clearly.
- Before reporting the result, check the generated PNG or the source text for leaked technical characters such as literal `\n`, `\\n`, `\t`, broken arrows like `->` when a cleaner arrow is intended, or awkward repeated punctuation.

Use natural filenames:
- Lowercase words.
- Replace spaces with hyphens.
- Remove punctuation that is unsafe in filenames.

## Running The Renderer

The renderer requires Playwright. If Playwright is not available in the current project, install it in a temporary location:

```bash
npm install --prefix /tmp/vocab-card-png playwright
npx --prefix /tmp/vocab-card-png playwright install chromium
NODE_PATH=/tmp/vocab-card-png/node_modules node ~/.codex/skills/voca/scripts/render_cards.js /tmp/voca-words.json output/vocabulary_cards
```

If the project already has Playwright installed, run directly:

```bash
node ~/.codex/skills/voca/scripts/render_cards.js /tmp/voca-words.json output/vocabulary_cards
```

## Syncing Voca Dictionary

When the current workspace has a `voca-dictionary/` directory with `cards.json`, sync rendered cards into the dictionary after PNG generation:

```bash
node ~/.codex/skills/voca/scripts/sync_dictionary.js /tmp/voca-words.json output/vocabulary_cards voca-dictionary
```

The sync script:
- Copies only new PNG files into `voca-dictionary/cards/`.
- Updates `voca-dictionary/cards.json`.
- Checks existing words, slugs, filenames, and target PNG files before changing anything.
- Skips duplicates without overwriting.
- Prints JSON with `copied`, `skipped`, and `manifestTotal`.

If `voca-dictionary/docker-compose.yml` exists and the app is running via Compose, do not rebuild the image. The compose setup bind-mounts local files into Nginx, and the app fetches `cards.json` without cache, so newly synced words appear after refreshing `http://localhost:8080`.

## Final Response Style

Use a minimal final response. Do not include sync JSON, manifest counts, Docker status, Git status, or long explanations unless the user asks.

Use a normal Markdown file link for PNGs, not an inline image embed. Do not write `![word](...)` in the final response; it can render as a blank image tile in the Codex app when paths contain spaces. Prefer `[word](</absolute/path/to/output/vocabulary_cards/word.png>)` for paths with spaces, or `[word](/absolute/path/to/output/vocabulary_cards/word.png)` when there are no spaces.

Example:

```md
Đã tạo card cho personnel và sync vào voca-dictionary.
```

## JSON Example

```json
[
  {
    "word": "hesitate",
    "pronunciation": "/ˈhez.ə.teɪt/",
    "partOfSpeech": "verb",
    "topic": "TOEIC: communication, customer service",
    "frequency": "high frequency",
    "meaningEn": "to pause before doing or saying something because you are unsure",
    "meaningVi": "do dự, ngập ngừng, chần chừ",
    "useCases": [
      "hesitate to ask = ngại hỏi",
      "do not hesitate to contact us = đừng ngần ngại liên hệ",
      "without hesitation = không do dự"
    ],
    "examples": [
      "Please do not hesitate to contact us if you have questions.",
      "She hesitated before accepting the new position."
    ],
    "memoryTip": "Imagine your foot stopping before the next step: Should I go?",
    "drawing": "STOP ?\\nGO",
    "toeicTrap": "Common pattern: Please do not hesitate to + verb.",
    "practicePrompt": "Please do not ______ to contact our office.",
    "answer": "hesitate"
  }
]
```
