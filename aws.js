const crypto = require('crypto')
const cron_converter = require('./cron_converter');

const { fromIni } = require("@aws-sdk/credential-provider-ini")
const {
  LambdaClient,
  GetFunctionCommand,
  AddPermissionCommand,
  RemovePermissionCommand,
  InvokeCommand
} = require("@aws-sdk/client-lambda");
const {
  EventBridgeClient,
  ListRulesCommand,
  PutRuleCommand,
  PutTargetsCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand
} = require("@aws-sdk/client-eventbridge")

const AWS_REGION = process.env.AWS_REGION || "ap-southeast-2"
const AWS_PROFILE = process.env.AWS_PROFILE
const AWS_LAMBDA_DEFAULT_FUNCTION = process.env.AWS_LAMBDA_DEFAULT_FUNCTION || "lambda-function-name"
const ENV = (process.env.ENV || process.env.NODE_ENV) || "dev"
const PREFIX = process.env.RULE_PREFIX || `rule-${ENV}`

let client, lambdaClient

const getAwsParams = () => {
  const params = {region: AWS_REGION}
  if(AWS_PROFILE) {
    params.credentials = fromIni({profile: AWS_PROFILE})
  }
  return params
}

const getClient = () => {
  if(!client) {
    const params = getAwsParams()
    client = new EventBridgeClient(params)
  }
  return client
}

const getLambdaClient = () => {
  if(!lambdaClient) {
    const params = getAwsParams()
    lambdaClient = new LambdaClient(params)
  }
  return lambdaClient
}

const getLambdaArn = async (functionName = AWS_LAMBDA_DEFAULT_FUNCTION) => {
  lambdaClient = getLambdaClient()
  const {Configuration} = await lambdaClient.send(new GetFunctionCommand({FunctionName: functionName}))
  return Configuration.FunctionArn
}

const getRules = async (prefix = PREFIX) => {
  const command = new ListRulesCommand({NamePrefix: prefix})
  const rules = await getClient().send(command)
  return rules.Rules || []
}

const getRuleName = (job, args, cron) => {
  const hash = crypto.createHash('md5').update(`${job}/${JSON.stringify(args)}/${cron}`).digest('hex');
  return `${PREFIX}-${job.replace(/:/g, "_")}-${hash}`.slice(0, 64)
}

const addLambdaPermission = async (lambdaFunctionName = AWS_LAMBDA_DEFAULT_FUNCTION, ruleName, ruleArn) => {
  lambdaClient = getLambdaClient()

  const response = await lambdaClient.send(new AddPermissionCommand({
    FunctionName: lambdaFunctionName,
    StatementId: `trigger-cron-${ruleName}`,
    Action: "lambda:InvokeFunction",
    Principal: "events.amazonaws.com",
    SourceArn: ruleArn
  }))
}

const removeLambdaPermission = async (lambdaFunctionName = AWS_LAMBDA_DEFAULT_FUNCTION, ruleName) => {
  lambdaClient = getLambdaClient()

  const response = await lambdaClient.send(new RemovePermissionCommand({
    FunctionName: lambdaFunctionName,
    StatementId: `trigger-cron-${ruleName}`,
  }))
}

const createRule = async (job, args, cron, description, lambdaFunctionName = AWS_LAMBDA_DEFAULT_FUNCTION) => {
  const name = getRuleName(job, args, cron)
  const lambdaArn = await getLambdaArn()

  let command, response
  const rules = await getRules()
  if(!rules.find(r => r.Name === name)) {
    const cronExpression = cron_converter(cron)
    command = new PutRuleCommand({
      Name: name,
      State: "ENABLED",
      ScheduleExpression: `cron(${cronExpression})`,
      Description: `${description ? `${description} - ` : ""}${job} ${JSON.stringify(args)} (${cron})`
    });
    response = await getClient().send(command)

    await addLambdaPermission(lambdaFunctionName, name, response.RuleArn)
  }

  command = new PutTargetsCommand({
    Rule: name,
    Targets: [
      {
        Id: lambdaFunctionName,
        Arn: lambdaArn,
        Input: JSON.stringify({job,args})
      }
    ]
  })
  response = await getClient().send(command)
}


const deleteRule = async (job, args, cron, lambdaFunctionName = AWS_LAMBDA_DEFAULT_FUNCTION,) => {
  const name = getRuleName(job, args, cron)

  await getClient().send(new RemoveTargetsCommand({
    Rule: name,
    Ids: [lambdaFunctionName]
  }))

  await getClient().send(new DeleteRuleCommand({
    Name: name,
  }))

  await removeLambdaPermission(lambdaFunctionName, name)
}

const callLambda = async (job, args, lambdaFunctionName = AWS_LAMBDA_DEFAULT_FUNCTION) => {
  await getLambdaClient().send(new InvokeCommand({
    FunctionName: lambdaFunctionName,
    Payload: JSON.stringify({job,args}),
    InvocationType: 'Event'
  }))
}

module.exports = {
  getRules,
  createRule,
  deleteRule,
  callLambda
}