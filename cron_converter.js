const cron = require('node-cron')

const DOW_MAP = {
  1: 'SUN',
  2: 'MON',
  3: 'TUE',
  4: 'WED',
  5: 'THU',
  6: 'FRI',
  7: 'SAT'
}

module.exports = (crontab) => {
  if(!crontab) throw new Error('cron is required');
  else if (!cron.validate(crontab)) throw new Error('crontab is invalid');

  let [minute, hours, dom, month, dow] = crontab.split(' ')

  console.log(`${minute} ${hours} ${dom} ${month} ${dow}`)

  if(dow !== '*') {
    const split = dow.split('-')
    dow = split.map(s => DOW_MAP[s]).join("-")
    console.log(exp)
    dom = "?"
  } else {
    dow = "?"
    dom = "*"
  }

  return [minute, hours, dom, month, dow, "*"].join(" ")
}