import { shuffleItems } from "./utils";
import type { ReadingFormat } from "./types";

export function drillPrompt(
  targetVocabularyIndex: string[],
  selectedWord?: string,
  count = 5,
  contextDescription = "All words",
  weaknessContext = "No recorded practice mistakes yet.",
): string {
  return [
    `You are creating ${count} TOEIC vocabulary drills.`,
    "Use targetVocabularyIndex as the active learning context and the full list of allowed target answers.",
    "For wrong choices and supporting context, create plausible TOEIC/business distractors yourself when the target list is small.",
    `Active context: ${contextDescription}.`,
    "The targetVocabularyIndex is ordered by learning priority: new and learning words first, mastered words last. Prefer earlier unmastered words.",
    weaknessContext,
    "Use recent mistakes to choose trap types and target words, but do not repeat the exact same prompt.",
    "Use exact words or phrases from targetVocabularyIndex as correct answers whenever possible.",
    "For wrong choices, create plausible distractors yourself. Do not make every A/B/C/D choice come only from targetVocabularyIndex when it has fewer than 4 items.",
    "Each drill must be unique and use a different target answer if possible.",
    "Mix these drill kinds across the batch: scenario, rescue, collocation, error_spotting, trap, reverse, part2_response.",
    "Use trapType from this taxonomy: same_word_family, wrong_preposition, near_synonym_wrong_context, similar_spelling, similar_sound, grammar_mismatch, collocation_mismatch, too_literal, wrong_question_type.",
    "scenario: create a short workplace/TOEIC situation and ask which word fits.",
    "rescue: show one incorrect or awkward sentence using a confusing word/collocation, then ask the learner to choose the best correction.",
    "collocation: ask which word naturally completes a TOEIC/business collocation, such as comply with, allocate funds, submit a report, conduct a survey.",
    "error_spotting: show one sentence with exactly one wrong word or phrase. The 4 choices must be words/phrases from that sentence, and the answer must be the wrong word/phrase the learner should identify.",
    "trap: test a TOEIC trap such as wrong preposition, word family, confusing spelling, false friend, or unnatural collocation.",
    "reverse: show a Vietnamese meaning or workplace intent and ask the learner to choose the matching English word or phrase from targetVocabularyIndex.",
    "part2_response: create one TOEIC Listening Part 2 question-response item. scenario must be only the spoken question. instruction should be 'Choose the best response.' choices must be exactly 3 short spoken responses for A/B/C. Include common traps: repeated keyword, similar sound, wrong wh-question type, tense mismatch, too literal response, or related but non-answer.",
    "Do not use a plain dictionary-definition prompt.",
    "Return exactly 4 choices for normal drills, but exactly 3 choices for part2_response.",
    "One choice must be the answer. The other choices must be realistic traps based on spelling, sound, meaning, or TOEIC/business context.",
    "Randomize the answer position across A/B/C/D, or A/B/C for part2_response. Do not repeatedly put the correct answer first.",
    "The explanation must be detailed enough to teach the trap: 2-4 short sentences, English first then Vietnamese support.",
    "whyWrong must explain why each wrong choice is wrong in English + Vietnamese. Mention grammar, collocation, meaning, question type, or listening trap when relevant.",
    "Set targetWord to the exact tested answer when possible, testedSkill to a short skill label, and difficulty to easy, medium, or hard.",
    "Prefer the currently selected word as answer if it can make a good drill. Otherwise choose any good target from targetVocabularyIndex.",
    "Return NDJSON only: each line must be one compact JSON object for one drill.",
    "Each line shape: {\"kind\":\"scenario|rescue|collocation|error_spotting|trap|reverse|part2_response\",\"trapType\":\"...\",\"targetWord\":\"...\",\"testedSkill\":\"...\",\"difficulty\":\"easy|medium|hard\",\"title\":\"...\",\"instruction\":\"...\",\"scenario\":\"...\",\"choices\":[\"...\"],\"answer\":\"...\",\"explanation\":\"...\",\"whyWrong\":{\"choice\":\"reason\"}}.",
    "Do not wrap the lines in an array. Do not use markdown.",
    selectedWord ? `Currently selected word: ${selectedWord}` : "No selected word.",
    `Target vocabulary index JSON: ${JSON.stringify(targetVocabularyIndex)}`,
  ].join("\n");
}

export function readingPrompt(
  targetVocabularyIndex: string[],
  selectedWord?: string,
  format: ReadingFormat = "part6",
  contextDescription = "All words",
  weaknessContext = "No recorded practice mistakes yet.",
): string {
  const isPart6 = format === "part6";
  return [
    `You are creating one TOEIC ${isPart6 ? "Part 6" : "Part 7"} reading context for a vocabulary learning app.`,
    "Use targetVocabularyIndex as the active learning context and target vocabulary source.",
    "For wrong choices and related vocabulary, create plausible TOEIC/business distractors yourself when the target list is small.",
    `Active context: ${contextDescription}.`,
    "The targetVocabularyIndex is ordered by learning priority: new and learning words first, mastered words last. Prefer earlier unmastered words for target vocabulary.",
    weaknessContext,
    "Use recent mistakes to bias target vocabulary and trap types, but keep the passage realistic and avoid repeating exact questions.",
    "Create a realistic TOEIC-style business document. Use natural workplace context, specific but simple details, and no fantasy or generic textbook wording.",
    isPart6
      ? "Part 6 passage: 4-7 short lines, one coherent email/notice/memo/article/message, and 1-3 numbered blanks formatted exactly as [1] _____, [2] _____, [3] _____. Prefer 1-2 blanks unless more is clearly useful."
      : "Part 7 passage: create a TOEIC single, double, or triple passage set with 1-3 related documents, no blanks. The reading should feel like a real TOEIC Part 7 item, not a mini paragraph. Single-document sets should be 8-12 short lines. Double/triple passage sets should use 2-3 documents with 5-9 short lines per document. Do not default to only two documents; when the context can support it, prefer a realistic triple set such as email + notice + schedule, memo + message + announcement, or invoice email + policy notice + reply. Ask 1-5 TOEIC Part 7 style questions about detail, purpose, inference, intended audience, next action, cross-document connection, or vocabulary-in-context. Use 4-5 questions when there are multiple documents or enough information, otherwise 1-3.",
    isPart6 ? "Create 1-3 questions, one for each blank." : "Create 1-5 questions. For longer or multi-document Part 7 sets, 5 questions is acceptable and often realistic.",
    "Each question must have exactly 4 answer choices and one correct answer.",
    "Use exact words or phrases from targetVocabularyIndex for correct answers whenever possible. For wrong choices, create plausible distractors when useful.",
    isPart6
      ? "Part 6 choices must be close TOEIC traps: same word family, collocation traps, grammar fit, meaning fit, or business-context traps. The correct answer must fit grammar and meaning in the sentence."
      : "Part 7 choices must be plausible and tied to the passage. Avoid obvious wrong choices. Include at least one detail/purpose/inference style question when useful.",
    isPart6 ? "Avoid reusing the same target word, blank pattern, or document scenario repeatedly." : "Avoid reusing the same target word, question type, or document scenario repeatedly.",
    isPart6
      ? "Return JSON only in this exact shape: {\"type\":\"reading_context\",\"format\":\"part6\",\"documentType\":\"email\",\"title\":\"...\",\"passage\":[\"...\"],\"questions\":[{\"blank\":1,\"prompt\":\"...\",\"choices\":[\"...\",\"...\",\"...\",\"...\"],\"answer\":\"...\",\"explanation\":\"...\"}],\"targetWords\":[\"...\"]}."
      : "Return JSON only in this exact shape: {\"type\":\"reading_context\",\"format\":\"part7\",\"documentType\":\"email\",\"title\":\"...\",\"passage\":[\"fallback first document lines\"],\"documents\":[{\"title\":\"Email\",\"documentType\":\"email\",\"passage\":[\"...\"]},{\"title\":\"Notice\",\"documentType\":\"notice\",\"passage\":[\"...\"]},{\"title\":\"Schedule Update\",\"documentType\":\"memo\",\"passage\":[\"...\"]}],\"questions\":[{\"prompt\":\"...\",\"choices\":[\"...\",\"...\",\"...\",\"...\"],\"answer\":\"...\",\"explanation\":\"...\"}],\"targetWords\":[\"...\"]}.",
    "Do not use markdown. Do not include extra text outside JSON.",
    selectedWord ? `Currently selected word: ${selectedWord}` : "No selected word.",
    `Target vocabulary index JSON: ${JSON.stringify(shuffleItems(targetVocabularyIndex))}`,
  ].join("\n");
}

export function articlePracticePrompt(
  targetVocabularyIndex: string[],
  selectedWord?: string,
  contextDescription = "All words",
  weaknessContext = "No recorded practice mistakes yet.",
): string {
  return [
    "You are creating one short TOEIC-style article practice set for a vocabulary learning app.",
    "This is not a full TOEIC Part 7 test. It is a focused business article/email/notice/memo that teaches vocabulary in context.",
    `Active context: ${contextDescription}.`,
    "Use targetVocabularyIndex as the target vocabulary source. Prefer earlier unmastered words and recent mistake areas.",
    weaknessContext,
    "Use 3-5 target words naturally in a realistic workplace document.",
    "Passage should be 8-12 short lines with specific but simple business details.",
    "Create 3-5 questions across vocabulary-in-context, inference, paraphrase, phrase replacement, and main purpose.",
    "Each question must have exactly 4 plausible choices and one correct answer.",
    "Add vocabularyNotes for the target words used in the passage.",
    "Do not use markdown. Do not include extra text outside JSON.",
    selectedWord ? `Currently selected word: ${selectedWord}` : "No selected word.",
    `Target vocabulary index JSON: ${JSON.stringify(shuffleItems(targetVocabularyIndex))}`,
  ].join("\n");
}

export function speakingPrompt(
  targetVocabularyIndex: string[],
  selectedWord?: string,
  contextDescription = "All words",
  weaknessContext = "No recorded practice mistakes yet.",
): string {
  return [
    "You are creating one English speaking/shadowing practice set for a mobile vocabulary learning app.",
    "The goal is to help users practice speaking by reading an article/passage aloud with synchronized words (karaoke style).",
    `Active context: ${contextDescription}.`,
    "Use targetVocabularyIndex as the source for vocabulary. Try to incorporate 2-4 target words naturally into the passage.",
    weaknessContext,
    "The passage must be a short, natural business or conversational text (15-30 words in total, about 2-4 short sentences) so that it is readable on a mobile screen.",
    "For each sentence, you must provide:",
    "1. The original sentence text.",
    "2. The overall IPA transcription of the sentence.",
    "3. A list of all words in the sentence. For each word, provide: word text, its IPA, and its estimated timing (startMs and endMs) relative to the start of the ENTIRE passage (0ms). Assume a natural, clear reading pace of approximately 140 words per minute (about 430ms per word + natural pauses between sentences of 500-800ms). Ensure the startMs and endMs of words are continuous and increase chronologically throughout the entire passage.",
    "4. A list of connectedSpeech (linking/liaison) points between consecutive words in the sentence. For example:",
    "   - Consonant to Vowel linking (e.g. 'read up' -> from: 'read', to: 'up', type: 'linking', symbol: '‿')",
    "   - Vowel to Vowel linking (e.g. 'go on' -> from: 'go', to: 'on', type: 'linking', symbol: '‿')",
    "   - Consonant deletion/Elision (e.g. 'next door' -> from: 'next', to: 'door', type: 'elision')",
    "Return JSON only in this exact shape:",
    "{",
    "  \"type\": \"speaking_practice\",",
    "  \"title\": \"Title of the Reading\",",
    "  \"topic\": \"Topic name\",",
    "  \"passageText\": \"The entire concatenated text of the passage.\",",
    "  \"sentences\": [",
    "    {",
    "      \"text\": \"The first sentence text.\",",
    "      \"ipa\": \"The IPA of the first sentence.\",",
    "      \"words\": [",
    "        {\"word\": \"The\", \"ipa\": \"ðə\", \"startMs\": 0, \"endMs\": 300},",
    "        {\"word\": \"first\", \"ipa\": \"fɜːst\", \"startMs\": 300, \"endMs\": 800}",
    "      ],",
    "      \"connectedSpeech\": [",
    "        {\"from\": \"first\", \"to\": \"sentence\", \"type\": \"linking\", \"symbol\": \"‿\", \"explanation\": \"optional comment\"}",
    "      ]",
    "    }",
    "  ]",
    "}",
    "Do not use markdown. Do not include extra text outside JSON.",
    selectedWord ? `Currently selected word: ${selectedWord}` : "No selected word.",
    `Target vocabulary index JSON: ${JSON.stringify(shuffleItems(targetVocabularyIndex))}`,
  ].join("\n");
}
