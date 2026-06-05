import {
  parseJsonObject,
  normalizeAnswer,
  shuffleItems,
  stableShuffleItems,
} from "./utils";
import type {
  ArticlePractice,
  ChallengeDrill,
  ChallengeDrillBatch,
  ChallengeDrillKind,
  QuickQuiz,
  ReadingContext,
  ReadingDocumentType,
  TrapType,
} from "./types";

const drillKinds = new Set<ChallengeDrillKind>([
  "scenario",
  "rescue",
  "collocation",
  "error_spotting",
  "trap",
  "reverse",
  "part2_response",
]);

const trapTypes = new Set<TrapType>([
  "same_word_family",
  "wrong_preposition",
  "near_synonym_wrong_context",
  "similar_spelling",
  "similar_sound",
  "grammar_mismatch",
  "collocation_mismatch",
  "too_literal",
  "wrong_question_type",
]);

export function maybeParseQuickQuiz(value: string): QuickQuiz | null {
  try {
    const parsed = parseJsonObject<QuickQuiz>(value);
    if (parsed?.type !== "quick_quiz" || !Array.isArray(parsed.questions) || !parsed.questions.length) return null;
    const seenQuestions = new Set<string>();
    const questions = parsed.questions
      .map((question, index) => {
        const answer = String(question.answer || "").trim();
        const accepted = Array.isArray(question.accepted)
          ? question.accepted.map((item) => String(item || "").trim()).filter(Boolean)
          : undefined;
        const acceptedSet = new Set([answer, ...(accepted || [])].map(normalizeAnswer));
        const rawChoices = Array.isArray(question.choices)
          ? question.choices.map((item) => String(item || "").trim()).filter(Boolean)
          : undefined;
        const choices = rawChoices?.length
          ? (() => {
              const seen = new Set<string>();
              const uniqueChoices = rawChoices.filter((choice) => {
                const key = normalizeAnswer(choice);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              const answerChoice = uniqueChoices.find((choice) => acceptedSet.has(normalizeAnswer(choice))) || answer;
              const distractors = uniqueChoices.filter((choice) => !acceptedSet.has(normalizeAnswer(choice)));
              const nextChoices = stableShuffleItems(distractors, `${question.prompt}:${answer}:${index}`);
              const answerIndex = Math.min((stableIndex(`${answer}:${question.prompt}:${index}`) % uniqueChoices.length), nextChoices.length);
              nextChoices.splice(answerIndex, 0, answerChoice);
              return nextChoices;
            })()
          : undefined;
        return {
          prompt: String(question.prompt || "").trim(),
          answer,
          accepted,
          choices,
          explanation: question.explanation ? String(question.explanation).trim() : undefined,
        };
      })
      .filter((question) => {
        if (!question.prompt || !question.answer) return false;
        const key = `${normalizeAnswer(question.prompt)}|${normalizeAnswer(question.answer)}`;
        if (seenQuestions.has(key)) return false;
        seenQuestions.add(key);
        return true;
      })
      .slice(0, 3);
    if (!questions.length) return null;
    return {
      type: "quick_quiz",
      title: parsed.title ? String(parsed.title).trim() : "Quick quiz",
      instructions: parsed.instructions ? String(parsed.instructions).trim() : "Answer each question, then check your result.",
      questions,
    };
  } catch {
    return null;
  }
}

function stableIndex(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function normalizeDrill(input: ChallengeDrill, _vocabularyIndex: string[]): ChallengeDrill {
  const seenChoices = new Set<string>();
  const choices = Array.isArray(input.choices)
    ? input.choices
        .map((choice) => String(choice || "").trim())
        .filter(Boolean)
        .filter((choice) => {
          const key = choice.toLowerCase();
          if (seenChoices.has(key)) return false;
          seenChoices.add(key);
          return true;
        })
    : [];
  const answer = String(input.answer || "").trim();
  const rawKind = String(input.kind || "scenario");
  const kind = drillKinds.has(rawKind as ChallengeDrillKind) ? (rawKind as ChallengeDrillKind) : "scenario";
  const expectedChoiceCount = kind === "part2_response" ? 3 : 4;
  const explanation = String(input.explanation || "").trim();
  if (
    !input.scenario ||
    choices.length !== expectedChoiceCount ||
    !answer ||
    !choices.some((choice) => choice.toLowerCase() === answer.toLowerCase()) ||
    explanation.length < 20
  ) {
    throw new Error("Invalid drill response");
  }

  const rawTrapType = String(input.trapType || "").trim();
  const rawDifficulty = String(input.difficulty || "").trim();

  return {
    kind,
    trapType: trapTypes.has(rawTrapType as TrapType) ? (rawTrapType as TrapType) : undefined,
    targetWord: input.targetWord ? String(input.targetWord).trim() : answer,
    testedSkill: input.testedSkill ? String(input.testedSkill).trim() : undefined,
    difficulty: rawDifficulty === "easy" || rawDifficulty === "medium" || rawDifficulty === "hard" ? rawDifficulty : undefined,
    title: input.title ? String(input.title).trim() : undefined,
    scenario: String(input.scenario).trim(),
    instruction: input.instruction ? String(input.instruction).trim() : undefined,
    choices: shuffleItems(choices),
    answer,
    explanation,
    whyWrong: input.whyWrong || {},
  };
}

export function normalizeDrillBatch(input: ChallengeDrillBatch | ChallengeDrill[] | ChallengeDrill, vocabularyIndex: string[]): ChallengeDrill[] {
  const rawDrills = Array.isArray(input) ? input : "drills" in input ? input.drills : [input];
  const seen = new Set<string>();
  return rawDrills
    .map((item) => normalizeDrill(item, vocabularyIndex))
    .filter((item) => {
      const key = `${item.scenario.toLowerCase()}|${item.answer.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function parseDrillText(value: string, vocabularyIndex: string[]): ChallengeDrill[] {
  const lineDrills = value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^```(?:json)?|```$/g, "").trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .flatMap((line) => {
      try {
        return [normalizeDrill(JSON.parse(line) as ChallengeDrill, vocabularyIndex)];
      } catch {
        return [];
      }
    });
  if (lineDrills.length) return lineDrills;
  return normalizeDrillBatch(parseJsonObject<ChallengeDrillBatch | ChallengeDrill[] | ChallengeDrill>(value), vocabularyIndex);
}

export function parseReadingContext(value: string): ReadingContext {
  const parsed = parseJsonObject<ReadingContext>(value);
  if (parsed?.type !== "reading_context" || !["part6", "part7"].includes(parsed.format)) {
    throw new Error("Invalid reading context response");
  }
  const isPart6 = parsed.format === "part6";
  const documentTypes = new Set<ReadingDocumentType>(["email", "notice", "memo", "article", "message"]);
  const passage = Array.isArray(parsed.passage) ? parsed.passage.map((line) => String(line || "").trim()).filter(Boolean) : [];
  const rawDocuments = Array.isArray(parsed.documents) ? parsed.documents : [];
  const documents = (
    rawDocuments.length
      ? rawDocuments
      : parsed.format === "part7" && passage.length
        ? [{ title: parsed.title, documentType: parsed.documentType, passage }]
        : []
  )
    .map((document) => {
      const lines = Array.isArray(document.passage) ? document.passage.map((line) => String(line || "").trim()).filter(Boolean) : [];
      const documentType = documentTypes.has(document.documentType as ReadingDocumentType) ? (document.documentType as ReadingDocumentType) : parsed.documentType;
      return {
        title: document.title ? String(document.title).trim() : undefined,
        documentType,
        passage: lines,
      };
    })
    .filter((document) => document.passage.length)
    .slice(0, 3);
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .map((question) => {
          const choices = Array.isArray(question.choices)
            ? question.choices.map((choice) => String(choice || "").trim()).filter(Boolean)
            : [];
          const uniqueChoices = choices.filter((choice, index) => choices.findIndex((item) => normalizeAnswer(item) === normalizeAnswer(choice)) === index);
          return {
            blank: question.blank === undefined ? undefined : Number(question.blank),
            prompt: String(question.prompt || "").trim(),
            choices: uniqueChoices,
            answer: String(question.answer || "").trim(),
            explanation: String(question.explanation || "").trim(),
          };
        })
        .filter(
          (question) =>
            (!isPart6 || Number.isFinite(question.blank)) &&
            question.prompt &&
            question.choices.length === 4 &&
            question.answer &&
            question.explanation.length >= 20 &&
            question.choices.some((choice) => normalizeAnswer(choice) === normalizeAnswer(question.answer)),
        )
        .slice(0, isPart6 ? 3 : 5)
    : [];

  if (!parsed.title || (!passage.length && !documents.length) || !questions.length) {
    throw new Error("Invalid reading context response");
  }

  return {
    type: "reading_context",
    format: parsed.format,
    documentType: documentTypes.has(parsed.documentType) ? parsed.documentType : "email",
    title: String(parsed.title).trim(),
    passage: passage.length ? passage : documents[0]?.passage || [],
    documents: parsed.format === "part7" && documents.length ? documents : undefined,
    questions: questions.map((question, index) => ({
      ...question,
      choices: stableShuffleItems(question.choices, `${parsed.title}:${question.blank}:${question.answer}:${index}`),
    })),
    targetWords: Array.isArray(parsed.targetWords) ? parsed.targetWords.map((word) => String(word || "").trim()).filter(Boolean) : [],
  };
}

export function parseArticlePractice(value: string): ArticlePractice {
  const parsed = parseJsonObject<ArticlePractice>(value);
  if (parsed?.type !== "article_practice") {
    throw new Error("Invalid article practice response");
  }
  const documentTypes = new Set(["article", "email", "notice", "memo"]);
  const passage = Array.isArray(parsed.passage) ? parsed.passage.map((line) => String(line || "").trim()).filter(Boolean) : [];
  const targetWords = Array.isArray(parsed.targetWords) ? parsed.targetWords.map((word) => String(word || "").trim()).filter(Boolean) : [];
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .map((question) => {
          const choices = Array.isArray(question.choices)
            ? question.choices.map((choice) => String(choice || "").trim()).filter(Boolean)
            : [];
          const uniqueChoices = choices.filter((choice, index) => choices.findIndex((item) => normalizeAnswer(item) === normalizeAnswer(choice)) === index);
          return {
            prompt: String(question.prompt || "").trim(),
            choices: uniqueChoices,
            answer: String(question.answer || "").trim(),
            explanation: String(question.explanation || "").trim(),
          };
        })
        .filter(
          (question) =>
            question.prompt &&
            question.choices.length === 4 &&
            question.answer &&
            question.explanation.length >= 20 &&
            question.choices.some((choice) => normalizeAnswer(choice) === normalizeAnswer(question.answer)),
        )
        .slice(0, 5)
    : [];
  const vocabularyNotes = Array.isArray(parsed.vocabularyNotes)
    ? parsed.vocabularyNotes
        .map((note) => ({
          word: String(note.word || "").trim(),
          meaningVi: String(note.meaningVi || "").trim(),
          contextMeaning: String(note.contextMeaning || "").trim(),
        }))
        .filter((note) => note.word && note.meaningVi && note.contextMeaning)
        .slice(0, 6)
    : [];

  if (!parsed.title || passage.length < 6 || !targetWords.length || !questions.length || !vocabularyNotes.length) {
    throw new Error("Invalid article practice response");
  }

  return {
    type: "article_practice",
    title: String(parsed.title).trim(),
    documentType: documentTypes.has(parsed.documentType) ? parsed.documentType : "article",
    passage,
    targetWords,
    questions: questions.map((question, index) => ({
      ...question,
      choices: stableShuffleItems(question.choices, `${parsed.title}:${question.answer}:${index}`),
    })),
    vocabularyNotes,
  };
}
