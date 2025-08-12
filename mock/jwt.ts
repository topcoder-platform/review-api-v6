import * as jwt from 'jsonwebtoken';
import { Scope } from '../src/shared/enums/scopes.enum';
import { UserRole } from '../src/shared/enums/userRole.enum';

const commonFields = {
  exp: 1845393226,
  iss: 'https://topcoder-dev.com'
};

const authSecret = 'secret';

const adminPayload = {
  roles: [UserRole.Admin],
  handle: 'admin',
  userId: 123,
  ...commonFields
};

console.log('------------- Admin Token -------------');
console.log(jwt.sign(adminPayload, authSecret));

const m2mPayload = {
  scope: `${Scope.AllReview} ${Scope.AllSubmission} ${Scope.AllAppeal} ${Scope.AllReviewSummation}`,
  sub: 'auth0|clients',
  ...commonFields
};

console.log('------------- Full M2M token -------------');
console.log(jwt.sign(m2mPayload, authSecret));

const userPayload = {
  roles: [UserRole.User],
  handle: 'user',
  userId: 124,
  ...commonFields
};

console.log('------------- User Token -------------');
console.log(jwt.sign(userPayload, authSecret));


const reviewerPayload = {
  roles: [UserRole.Reviewer],
  handle: 'reviewer',
  userId: 125,
  ...commonFields
};

console.log('------------- Reviewer Token -------------');
console.log(jwt.sign(reviewerPayload, authSecret));
