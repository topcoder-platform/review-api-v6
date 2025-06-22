export const M2mConfig = {
  auth0: {
    url: process.env.M2M_AUTH_URL ?? 'http://localhost:4000/oauth/token',
    domain: process.env.M2M_AUTH_DOMAIN ?? 'topcoder-dev.auth0.com',
    audience: process.env.M2M_AUTH_AUDIENCE ?? 'https://m2m.topcoder-dev.com/',
    proxyUrl: process.env.M2M_AUTH_PROXY_SERVER_URL,
    clientId: process.env.M2M_AUTH_CLIENT_ID,
    clientSecret: process.env.M2M_AUTH_CLIENT_SECRET,
  },
};
