/**
 * Authentication-related configuration
 */
export const AuthConfig = {
  // Global JWT secret used for token validation
  authSecret: process.env.AUTH_SECRET,

  // JSON array string of allowed issuers
  validIssuers:
    process.env.VALID_ISSUERS ||
    '["https://testsachin.topcoder-dev.com/","https://test-sachin-rs256.auth0.com/","https://api.topcoder.com","https://api.topcoder-dev.com","https://topcoder-dev.auth0.com/","https://auth.topcoder-dev.com/","https://topcoder.auth0.com/","https://auth.topcoder.com/"]',

  // Legacy JWT configuration (kept for backward compatibility)
  jwt: {
    // The Auth0 issuer used to validate tokens
    issuer: process.env.AUTH0_ISSUER || 'https://topcoder-dev.auth0.com/',

    // The audience(s) that are valid for the token
    audience: process.env.TOKEN_AUDIENCE || 'https://m2m.topcoder-dev.com/',

    // Clock tolerance for token expiration time (in seconds)
    clockTolerance: 30,

    // Whether to enforce token expiration
    ignoreExpiration: process.env.NODE_ENV !== 'production',
  },
};
