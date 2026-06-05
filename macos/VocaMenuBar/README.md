# VocaMenuBar

Minimal macOS menu bar app for creating Voca cards without opening Codex.

## Setup

Create `~/.voca-menubar.env`:

```sh
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

## Run

```sh
cd "/Users/thaonv/Documents/New project 5/voca-dictionary/macos/VocaMenuBar"
swift run VocaMenuBar
```

The app calls:

```sh
node "<repo>/skills/scripts/voca-create-card.mjs" "<word>"
```

Generated PNGs go to `../output/vocabulary_cards/` and are synced into `voca-dictionary/cards/`.

When the menu bar app is open, it also starts the local web bridge:

```sh
http://127.0.0.1:22053/create-card
```

The web dictionary uses that bridge for the "Create" button shown when a search has no matching card.
