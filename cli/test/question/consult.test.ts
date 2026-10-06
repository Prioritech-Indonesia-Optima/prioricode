import { expect, test } from "bun:test"
import { buildConsultPrompt, fallbackAnswers, parseConsult, type ConsultQuestion } from "@/question/consult"

const one: ConsultQuestion = {
  question: "Should I run the migration now?",
  header: "Migration",
  options: [
    { label: "Yes", description: "Apply it" },
    { label: "No", description: "Hold off" },
  ],
}

const two: ConsultQuestion[] = [
  one,
  {
    question: "Which suites to run?",
    header: "Tests",
    multiple: true,
    options: [
      { label: "unit", description: "Unit tests" },
      { label: "e2e", description: "End to end" },
    ],
  },
]

test("fallbackAnswers picks the first option label", () => {
  expect(fallbackAnswers(two)).toEqual([["Yes"], ["unit"]])
})

test("fallbackAnswers tolerates an option-less question", () => {
  expect(fallbackAnswers([{ question: "q", header: "h", options: [] }])).toEqual([["yes"]])
})

test("buildConsultPrompt lists every question and the answer contract", () => {
  const prompt = buildConsultPrompt(two, "User: please add auth")
  expect(prompt).toContain("Question 1")
  expect(prompt).toContain("Should I run the migration now?")
  expect(prompt).toContain("Question 2")
  expect(prompt).toContain("choose ALL applicable")
  expect(prompt).toContain("User: please add auth")
  expect(prompt).toContain("Question 1: <label>")
})

test("buildConsultPrompt omits the context block when there is none", () => {
  const prompt = buildConsultPrompt([one], "")
  expect(prompt).not.toContain("Recent conversation")
})

test("parseConsult maps a well-formed answer to option labels", () => {
  expect(parseConsult("Question 1: Yes", [one])).toEqual([["Yes"]])
})

test("parseConsult matches case-insensitively and ignores trailing punctuation", () => {
  expect(parseConsult("question 1: yes.", [one])).toEqual([["Yes"]])
})

test("parseConsult honours multiple-select lines", () => {
  expect(parseConsult("Question 1: No\nQuestion 2: unit, e2e", two)).toEqual([["No"], ["unit", "e2e"]])
})

test("parseConsult falls back to the first option when the line is missing", () => {
  expect(parseConsult("something unrelated", [one])).toEqual([["Yes"]])
})

test("parseConsult falls back when no option matches the answer text", () => {
  expect(parseConsult("Question 1: maybe later", [one])).toEqual([["Yes"]])
})

test("parseConsult keeps first-option fallback per question independently", () => {
  expect(parseConsult("Question 1: No\nQuestion 2: bogus", two)).toEqual([["No"], ["unit"]])
})
