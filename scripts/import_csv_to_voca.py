#!/usr/bin/env python3
import csv
import json
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

VIETNAM_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def slugify(value):
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "word"


def compact(value):
    return " ".join((value or "").strip().split())


def today_in_vietnam():
    return datetime.now(VIETNAM_TZ).date().isoformat()


def now_in_vietnam():
    return datetime.now(VIETNAM_TZ).isoformat()


def safe_topic(value):
    topic = compact(value)
    return topic if topic and topic != "π" else "General"


def sentence_blank(example, word):
    example = compact(example)
    word = compact(word)
    if not example:
        return "The correct vocabulary item is ______."

    pattern = re.compile(re.escape(word), re.IGNORECASE)
    if pattern.search(example):
        return pattern.sub("______", example, count=1)
    return f"Use ______ correctly in this sentence: {example}"


def short_visual(value, max_len=26):
    value = compact(value)
    if len(value) <= max_len:
        return value.upper()
    return (value[: max_len - 1].rstrip() + "...").upper()


def entry_from_row(row):
    word = compact(row.get("Word"))
    pos = compact(row.get("Word Type")) or "Other"
    ipa = compact(row.get("IPA"))
    meaning_vi = compact(row.get("Meaning (VN)"))
    example = compact(row.get("Example sentence"))
    topic = safe_topic(row.get("Topic"))
    topic_lower = topic.lower()

    return {
        "word": word,
        "pronunciation": ipa,
        "partOfSpeech": pos.lower(),
        "topic": f"TOEIC: {topic}",
        "frequency": "from overview list",
        "meaningEn": f"A TOEIC vocabulary item used in {topic_lower} contexts.",
        "meaningVi": meaning_vi,
        "useCases": [
            f"{word} = {meaning_vi}",
            f"{word} in {topic_lower} contexts",
            f"part of speech: {pos}",
            "review the example sentence to remember usage",
        ],
        "examples": [
            example or f"This vocabulary item often appears in {topic_lower} materials.",
            f"TOEIC often uses {word} in {topic_lower} passages or questions.",
        ],
        "memoryTip": f"Connect '{word}' with the Vietnamese meaning: {meaning_vi}.",
        "drawing": f"{short_visual(word)}\n→\n{short_visual(meaning_vi)}",
        "toeicTrap": f"Check the part of speech. {word} is listed as {pos}, so TOEIC may test whether it fits the grammar of the sentence.",
        "practicePrompt": sentence_blank(example, word),
        "answer": word,
    }


def manifest_from_entry(entry, filename):
    topic = entry["topic"].replace("TOEIC: ", "")
    level = compact(entry.get("level", "")).lower()
    return {
        "word": entry["word"],
        "file": filename,
        "pronunciation": entry.get("pronunciation", ""),
        "partOfSpeech": entry["partOfSpeech"],
        "topic": topic,
        "tags": [
            topic.lower(),
            entry["partOfSpeech"].split("/")[0].strip(),
        ],
        "createdAt": compact(entry.get("createdAt") or entry.get("created_at")) or today_in_vietnam(),
        "level": level if level in {"new", "learning", "known", "mastered"} else "new",
    }


def load_manifest(path):
    if not path.exists():
        return [], False, {}

    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data, False, {}
    if isinstance(data, dict) and isinstance(data.get("cards"), list):
        return data["cards"], True, {key: value for key, value in data.items() if key != "cards"}
    raise ValueError("Existing manifest must be a JSON array or an object with a cards array")


def write_manifest(path, cards, is_versioned, metadata):
    if is_versioned:
        payload = {
            **metadata,
            "version": now_in_vietnam(),
            "cards": cards,
        }
    else:
        payload = cards

    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp_path.replace(path)


def main():
    if len(sys.argv) != 5:
        print(
            "Usage: import_csv_to_voca.py <csv> <existing-cards.json> <render-json-out> <manifest-out>",
            file=sys.stderr,
        )
        raise SystemExit(2)

    csv_path = Path(sys.argv[1])
    existing_manifest_path = Path(sys.argv[2])
    render_json_path = Path(sys.argv[3])
    manifest_out_path = Path(sys.argv[4])

    existing, is_versioned, metadata = load_manifest(existing_manifest_path)

    cards_dir = existing_manifest_path.parent / "cards"
    seen_slugs = {slugify(item.get("word", "")) for item in existing}
    seen_files = {compact(item.get("file")) for item in existing if compact(item.get("file"))}
    existing_card_files = {
        path.name
        for path in cards_dir.glob("*.png")
    } if cards_dir.exists() else set()
    manifest = list(existing)
    render_entries = []
    skipped_duplicates = 0
    skipped_file_conflicts = 0

    with csv_path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            word = compact(row.get("Word"))
            if not word:
                continue
            slug = slugify(word)
            if slug in seen_slugs:
                skipped_duplicates += 1
                continue

            entry = entry_from_row(row)
            filename = f"{slug}.png"
            if filename in seen_files or filename in existing_card_files:
                skipped_file_conflicts += 1
                continue

            render_entries.append(entry)
            manifest.append(manifest_from_entry(entry, filename))
            seen_slugs.add(slug)
            seen_files.add(filename)

    render_json_path.write_text(
        json.dumps(render_entries, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_manifest(manifest_out_path, manifest, is_versioned, metadata)

    print(
        json.dumps(
            {
                "existing": len(existing),
                "new_entries": len(render_entries),
                "manifest_total": len(manifest),
                "skipped_duplicates": skipped_duplicates,
                "skipped_file_conflicts": skipped_file_conflicts,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
