/**
 * Pure self-consult helpers for unattended (auto) Sessions. When a question
 * would be presented to a human who is not there, the Question service asks
 * the model itself to choose the best course of action and resolves the
 * question with that answer — deterministic fallback to the first option if
 * the consult is unavailable, so an autonomous run never blocks.
 */
import { QuestionV1 } from "@prioricode/schema/question-v1"

export type ConsultQuestion = typeof QuestionV1.Prompt.Type
export type ConsultOption = typeof QuestionV1.Option.Type
export type ConsultAnswer = typeof QuestionV1.Answer.Type

export const CONSULT_SYSTEM =
  "You are answering decision questions on behalf of a coding agent running unattended (auto mode, no human present). " +
  "Choose the best course of action for the user's original goal. Prefer the option that keeps work moving safely, " +
  "matches the user's stated preferences, and avoids destructive, privacy-invasive, or irreversible actions."

export function fallbackAnswers(questions: ReadonlyArray<ConsultQuestion>): ReadonlyArray<ConsultAnswer> {
  return questions.map((question) => [question.options[0]?.label ?? "yes"])
}

export function buildConsultPrompt(
  questions: ReadonlyArray<ConsultQuestion>,
  context: string,
): string {
  const block = questions
    .map((question, index) => {
      const options = question.options
        .map((option: ConsultOption, position) => `  ${position + 1}. ${option.label} — ${option.description}`)
        .join("\n")
      const mode = question.multiple ? "choose ALL applicable" : "choose exactly ONE"
      return `Question ${index + 1} (${mode}): ${question.question}\nOptions:\n${options}`
    })
    .join("\n\n")
  const lines = questions.map((_, index) => `Question ${index + 1}: <label>`).join("\n")
  return [
    context ? `Recent conversation:\n${context}\n` : "",
    "A decision that would normally be put to the user needs to be made:",
    block,
    "",
    `Answer with exactly ${questions.length} line${questions.length === 1 ? "" : "s"}, one per question, in this form:`,
    lines,
    "Use the exact option labels. For a 'choose ALL applicable' question, separate multiple labels with commas.",
    "No other text.",
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function parseConsult(text: string, questions: ReadonlyArray<ConsultQuestion>): ReadonlyArray<ConsultAnswer> {
  const fallback = fallbackAnswers(questions)
  return questions.map((question, index) => {
    const match = text.match(new RegExp(`question\\s*${index + 1}\\s*[:\\-–]\\s*(.+)`, "i"))
    const raw = match?.[1]?.trim()
    if (!raw) return fallback[index]
    const wanted = raw
      .split(/\s*,\s*/)
      .map((label) => label.trim().replace(/[.!]+$/, "").toLowerCase())
      .filter((label) => label.length > 0)
    const matched: string[] = []
    for (const option of question.options) {
      const label = option.label.toLowerCase()
      if (wanted.some((candidate) => candidate === label || candidate.includes(label) || label.includes(candidate)))
        matched.push(option.label)
      if (!question.multiple && matched.length > 0) break
    }
    if (matched.length > 0) return matched
    return fallback[index]
  })
}
