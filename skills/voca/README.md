# Voca Skill Bundle

This directory vendors the latest local `voca` skill into the repo so Codex, Claude, Cursor, Antigravity, or another coding agent can use the same vocabulary-card workflow on a new machine.

## Files

- `SKILL.md`: main workflow and content rules.
- `scripts/render_cards.js`: renders one A4 PNG per vocabulary word.
- `scripts/sync_dictionary.js`: syncs rendered PNGs into a `voca-dictionary` app.
- `agents/openai.yaml`: optional agent metadata/prompt entry point.
- `assets/`: reserved for future static assets.

## Use From This Repo

Tell the agent:

```text
Load the Voca skill from skills/voca/SKILL.md and use its scripts from skills/voca/scripts/.
```

When running scripts from this repo, prefer repo-relative paths:

```bash
node skills/voca/scripts/render_cards.js /tmp/voca-words.json ../output/vocabulary_cards
node skills/voca/scripts/sync_dictionary.js /tmp/voca-words.json ../output/vocabulary_cards .
```

If Playwright is not installed in the current project, install it in a temporary prefix:

```bash
npm install --prefix /tmp/vocab-card-png playwright
npx --prefix /tmp/vocab-card-png playwright install chromium
NODE_PATH=/tmp/vocab-card-png/node_modules node skills/voca/scripts/render_cards.js /tmp/voca-words.json ../output/vocabulary_cards
```

## Install Into Codex

On a new machine, from the repo root:

```bash
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/voca
cp -R skills/voca ~/.codex/skills/voca
```

Then ask Codex to use `voca`.

## Use With Other Agents

For agents without Codex skill discovery, point them at:

```text
skills/voca/SKILL.md
```

The agent should follow the workflow in that file and run:

```bash
node skills/voca/scripts/render_cards.js <input-json> <output-dir>
node skills/voca/scripts/sync_dictionary.js <input-json> <png-dir> <dictionary-dir>
```

## Expected Input JSON

The renderer expects an array of vocabulary entries. Minimal useful fields:

```json
[
  {
    "word": "hesitate",
    "pronunciation": "/ˈhez.ə.teɪt/",
    "partOfSpeech": "verb",
    "topic": "TOEIC: communication",
    "frequency": "high frequency",
    "meaningEn": "to pause because you are unsure",
    "meaningVi": "do dự, ngập ngừng",
    "useCases": ["do not hesitate to contact us"],
    "examples": ["Please do not hesitate to contact us."],
    "memoryTip": "A foot stops before the next step.",
    "drawing": "STOP ?\\nGO",
    "toeicTrap": "Pattern: do not hesitate to + verb.",
    "practicePrompt": "Please do not ______ to contact our office.",
    "answer": "hesitate",
    "createdAt": "2026-05-02",
    "level": "new"
  }
]
```

## Dictionary Sync Notes

For this repo, the dictionary directory is the repo root:

```bash
node skills/voca/scripts/sync_dictionary.js /tmp/voca-words.json ../output/vocabulary_cards .
```

The sync script:

- Creates `cards.json` if missing.
- Copies only new PNGs into `cards/`.
- Checks existing words, slugs, filenames, and target PNG files.
- Skips duplicates instead of overwriting.
- Adds `pronunciation` to the manifest when present.
- Adds `createdAt` and `level` to new manifest entries. `createdAt` defaults to today's `YYYY-MM-DD`; `level` defaults to `new`.

Generated files such as `cards/`, `cards.json`, and `output/` are local artifacts and should stay untracked unless the project policy changes.
