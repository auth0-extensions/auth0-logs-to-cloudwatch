const AWS = require('aws-sdk');
const moment = require('moment');
const loggingTools = require('auth0-log-extension-tools');

const config = require('./config');
const logger = require('./logger');

module.exports = (storage) =>
  (req, res, next) => {
    const wtBody = (req.webtaskContext && req.webtaskContext.body) || req.body || {};
    const wtHead = (req.webtaskContext && req.webtaskContext.headers) || {};
    const isCron = (wtBody.schedule && wtBody.state === 'active') || (wtHead.referer === 'https://manage.auth0.com/' && wtHead['if-none-match']);

    if (!isCron) {
      return next();
    }

    AWS.config.update({
      accessKeyId: config('AWS_ACCESS_KEY_ID'),
      secretAccessKey: config('AWS_SECRET_KEY'),
      region: config('AWS_REGION')
    });

    const cwOpts = {
      stream: config('CLOUDWATCH_LOG_STREAM_NAME'),
      group: config('CLOUDWATCH_LOG_GROUP_NAME'),
      token: null
    };

    const cWatch = new AWS.CloudWatchLogs({ apiVersion: '2014-03-28' });

    const updateSequenceToken = (cb) => {
      const options = {
        logGroupName: cwOpts.group,
        logStreamNamePrefix: cwOpts.stream,
        limit: 1
      };
      cWatch.describeLogStreams(options, (err, result) => {
        if (result &&
          result.logStreams &&
          result.logStreams.length === 1 &&
          result.logStreams[0].uploadSequenceToken) {
          cwOpts.token = result.logStreams[0].uploadSequenceToken;

          return cb();
        }

        return cb(err || `Cannot find Log Stream - logGroupName: ${cwOpts.group}, logStreamName: ${cwOpts.stream}`);
      })
    };

    const onLogsReceived = (logs, callback) => {
      if (!logs || !logs.length) {
        return callback();
      }

      logger.info(`Sending ${logs.length} logs to Cloudwatch...`);

      const events = logs.map(log => ({ timestamp: new Date().getTime(), message: JSON.stringify(log) }) );
      const options = {
        logStreamName: cwOpts.stream,
        logGroupName: cwOpts.group,
        logEvents: events,
        sequenceToken: cwOpts.token
      };

      cWatch.putLogEvents(options,
        (err, result) => {
          if (err && err.code === 'InvalidSequenceTokenException') {
            return updateSequenceToken(stErr => callback(stErr || err))
          }

          if (result && result.nextSequenceToken) {
            cwOpts.token = result.nextSequenceToken;
          }

          callback(err, result);
        });
    };

    const slack = new loggingTools.reporters.SlackReporter({
      hook: config('SLACK_INCOMING_WEBHOOK_URL'),
      username: 'auth0-logs-to-cloudwatch',
      title: 'Logs To Cloudwatch'
    });

    const options = {
      domain: config('AUTH0_DOMAIN'),
      clientId: config('AUTH0_CLIENT_ID'),
      clientSecret: config('AUTH0_CLIENT_SECRET'),
      batchSize: parseInt(config('BATCH_SIZE')),
      startFrom: config('START_FROM'),
      logTypes: config('LOG_TYPES'),
      logLevel: config('LOG_LEVEL')
    };

    if (!options.batchSize || options.batchSize > 100) {
      options.batchSize = 100;
    }

    if (options.logTypes && !Array.isArray(options.logTypes)) {
      options.logTypes = options.logTypes.replace(/\s/g, '').split(',');
    }

    const auth0logger = new loggingTools.LogsProcessor(storage, options);

    const sendDailyReport = (lastReportDate) => {
      const current = new Date();

      const end = current.getTime();
      const start = end - 86400000;
      auth0logger.getReport(start, end)
        .then(report => slack.send(report, report.checkpoint))
        .then(() => storage.read())
        .then((data) => {
          data.lastReportDate = lastReportDate;
          return storage.write(data);
        });
    };

    const checkReportTime = () => {
      storage.read()
        .then((data) => {
          const now = moment().format('DD-MM-YYYY');
          const reportTime = config('DAILY_REPORT_TIME') || 16;

          if (data.lastReportDate !== now && new Date().getHours() >= reportTime) {
            sendDailyReport(now);
          }
        })
    };

    return auth0logger
      .run(onLogsReceived)
      .then(result => {
        if (result && result.status && result.status.error) {
          slack.send(result.status, result.checkpoint);
        } else if (config('SLACK_SEND_SUCCESS') === true || config('SLACK_SEND_SUCCESS') === 'true') {
          slack.send(result.status, result.checkpoint);
        }
        checkReportTime();
        res.json(result);
      })
      .catch(err => {
        slack.send({ error: err, logsProcessed: 0 }, null);
        checkReportTime();
        next(err);
      });
  };
