import type {
  DailySubmissionAnswerRow,
  DailySubmissionRow,
} from "@/app/actions/daily-runs";

type DailyResponsesByQuestionProps = {
  submissions: DailySubmissionRow[];
  submissionAnswers: DailySubmissionAnswerRow[];
  people: Array<{ id: string; full_name: string }>;
  orderedQuestionTexts?: string[];
};

type AnswerItem = {
  personId: string;
  personName: string;
  answerText: string;
};

function isBlockerQuestion(questionText: string) {
  const normalized = questionText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return (
    normalized === "are there any blockers or risks?" ||
    normalized.includes("blocker") ||
    normalized.includes("bloqueo")
  );
}

export function DailyResponsesByQuestion({
  submissions,
  submissionAnswers,
  people,
  orderedQuestionTexts,
}: DailyResponsesByQuestionProps) {
  const personNameById = new Map(people.map((person) => [person.id, person.full_name]));

  const submissionIds = new Set(submissions.map((submission) => submission.id));
  const answersBySubmission = new Map<string, DailySubmissionAnswerRow[]>();
  for (const answer of submissionAnswers) {
    if (!submissionIds.has(answer.submission_id)) continue;
    const list = answersBySubmission.get(answer.submission_id) ?? [];
    list.push(answer);
    answersBySubmission.set(answer.submission_id, list);
  }

  const sourceOrder =
    orderedQuestionTexts ??
    Array.from(new Set(submissionAnswers.filter((a) => submissionIds.has(a.submission_id)).map((a) => a.question_text)));
  const order = sourceOrder.filter((questionText) => !isBlockerQuestion(questionText));
  order.push(...sourceOrder.filter(isBlockerQuestion));

  const columns = order.map((questionText) => {
    const items: AnswerItem[] = [];
    for (const submission of submissions) {
      const answers = answersBySubmission.get(submission.id) ?? [];
      for (const answer of answers) {
        if (answer.question_text !== questionText) continue;
        items.push({
          personId: submission.user_id,
          personName: personNameById.get(submission.user_id) ?? "Miembro de soporte",
          answerText: answer.answer_text,
        });
      }
    }
    return { questionText, items };
  });

  return (
    <div className="daily-responses-grid">
      {columns.map((column) => (
        <section className="daily-question-col" key={column.questionText}>
          <header className="daily-question-col-header">
            <h3>{column.questionText}</h3>
            <span className="daily-question-col-count">{column.items.length}</span>
          </header>
          {column.items.length === 0 ? (
            <p className="daily-question-col-empty muted">Sin respuestas todavía.</p>
          ) : (
            <ul className="daily-response-list">
              {column.items.map((item, index) => (
                <li className="daily-response-item" key={`${item.personId}-${index}`}>
                  <p className="daily-response-person">{item.personName}</p>
                  <p className="daily-response-answer">{item.answerText}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
