/**
 * Authentication-related configuration
 */
export const AuthConfig = {
  // Used for validating JSON Web Tokens
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