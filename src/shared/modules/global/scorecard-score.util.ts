export type ScorecardQuestionAnswer = string | number | null | undefined;

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export const computeQuestionScore = (
  type: string | null | undefined,
  scaleMin: number | null | undefined,
  scaleMax: number | null | undefined,
  answer: ScorecardQuestionAnswer,
): number => {
  if (answer === undefined || answer === null) {
    return 0;
  }

  const normalizedType = String(type ?? '').toUpperCase();
  if (normalizedType === 'YES_NO') {
    return String(answer).toUpperCase() === 'YES' || answer === 1 ? 100 : 0;
  }

  if (normalizedType === 'SCALE' || normalizedType === 'TEST_CASE') {
    const min = typeof scaleMin === 'number' ? scaleMin : 0;
    const max = typeof scaleMax === 'number' ? scaleMax : 0;
    const numericAnswer = typeof answer === 'number' ? answer : Number(answer);
    if (!Number.isFinite(numericAnswer) || max === min) {
      return 0;
    }

    const normalized = ((numericAnswer - min) / (max - min)) * 100;
    return Math.min(100, Math.max(0, normalized));
  }

  return 0;
};

export const computeScorecardTotal = (
  scorecard: {
    scorecardGroups?: Array<{
      weight?: number | null;
      sections?: Array<{
        weight?: number | null;
        questions?: Array<{
          id: string;
          type?: string | null;
          scaleMin?: number | null;
          scaleMax?: number | null;
          weight?: number | null;
        }>;
      }>;
    }>;
  },
  answers: Map<string, ScorecardQuestionAnswer>,
): number => {
  if (!scorecard?.scorecardGroups?.length) {
    return 0;
  }

  const totalGroupWeight = scorecard.scorecardGroups.reduce(
    (sum, group) => sum + (group.weight ?? 0),
    0,
  );

  let totalScore = 0;

  for (const group of scorecard.scorecardGroups) {
    const groupWeightNorm = totalGroupWeight
      ? (group.weight ?? 0) / totalGroupWeight
      : 1 / Math.max(1, scorecard.scorecardGroups.length);

    const totalSectionWeight =
      group.sections?.reduce(
        (sum, section) => sum + (section.weight ?? 0),
        0,
      ) ?? 0;

    let groupScore = 0;

    for (const section of group.sections ?? []) {
      const sectionWeightNorm = totalSectionWeight
        ? (section.weight ?? 0) / totalSectionWeight
        : 1 / Math.max(1, group.sections?.length ?? 1);

      const totalQuestionWeight =
        section.questions?.reduce(
          (sum, question) => sum + (question.weight ?? 0),
          0,
        ) ?? 0;

      let sectionScore = 0;

      for (const question of section.questions ?? []) {
        const questionWeightNorm = totalQuestionWeight
          ? (question.weight ?? 0) / totalQuestionWeight
          : 1 / Math.max(1, section.questions?.length ?? 1);

        const answer = answers.get(question.id) ?? null;
        const questionValue = computeQuestionScore(
          question.type ?? null,
          question.scaleMin ?? null,
          question.scaleMax ?? null,
          answer,
        );

        sectionScore += questionValue * questionWeightNorm;
      }

      groupScore += sectionScore * sectionWeightNorm;
    }

    totalScore += groupScore * groupWeightNorm;
  }

  return round2(totalScore);
};

export const computeScoresFromItems = <
  Item extends {
    scorecardQuestionId: string;
    initialAnswer?: ScorecardQuestionAnswer;
    finalAnswer?: ScorecardQuestionAnswer;
  },
>(
  scorecard: {
    scorecardGroups?: Array<{
      weight?: number | null;
      sections?: Array<{
        weight?: number | null;
        questions?: Array<{
          id: string;
          type?: string | null;
          scaleMin?: number | null;
          scaleMax?: number | null;
          weight?: number | null;
        }>;
      }>;
    }>;
  },
  items: Item[],
): { initialScore: number | null; finalScore: number | null } => {
  const answersByQuestion = new Map(
    items.map((item) => [item.scorecardQuestionId, item]),
  );

  const initialAnswers = new Map<string, ScorecardQuestionAnswer>();
  const finalAnswers = new Map<string, ScorecardQuestionAnswer>();

  for (const group of scorecard.scorecardGroups ?? []) {
    for (const section of group.sections ?? []) {
      for (const question of section.questions ?? []) {
        const item = answersByQuestion.get(question.id);
        initialAnswers.set(question.id, item?.initialAnswer ?? null);
        finalAnswers.set(
          question.id,
          item?.finalAnswer ?? item?.initialAnswer ?? null,
        );
      }
    }
  }

  return {
    initialScore: computeScorecardTotal(scorecard, initialAnswers),
    finalScore: computeScorecardTotal(scorecard, finalAnswers),
  };
};
