# Review API v6 Prisma client

This directory is the supported database-client boundary for read-only service
consumers such as `opportunities-api-v6`. Its stable package name is
`@topcoder/review-api-v6-prisma-client`.

Install this directory as a workspace or file dependency, then import its stable
package name and pass the review database URL explicitly:

```json
{
  "dependencies": {
    "@topcoder/review-api-v6-prisma-client": "github:topcoder-platform/review-api-v6#<commit>&path:packages/review-prisma-client"
  }
}
```

```ts
import { createReviewPrismaClient } from '@topcoder/review-api-v6-prisma-client';

const review = createReviewPrismaClient(process.env.REVIEW_DB_URL!);
const openCount = await review.reviewOpportunity.count({
  where: { status: 'OPEN' },
});

await review.$disconnect();
```

The factory returns the generated Prisma client while hiding the Prisma 6
constructor's datasource option shape. Importing generated enums and types from
the same entry point is supported. Direct imports from `generated/` are exposed
for advanced consumers, but application code should prefer the factory.

The package declares the matching Prisma 6 runtime as a production dependency,
so GitHub-subdirectory and packed installations are self-contained. Keep that
version aligned with the generator used by review-api-v6 whenever Prisma is
upgraded.

Run `pnpm exec prisma generate` from the review-api-v6 repository root after
every schema change. Both the internal client and this checked-in external
client are generated from `prisma/schema.prisma`.
