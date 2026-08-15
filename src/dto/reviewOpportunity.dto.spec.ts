import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { QueryReviewOpportunityDto } from './reviewOpportunity.dto';

describe('QueryReviewOpportunityDto', () => {
  it('accepts createdAt as a review-opportunity sort field', async () => {
    const dto = plainToInstance(QueryReviewOpportunityDto, {
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('still rejects unknown sort fields', async () => {
    const dto = plainToInstance(QueryReviewOpportunityDto, {
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'sortBy' })]),
    );
  });
});
