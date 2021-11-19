const express = require('express')
const axios = require('axios')
const cron = require('node-cron')
const { v4: uuid } = require('uuid');

const { getRules, createRule, deleteRule, callLambda } = require('./aws')

const app = express()
const port = process.env.PORT || 3131

const REMOTE_LAMBDA = process.env.REMOTE_LAMBDA === "true"

const lambdaProtocol = process.env.LAMBDA_PROTOCOL || 'http'
const lambdaPort = process.env.LAMBDA_PORT || '9000'
const lambdaHost = process.env.LAMBDA_HOST || 'localhost'
const lambdaEndpoint = process.env.LAMBDA_ENDPOINT || "/2015-03-31/functions/function/invocations"
const lambdaProxy = process.env.LAMBDA_PROXY || `${lambdaProtocol}://${lambdaHost}${lambdaPort.length ? `:${lambdaPort}` : ""}${lambdaEndpoint}`

app.use(express.urlencoded({ extended: false }))
app.use(express.json())

const checkJob = ({job, args}) => {
  if(!job)      throw new Error("Missing 'job' parameter")
  else if(!args)  args = []
  let json
  try {
    json = JSON.parse(args)
  } catch(err) {
    throw new Error("Invalid 'args' parameter")
  }
  return [job, json]
}

/* Functions */
const executeJob = (req, in_ms = 0) => {
  const [job, json] = checkJob(req.query)
  let fn
  if(REMOTE_LAMBDA) {
    fn = () => callLambda(job, json, lambdaFunctionName = AWS_LAMBDA_DEFAULT_FUNCTION)
  } else {
    fn = () => axios({
      method: 'POST',
      url: lambdaProxy,
      data: {
        job,
        args: json
      }
    })
  }

  const hash = uuid()

  console.log(`Job ${hash} (${job} ${JSON.stringify(json)}) => in ${in_ms}ms (${new Date(Date.now()+in_ms)})...`)
  setTimeout(() => {
    fn()
    .then(_ => console.log(`Job ${hash} executed at ${Date.now()}`))
    .catch(err => console.log(`Job ${hash} executed with error at ${Date.now()} (Error:${err.message})`))
  }, (in_ms || 0))
}

/* Endpoints */

app.get('/process', (req, res) => {
  try {
    executeJob(req, 10)
    res.send("Success")
  } catch(err) {
    res.status(err.code || 400).send(err.message)
  }
})

app.get('/process_at', (req, res) => {
  const {at} = req.query
  if(!at) return res.status(400).send('Missing at parameter')

  let at_ms
  try {
    if(at.length === 13)       at_ms = parseInt(at)
    else if(at.length === 10)  at_ms = parseInt(at) * 1000
    else at_ms = (new Date(at)).getTime()
  } catch(err) {
    return res.status(400).send("'at' parameter must be a 10 or 13 digits long, or a date in ISO format")
  }

  const in_ms = at_ms-Date.now()
  if(in_ms <= 0)  return res.status(400).send("'at' parameter is in the past")

  try {
    executeJob(req, in_ms)
    res.send("Success")
  } catch(err) {
    res.status(err.code || 400).send(err.message)
  }
})

app.get('/process_in', (req, res) => {
  const iin = req.query["in"]
  if(!iin) return res.status(400).send("Missing 'in' parameter")

  let in_ms
  try {
    if(iin.endsWith("d") || iin.endsWith("day") || iin.endsWith("days") || iin.endsWith("seconds"))
      in_ms = parseInt(iin) * 1000 * 3600 * 24
    else if(iin.endsWith("h") || iin.endsWith("hrs") || iin.endsWith("hr") || iin.endsWith("hour") || iin.endsWith("hours"))
      in_ms = parseInt(iin) * 1000 * 3600
    else if(iin.endsWith("m") || iin.endsWith("min") || iin.endsWith("minute") || iin.endsWith("minutes"))
      in_ms = parseInt(iin) * 1000 * 60
    else if(iin.endsWith("s") || iin.endsWith("sec") || iin.endsWith("second") || iin.endsWith("seconds"))
      in_ms = parseInt(iin) * 1000
    else  in_ms = parseInt(iin) * 1000
  } catch(err) {
    if(!in_ms) return res.status(400).send("'in' parameter must be a valid number")
  }

  try {
    executeJob(req, in_ms)
    res.send("Success")
  } catch(err) {
    res.status(err.code || 400).send(err.message)
  }
})

app.put('/schedule', async (req, res) => {
  let crt = req.query["cron"]
  if(!crt) return res.status(400).send("Missing 'cron' parameter")

  try {
    const [job, json] = checkJob(req.query)
    if(REMOTE_LAMBDA) {
      await createRule(job, json, crt, req.query["description"])
    } else {
      cron.schedule(crt, () => {
        executeJob(req)
      })
    }
    console.log(`Job scheduled: ${job} ${JSON.stringify(json)} cron:${crt}`)

    res.send("Success")
  } catch(err) {
    res.status(400).send(err.message)
  }
})

app.delete('/schedule', async (req, res) => {
  let crt = req.query["cron"]
  if(!crt) return res.status(400).send("Missing 'cron' parameter")

  try {
    const [job, json] = checkJob(req.query)
    if(REMOTE_LAMBDA) {
      await deleteRule(job, json, crt)
    } else {
      cron.schedule(crt, () => {
        executeJob(req)
      })
    }
    console.log(`Job scheduled: ${job} ${JSON.stringify(json)} cron:${crt}`)

    res.send("Success")
  } catch(err) {
    res.status(400).send(err.message)
  }
})

app.get('/schedule', async (req, res) => {
  try {
    const rules = await getRules(null)
    res.send(rules)
  } catch(err) {
    res.status(500).send(err.message)
  }
})

/* Server */

const server = app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})

let connections = [];
server.on('connection', connection => {
  connections.push(connection);
  connection.on('close', () => connections = connections.filter(curr => curr !== connection));
})

const shutDown = () => {
  console.log('Received kill signal, shutting down gracefully');
  server.close(() => {
      console.log('Closed out remaining connections');
      process.exit(0);
  });

  setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
  }, 10000);

  connections.forEach(curr => curr.end());
  setTimeout(() => connections.forEach(curr => curr.destroy()), 5000);
}

process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);