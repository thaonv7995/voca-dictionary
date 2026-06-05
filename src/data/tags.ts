const hiddenTags = new Set(["overview"]);

type VisibleTagOptions = {
  topic?: string;
  partOfSpeech?: string;
};

function normalizedTag(value: string): string {
  return value.trim().toLowerCase();
}

export function visibleTags(tags: string[], options: VisibleTagOptions = {}): string[] {
  const hidden = new Set(hiddenTags);
  if (options.topic) hidden.add(normalizedTag(options.topic));
  if (options.partOfSpeech) {
    const partOfSpeech = normalizedTag(options.partOfSpeech);
    hidden.add(partOfSpeech);
    hidden.add(partOfSpeech.split("/")[0].trim());
  }

  return tags.filter((tag) => !hidden.has(normalizedTag(tag)));
}
