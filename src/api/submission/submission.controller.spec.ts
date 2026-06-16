jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { SCOPES_KEY } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import { SubmissionController } from './submission.controller';

describe('SubmissionController', () => {
  it('allows Marathon Match service scopes on validation upload', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      SubmissionController.prototype,
      'validationUploadSubmission',
    );
    const scopes = Reflect.getMetadata(SCOPES_KEY, descriptor?.value as object);

    expect(descriptor?.value).toBeDefined();
    expect(scopes).toEqual(
      expect.arrayContaining([
        Scope.CreateSubmission,
        Scope.UpdateMarathonMatch,
        Scope.AllMarathonMatch,
      ]),
    );
  });
});
