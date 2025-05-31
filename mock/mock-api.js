const express = require('express')
const winston = require('winston')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())
app.set('port', 4000)

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      level: 'debug',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ]
});

// Event bus
app.post('/eventBus', (req, res) => {
  logger.info(`Event Bus received message: ${JSON.stringify(req.body)}`);
  res.statusCode = 200;
  res.json({})
})

const m2mToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3RvcGNvZGVyLWRldi5hdXRoMC5jb20vIiwic3ViIjoiakdJZjJwZDNmNDRCMWpxdk9haTMwQklLVFphbllCZlVAY2xpZW50cyIsImF1ZCI6Imh0dHBzOi8vbTJtLnRvcGNvZGVyLWRldi5jb20vIiwiaWF0IjoxNzQ4MDk5NDk4LCJleHAiOjE4NDgxODU4OTgsInNjb3BlIjoid3JpdGU6YnVzX2FwaSxhbGw6Y2hhbGxlbmdlcyIsImd0eSI6ImNsaWVudC1jcmVkZW50aWFscyIsImF6cCI6ImpHSWYycGQzZjQ0QjFqcXZPYWkzMEJJS1RaYW5ZQmZVIn0.h3ksdsdJm5USGF1VgROrpkTtStmCzv5ZA6y8bd8AnGY';

const m2mScope = 'write:bus_api,all:challenges';

// Auth0
app.post('/oauth/token', (req, res) => {
  logger.info('Getting M2M tokens')
  res.json({
    access_token: m2mToken,
    scope: m2mScope,
    expires_in: 94608000,
    token_type: 'Bearer'
  })
})

// Member API
app.get('/members', (req, res) => {
  logger.info(`Member API receives params: ${JSON.stringify(req.query)}`)
  let userIdStr = req.query.userIds
  userIdStr = userIdStr.replaceAll('[', '').replaceAll(']', '')
  const userIds = userIdStr.split(',')
  // return result
  const ret = userIds.map(id => ({
    userId: parseInt(id),
    email: `${id}@topcoder.com`
  }))
  res.json(ret)
})

// Challenge API
app.get('/challenges/:id', (req, res) => {
  // directly challenge details
  const id = req.params.id
  logger.info(`Getting challenge with id ${id}`)
  if (id === '11111111-2222-3333-9999-444444444444') {
    res.statusCode = 404
    res.json({})
    return
  }
  res.json({
    id,
    name: `Test Challenge ${id}`,
    legacy: {
      track: 'DEVELOP',
      subTrack: 'CODE'
    },
    numOfSubmissions: 2,
    legacyId: 30376875,
    tags: ['Prisma', 'NestJS']
  })
})


app.listen(app.get('port'), '0.0.0.0', () => {
  logger.info(`Express server listening on port ${app.get('port')}`)
})

