import { DECORATORS } from '@nestjs/swagger';

import { AiReviewDecisionStatus } from './aiReviewDecision.dto';
import { SubmissionResponseDto } from './submission.dto';

describe('SubmissionResponseDto', () => {
  it('documents submission and AI decision scores in the Swagger contract', () => {
    const properties = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES_ARRAY,
      SubmissionResponseDto.prototype,
    );

    expect(properties).toEqual(
      expect.arrayContaining([
        ':finalScore',
        ':aiDecisionScore',
        ':aiDecisionStatus',
      ]),
    );

    const finalScore = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      SubmissionResponseDto.prototype,
      'finalScore',
    );
    const aiDecisionScore = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      SubmissionResponseDto.prototype,
      'aiDecisionScore',
    );
    const aiDecisionStatus = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      SubmissionResponseDto.prototype,
      'aiDecisionStatus',
    );

    expect(finalScore).toEqual(
      expect.objectContaining({
        required: false,
        nullable: true,
        type: Number,
      }),
    );
    expect(aiDecisionScore).toEqual(
      expect.objectContaining({
        required: false,
        nullable: true,
        type: Number,
      }),
    );
    expect(aiDecisionStatus).toEqual(
      expect.objectContaining({
        required: false,
        enum: Object.values(AiReviewDecisionStatus),
      }),
    );
  });
});
