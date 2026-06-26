import { describe, expect, it } from "vitest";
import { maybeParseQuickQuiz, parseArticlePractice, parseDrillText, parseReadingContext, parseSpeakingPractice } from "./parsers";
import { assessDrillBatchQuality, assessReadingQuality } from "./quality";

describe("practice parsers", () => {
  it("parses drill metadata and validates choice counts", () => {
    const drills = parseDrillText(
      JSON.stringify({
        kind: "collocation",
        trapType: "collocation_mismatch",
        targetWord: "submit",
        testedSkill: "business collocation",
        difficulty: "medium",
        scenario: "The assistant must _____ the report before 5 p.m.",
        choices: ["submit", "suggest", "postpone", "lean"],
        answer: "submit",
        explanation: "Submit is the natural TOEIC collocation with report. Vietnamese: submit a report = nộp báo cáo.",
        whyWrong: {
          suggest: "Suggest does not collocate with report in this sentence.",
          postpone: "Postpone means delay, not send in.",
          lean: "Lean is unrelated to submitting documents.",
        },
      }),
      ["submit", "suggest", "postpone", "lean"],
    );

    expect(drills).toHaveLength(1);
    expect(drills[0].trapType).toBe("collocation_mismatch");
    expect(drills[0].targetWord).toBe("submit");
  });

  it("rejects drills with shallow explanations", () => {
    expect(() =>
      parseDrillText(
        JSON.stringify({
          kind: "scenario",
          scenario: "Choose the best word.",
          choices: ["a", "b", "c", "d"],
          answer: "a",
          explanation: "Because.",
        }),
        ["a"],
      ),
    ).toThrow("Invalid drill response");
  });

  it("parses quick quiz JSON and limits to three questions", () => {
    const quiz = maybeParseQuickQuiz(
      JSON.stringify({
        type: "quick_quiz",
        title: "Quick check",
        questions: [
          { prompt: "Please _____ the invoice.", answer: "review", choices: ["review", "park", "lean", "exist"] },
          { prompt: "A synonym for postpone?", answer: "delay" },
          { prompt: "Opposite of identical?", answer: "different" },
          { prompt: "Extra question?", answer: "extra" },
        ],
      }),
    );

    expect(quiz?.questions).toHaveLength(3);
    expect(quiz?.questions[0].choices).toContain("review");
  });

  it("parses reading context and requires answer choices to contain the answer", () => {
    const context = parseReadingContext(
      JSON.stringify({
        type: "reading_context",
        format: "part6",
        documentType: "email",
        title: "Schedule Update",
        passage: ["Please [1] _____ the meeting until Friday."],
        questions: [
          {
            blank: 1,
            prompt: "Choose the best word.",
            choices: ["postpone", "lean", "consider", "park"],
            answer: "postpone",
            explanation: "Postpone means delay an event to a later time. Vietnamese: hoãn cuộc họp.",
          },
        ],
        targetWords: ["postpone"],
      }),
    );

    expect(context.questions).toHaveLength(1);
    expect(context.targetWords).toEqual(["postpone"]);
  });

  it("scores drills with missing metadata lower than complete drills", () => {
    const drills = parseDrillText(
      JSON.stringify({
        kind: "scenario",
        scenario: "The manager will _____ the final proposal before sending it to clients.",
        choices: ["review", "park", "lean", "exist"],
        answer: "review",
        explanation: "Review means examine something carefully before it is finalized. Vietnamese: xem xét lại trước khi gửi.",
      }),
      ["review"],
    );

    expect(assessDrillBatchQuality(drills).score).toBeLessThan(4);
  });

  it("scores thin reading contexts lower for revision", () => {
    const context = parseReadingContext(
      JSON.stringify({
        type: "reading_context",
        format: "part7",
        documentType: "email",
        title: "Office Notice",
        passage: ["The office will close early on Friday.", "Staff should submit requests by noon."],
        questions: [
          {
            prompt: "What should staff do?",
            choices: ["Submit requests", "Call clients", "Change passwords", "Cancel lunch"],
            answer: "Submit requests",
            explanation: "Staff are told to submit requests by noon, so that is the required action.",
          },
          {
            prompt: "When will the office close early?",
            choices: ["Friday", "Monday", "Tuesday", "Sunday"],
            answer: "Friday",
            explanation: "The notice says the office will close early on Friday.",
          },
        ],
        targetWords: ["submit"],
      }),
    );

    expect(assessReadingQuality(context).score).toBeLessThan(4);
  });

  it("parses article practice sets", () => {
    const article = parseArticlePractice(
      JSON.stringify({
        type: "article_practice",
        title: "New Visitor Policy",
        documentType: "article",
        passage: [
          "The company introduced a new visitor policy this week.",
          "All guests must register at the front desk before entering.",
          "The updated process is intended to improve security.",
          "Employees should notify reception before a client arrives.",
          "Visitors will receive temporary badges after registration.",
          "The facilities team will review the policy next month.",
          "Managers may submit feedback by Friday.",
          "A short training session will be offered on Monday.",
        ],
        targetWords: ["register", "notify", "submit"],
        questions: [
          {
            prompt: "What is the main purpose of the policy?",
            choices: ["To improve security", "To reduce salaries", "To replace managers", "To cancel meetings"],
            answer: "To improve security",
            explanation: "The passage states that the updated process is intended to improve security.",
          },
          {
            prompt: "What should employees do before a client arrives?",
            choices: ["Notify reception", "Close the office", "Print invoices", "Cancel training"],
            answer: "Notify reception",
            explanation: "The passage says employees should notify reception before a client arrives.",
          },
          {
            prompt: "What may managers submit?",
            choices: ["Feedback", "Badges", "Visitors", "Security desks"],
            answer: "Feedback",
            explanation: "Managers may submit feedback by Friday according to the final section.",
          },
        ],
        vocabularyNotes: [
          { word: "register", meaningVi: "dang ky", contextMeaning: "sign in at the front desk" },
          { word: "notify", meaningVi: "thong bao", contextMeaning: "tell reception in advance" },
          { word: "submit", meaningVi: "nop", contextMeaning: "send feedback for review" },
        ],
      }),
    );

    expect(article.targetWords).toEqual(["register", "notify", "submit"]);
    expect(article.questions).toHaveLength(3);
  });

  it("parses speaking practice sets", () => {
    const practice = parseSpeakingPractice(
      JSON.stringify({
        type: "speaking_practice",
        title: "Introduction Scene",
        topic: "Introductions",
        passageText: "Hello, my name is John. Nice to meet you.",
        sentences: [
          {
            text: "Hello, my name is John.",
            ipa: "həˈləʊ, maɪ neɪm ɪz ʤɒn.",
            words: [
              { word: "Hello", ipa: "həˈləʊ", startMs: 0, endMs: 500 },
              { word: "my", ipa: "maɪ", startMs: 500, endMs: 800 },
              { word: "name", ipa: "neɪm", startMs: 800, endMs: 1200 },
              { word: "is", ipa: "ɪz", startMs: 1200, endMs: 1400 },
              { word: "John", ipa: "ʤɒn", startMs: 1400, endMs: 2000 },
            ],
            connectedSpeech: [
              { from: "name", to: "is", type: "linking", symbol: "‿", explanation: "Consonant to vowel" }
            ]
          },
          {
            text: "Nice to meet you.",
            ipa: "naɪs tuː miːt juː.",
            words: [
              { word: "Nice", ipa: "naɪs", startMs: 2500, endMs: 3000 },
              { word: "to", ipa: "tuː", startMs: 3000, endMs: 3300 },
              { word: "meet", ipa: "miːt", startMs: 3300, endMs: 3700 },
              { word: "you", ipa: "juː", startMs: 3700, endMs: 4200 },
            ],
            connectedSpeech: [
              { from: "meet", to: "you", type: "assimilation", symbol: "‿", explanation: "/t/ + /j/ -> /tʃ/" }
            ]
          }
        ]
      })
    );

    expect(practice.title).toBe("Introduction Scene");
    expect(practice.sentences).toHaveLength(2);
    expect(practice.sentences[0].words).toHaveLength(5);
    expect(practice.sentences[0].connectedSpeech).toHaveLength(1);
    expect(practice.sentences[0].connectedSpeech[0].type).toBe("linking");
  });
});
