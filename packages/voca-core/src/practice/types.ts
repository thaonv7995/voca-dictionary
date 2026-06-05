export type TrapType =
  | "same_word_family"
  | "wrong_preposition"
  | "near_synonym_wrong_context"
  | "similar_spelling"
  | "similar_sound"
  | "grammar_mismatch"
  | "collocation_mismatch"
  | "too_literal"
  | "wrong_question_type";

export type ChallengeDrillKind =
  | "scenario"
  | "rescue"
  | "collocation"
  | "error_spotting"
  | "trap"
  | "reverse"
  | "part2_response";

export type ChallengeDrill = {
  kind?: ChallengeDrillKind;
  trapType?: TrapType;
  targetWord?: string;
  testedSkill?: string;
  difficulty?: "easy" | "medium" | "hard";
  title?: string;
  scenario: string;
  instruction?: string;
  choices: string[];
  answer: string;
  explanation: string;
  whyWrong?: Record<string, string>;
};

export type ChallengeDrillBatch = {
  drills: ChallengeDrill[];
};

export type QuickQuizQuestion = {
  prompt: string;
  answer: string;
  accepted?: string[];
  choices?: string[];
  explanation?: string;
};

export type QuickQuiz = {
  type: "quick_quiz";
  title?: string;
  instructions?: string;
  questions: QuickQuizQuestion[];
};

export type ReadingQuestion = {
  blank?: number;
  prompt: string;
  choices: string[];
  answer: string;
  explanation: string;
};

export type ReadingFormat = "part6" | "part7";
export type ReadingDocumentType = "email" | "notice" | "memo" | "article" | "message";

export type ReadingDocument = {
  title?: string;
  documentType?: ReadingDocumentType;
  passage: string[];
};

export type ReadingContext = {
  type: "reading_context";
  format: ReadingFormat;
  documentType: ReadingDocumentType;
  title: string;
  passage: string[];
  documents?: ReadingDocument[];
  questions: ReadingQuestion[];
  targetWords?: string[];
};

export type ReadingQueue = Record<ReadingFormat, ReadingContext[]>;

export type ArticlePractice = {
  type: "article_practice";
  title: string;
  documentType: "article" | "email" | "notice" | "memo";
  passage: string[];
  targetWords: string[];
  questions: ReadingQuestion[];
  vocabularyNotes: {
    word: string;
    meaningVi: string;
    contextMeaning: string;
  }[];
};

export type PracticeMode = "quiz" | "drill" | "reading" | "article";

export type PracticeAttempt = {
  id: string;
  mode: PracticeMode;
  targetWord: string;
  kind?: string;
  trapType?: TrapType;
  prompt: string;
  userAnswer: string;
  correctAnswer: string;
  correct: boolean;
  createdAt: string;
};
