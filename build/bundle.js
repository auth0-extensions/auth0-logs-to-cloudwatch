module.exports =
/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "/build/";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var _logTypes;

	function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

	var winston = __webpack_require__(1);
	var async = __webpack_require__(2);
	var moment = __webpack_require__(3);
	var useragent = __webpack_require__(4);
	var express = __webpack_require__(5);
	var Webtask = __webpack_require__(6);
	var app = express();
	var Request = __webpack_require__(16);
	var memoizer = __webpack_require__(17);
	var winstCwatch = __webpack_require__(18);
	var metadata = __webpack_require__(33);

	function lastLogCheckpoint(req, res) {
	  var ctx = req.webtaskContext;
	  var required_settings = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'CLOUDWATCH_LOG_GROUP_NAME', 'CLOUDWATCH_LOG_STREAM_NAME', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_KEY', 'AWS_REGION', 'BATCH_SIZE'];
	  var missing_settings = required_settings.filter(function (setting) {
	    return !ctx.data[setting];
	  });

	  if (missing_settings.length) {
	    return res.status(400).send({ message: 'Missing settings: ' + missing_settings.join(', ') });
	  }

	  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
	  req.webtaskContext.storage.get(function (err, data) {
	    var startCheckpointId = typeof data === 'undefined' ? null : data.checkpointId;

	    var logger = new winston.Logger({
	      transports: [new winstCwatch({
	        logGroupName: ctx.data.CLOUDWATCH_LOG_GROUP_NAME,
	        logStreamName: ctx.data.CLOUDWATCH_LOG_STREAM_NAME,
	        awsAccessKeyId: ctx.data.AWS_ACCESS_KEY_ID,
	        awsSecretKey: ctx.data.AWS_SECRET_KEY,
	        awsRegion: ctx.data.AWS_REGION
	      })]
	    });

	    // Start the process.
	    async.waterfall([function (callback) {
	      var getLogs = function getLogs(context) {
	        console.log('Logs from: ' + (context.checkpointId || 'Start') + '.');

	        var take = Number.parseInt(ctx.data.BATCH_SIZE);
	        console.log(take);
	        take = take > 100 ? 100 : take;

	        context.logs = context.logs || [];

	        getLogsFromAuth0(req.webtaskContext.data.AUTH0_DOMAIN, req.access_token, take, context.checkpointId, function (logs, err) {
	          if (err) {
	            console.log('Error getting logs from Auth0', err);
	            return callback(err);
	          }

	          if (logs && logs.length) {
	            logs.forEach(function (l) {
	              return context.logs.push(l);
	            });
	            context.checkpointId = context.logs[context.logs.length - 1]._id;
	          }

	          console.log('Total logs: ' + context.logs.length + '.');
	          return callback(null, context);
	        });
	      };

	      getLogs({ checkpointId: startCheckpointId });
	    }, function (context, callback) {
	      var min_log_level = parseInt(ctx.data.LOG_LEVEL) || 0;
	      var log_matches_level = function log_matches_level(log) {
	        if (logTypes[log.type]) {
	          return logTypes[log.type].level >= min_log_level;
	        }
	        return true;
	      };
	      console.log(ctx.data);
	      var types_filter = ctx.data.LOG_TYPES && ctx.data.LOG_TYPES.split(',') || [];
	      var log_matches_types = function log_matches_types(log) {
	        if (!types_filter || !types_filter.length) return true;
	        return log.type && types_filter.indexOf(log.type) >= 0;
	      };

	      context.logs = context.logs.filter(function (l) {
	        return l.type !== 'sapi' && l.type !== 'fapi';
	      }).filter(log_matches_level).filter(log_matches_types);

	      callback(null, context);
	    }, function (context, callback) {
	      console.log('Uploading blobs...');

	      async.eachLimit(context.logs, 5, function (log, cb) {
	        var date = moment(log.date);
	        var url = date.format('YYYY/MM/DD') + '/' + date.format('HH') + '/' + log._id + '.json';
	        console.log('Uploading ' + url + '.');

	        // papertrail here...
	        logger.info(JSON.stringify(log), cb);
	      }, function (err) {
	        if (err) {
	          return callback(err);
	        }

	        console.log('Upload complete.');
	        return callback(null, context);
	      });
	    }], function (err, context) {
	      if (err) {
	        console.log('Job failed.');

	        return req.webtaskContext.storage.set({ checkpointId: startCheckpointId }, { force: 1 }, function (error) {
	          if (error) {
	            console.log('Error storing startCheckpoint', error);
	            return res.status(500).send({ error: error });
	          }

	          res.status(500).send({
	            error: err
	          });
	        });
	      }

	      console.log('Job complete.');

	      return req.webtaskContext.storage.set({
	        checkpointId: context.checkpointId,
	        totalLogsProcessed: context.logs.length
	      }, { force: 1 }, function (error) {
	        if (error) {
	          console.log('Error storing checkpoint', error);
	          return res.status(500).send({ error: error });
	        }

	        res.sendStatus(200);
	      });
	    });
	  });
	}

	var logTypes = (_logTypes = {
	  's': {
	    event: 'Success Login',
	    level: 1 // Info
	  },
	  'seacft': {
	    event: 'Success Exchange',
	    level: 1 // Info
	  },
	  'seccft': {
	    event: 'Success Exchange (Client Credentials)',
	    level: 1 // Info
	  },
	  'feacft': {
	    event: 'Failed Exchange',
	    level: 3 // Error
	  },
	  'feccft': {
	    event: 'Failed Exchange (Client Credentials)',
	    level: 3 // Error
	  },
	  'f': {
	    event: 'Failed Login',
	    level: 3 // Error
	  },
	  'w': {
	    event: 'Warnings During Login',
	    level: 2 // Warning
	  },
	  'du': {
	    event: 'Deleted User',
	    level: 1 // Info
	  },
	  'fu': {
	    event: 'Failed Login (invalid email/username)',
	    level: 3 // Error
	  },
	  'fp': {
	    event: 'Failed Login (wrong password)',
	    level: 3 // Error
	  },
	  'fc': {
	    event: 'Failed by Connector',
	    level: 3 // Error
	  },
	  'fco': {
	    event: 'Failed by CORS',
	    level: 3 // Error
	  },
	  'con': {
	    event: 'Connector Online',
	    level: 1 // Info
	  },
	  'coff': {
	    event: 'Connector Offline',
	    level: 3 // Error
	  },
	  'fcpro': {
	    event: 'Failed Connector Provisioning',
	    level: 4 // Critical
	  },
	  'ss': {
	    event: 'Success Signup',
	    level: 1 // Info
	  },
	  'fs': {
	    event: 'Failed Signup',
	    level: 3 // Error
	  },
	  'cs': {
	    event: 'Code Sent',
	    level: 0 // Debug
	  },
	  'cls': {
	    event: 'Code/Link Sent',
	    level: 0 // Debug
	  },
	  'sv': {
	    event: 'Success Verification Email',
	    level: 0 // Debug
	  },
	  'fv': {
	    event: 'Failed Verification Email',
	    level: 0 // Debug
	  },
	  'scp': {
	    event: 'Success Change Password',
	    level: 1 // Info
	  },
	  'fcp': {
	    event: 'Failed Change Password',
	    level: 3 // Error
	  },
	  'sce': {
	    event: 'Success Change Email',
	    level: 1 // Info
	  },
	  'fce': {
	    event: 'Failed Change Email',
	    level: 3 // Error
	  },
	  'scu': {
	    event: 'Success Change Username',
	    level: 1 // Info
	  },
	  'fcu': {
	    event: 'Failed Change Username',
	    level: 3 // Error
	  },
	  'scpn': {
	    event: 'Success Change Phone Number',
	    level: 1 // Info
	  },
	  'fcpn': {
	    event: 'Failed Change Phone Number',
	    level: 3 // Error
	  },
	  'svr': {
	    event: 'Success Verification Email Request',
	    level: 0 // Debug
	  },
	  'fvr': {
	    event: 'Failed Verification Email Request',
	    level: 3 // Error
	  },
	  'scpr': {
	    event: 'Success Change Password Request',
	    level: 0 // Debug
	  },
	  'fcpr': {
	    event: 'Failed Change Password Request',
	    level: 3 // Error
	  },
	  'fn': {
	    event: 'Failed Sending Notification',
	    level: 3 // Error
	  },
	  'sapi': {
	    event: 'API Operation'
	  },
	  'fapi': {
	    event: 'Failed API Operation'
	  },
	  'limit_wc': {
	    event: 'Blocked Account',
	    level: 4 // Critical
	  },
	  'limit_ui': {
	    event: 'Too Many Calls to /userinfo',
	    level: 4 // Critical
	  },
	  'api_limit': {
	    event: 'Rate Limit On API',
	    level: 4 // Critical
	  },
	  'sdu': {
	    event: 'Successful User Deletion',
	    level: 1 // Info
	  },
	  'fdu': {
	    event: 'Failed User Deletion',
	    level: 3 // Error
	  }
	}, _defineProperty(_logTypes, 'fapi', {
	  event: 'Failed API Operation',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_wc', {
	  event: 'Blocked Account',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_mu', {
	  event: 'Blocked IP Address',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'slo', {
	  event: 'Success Logout',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'flo', {
	  event: ' Failed Logout',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'sd', {
	  event: 'Success Delegation',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'fd', {
	  event: 'Failed Delegation',
	  level: 3 // Error
	}), _logTypes);

	function getLogsFromAuth0(domain, token, take, from, cb) {
	  var url = 'https://' + domain + '/api/v2/logs';

	  Request({
	    method: 'GET',
	    url: url,
	    json: true,
	    qs: {
	      take: take,
	      from: from,
	      sort: 'date:1',
	      per_page: take
	    },
	    headers: {
	      Authorization: 'Bearer ' + token,
	      Accept: 'application/json'
	    }
	  }, function (err, res, body) {
	    if (err) {
	      console.log('Error getting logs', err);
	      cb(null, err);
	    } else {
	      console.log(body);
	      cb(body);
	    }
	  });
	}

	var getTokenCached = memoizer({
	  load: function load(apiUrl, audience, clientId, clientSecret, cb) {
	    Request({
	      method: 'POST',
	      url: apiUrl,
	      json: true,
	      body: {
	        audience: audience,
	        grant_type: 'client_credentials',
	        client_id: clientId,
	        client_secret: clientSecret
	      }
	    }, function (err, res, body) {
	      if (err) {
	        cb(null, err);
	      } else {
	        cb(body.access_token);
	      }
	    });
	  },
	  hash: function hash(apiUrl) {
	    return apiUrl;
	  },
	  max: 100,
	  maxAge: 1000 * 60 * 60
	});

	app.use(function (req, res, next) {
	  var apiUrl = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/oauth/token';
	  var audience = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/api/v2/';
	  var clientId = req.webtaskContext.data.AUTH0_CLIENT_ID;
	  var clientSecret = req.webtaskContext.data.AUTH0_CLIENT_SECRET;

	  getTokenCached(apiUrl, audience, clientId, clientSecret, function (access_token, err) {
	    if (err) {
	      console.log('Error getting access_token', err);
	      return next(err);
	    }

	    req.access_token = access_token;
	    next();
	  });
	});

	app.get('/', lastLogCheckpoint);
	app.post('/', lastLogCheckpoint);

	app.get('/meta', function (req, res) {
	  res.status(200).send(metadata);
	});

	module.exports = Webtask.fromExpress(app);

/***/ },
/* 1 */
/***/ function(module, exports) {

	module.exports = require("winston");

/***/ },
/* 2 */
/***/ function(module, exports) {

	module.exports = require("async");

/***/ },
/* 3 */
/***/ function(module, exports) {

	module.exports = require("moment");

/***/ },
/* 4 */
/***/ function(module, exports) {

	module.exports = require("useragent");

/***/ },
/* 5 */
/***/ function(module, exports) {

	module.exports = require("express");

/***/ },
/* 6 */
/***/ function(module, exports, __webpack_require__) {

	exports.auth0 = __webpack_require__(7);
	exports.fromConnect = exports.fromExpress = fromConnect;
	exports.fromHapi = fromHapi;
	exports.fromServer = exports.fromRestify = fromServer;

	// API functions

	function addAuth0(func) {
	    func.auth0 = function (options) {
	        return exports.auth0(func, options);
	    }

	    return func;
	}

	function fromConnect (connectFn) {
	    return addAuth0(function (context, req, res) {
	        var normalizeRouteRx = createRouteNormalizationRx(req.x_wt.jtn);

	        req.originalUrl = req.url;
	        req.url = req.url.replace(normalizeRouteRx, '/');
	        req.webtaskContext = attachStorageHelpers(context);

	        return connectFn(req, res);
	    });
	}

	function fromHapi(server) {
	    var webtaskContext;

	    server.ext('onRequest', function (request, response) {
	        var normalizeRouteRx = createRouteNormalizationRx(request.x_wt.jtn);

	        request.setUrl(request.url.replace(normalizeRouteRx, '/'));
	        request.webtaskContext = webtaskContext;
	    });

	    return addAuth0(function (context, req, res) {
	        var dispatchFn = server._dispatch();

	        webtaskContext = attachStorageHelpers(context);

	        dispatchFn(req, res);
	    });
	}

	function fromServer(httpServer) {
	    return addAuth0(function (context, req, res) {
	        var normalizeRouteRx = createRouteNormalizationRx(req.x_wt.jtn);

	        req.originalUrl = req.url;
	        req.url = req.url.replace(normalizeRouteRx, '/');
	        req.webtaskContext = attachStorageHelpers(context);

	        return httpServer.emit('request', req, res);
	    });
	}


	// Helper functions

	function createRouteNormalizationRx(jtn) {
	    var normalizeRouteBase = '^\/api\/run\/[^\/]+\/';
	    var normalizeNamedRoute = '(?:[^\/\?#]*\/?)?';

	    return new RegExp(
	        normalizeRouteBase + (
	        jtn
	            ?   normalizeNamedRoute
	            :   ''
	    ));
	}

	function attachStorageHelpers(context) {
	    context.read = context.secrets.EXT_STORAGE_URL
	        ?   readFromPath
	        :   readNotAvailable;
	    context.write = context.secrets.EXT_STORAGE_URL
	        ?   writeToPath
	        :   writeNotAvailable;

	    return context;


	    function readNotAvailable(path, options, cb) {
	        var Boom = __webpack_require__(15);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        cb(Boom.preconditionFailed('Storage is not available in this context'));
	    }

	    function readFromPath(path, options, cb) {
	        var Boom = __webpack_require__(15);
	        var Request = __webpack_require__(16);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        Request({
	            uri: context.secrets.EXT_STORAGE_URL,
	            method: 'GET',
	            headers: options.headers || {},
	            qs: { path: path },
	            json: true,
	        }, function (err, res, body) {
	            if (err) return cb(Boom.wrap(err, 502));
	            if (res.statusCode === 404 && Object.hasOwnProperty.call(options, 'defaultValue')) return cb(null, options.defaultValue);
	            if (res.statusCode >= 400) return cb(Boom.create(res.statusCode, body && body.message));

	            cb(null, body);
	        });
	    }

	    function writeNotAvailable(path, data, options, cb) {
	        var Boom = __webpack_require__(15);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        cb(Boom.preconditionFailed('Storage is not available in this context'));
	    }

	    function writeToPath(path, data, options, cb) {
	        var Boom = __webpack_require__(15);
	        var Request = __webpack_require__(16);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        Request({
	            uri: context.secrets.EXT_STORAGE_URL,
	            method: 'PUT',
	            headers: options.headers || {},
	            qs: { path: path },
	            body: data,
	        }, function (err, res, body) {
	            if (err) return cb(Boom.wrap(err, 502));
	            if (res.statusCode >= 400) return cb(Boom.create(res.statusCode, body && body.message));

	            cb(null);
	        });
	    }
	}


/***/ },
/* 7 */
/***/ function(module, exports, __webpack_require__) {

	var url = __webpack_require__(8);
	var error = __webpack_require__(9);
	var handleAppEndpoint = __webpack_require__(10);
	var handleLogin = __webpack_require__(12);
	var handleCallback = __webpack_require__(13);

	module.exports = function (webtask, options) {
	    if (typeof webtask !== 'function' || webtask.length !== 3) {
	        throw new Error('The auth0() function can only be called on webtask functions with the (ctx, req, res) signature.');
	    }
	    if (!options) {
	        options = {};
	    }
	    if (typeof options !== 'object') {
	        throw new Error('The options parameter must be an object.');
	    }
	    if (options.scope && typeof options.scope !== 'string') {
	        throw new Error('The scope option, if specified, must be a string.');
	    }
	    if (options.authorized && ['string','function'].indexOf(typeof options.authorized) < 0 && !Array.isArray(options.authorized)) {
	        throw new Error('The authorized option, if specified, must be a string or array of strings with e-mail or domain names, or a function that accepts (ctx, req) and returns boolean.');
	    }
	    if (options.exclude && ['string','function'].indexOf(typeof options.exclude) < 0 && !Array.isArray(options.exclude)) {
	        throw new Error('The exclude option, if specified, must be a string or array of strings with URL paths that do not require authentication, or a function that accepts (ctx, req, appPath) and returns boolean.');
	    }
	    if (options.clientId && typeof options.clientId !== 'function') {
	        throw new Error('The clientId option, if specified, must be a function that accepts (ctx, req) and returns an Auth0 Client ID.');
	    }
	    if (options.clientSecret && typeof options.clientSecret !== 'function') {
	        throw new Error('The clientSecret option, if specified, must be a function that accepts (ctx, req) and returns an Auth0 Client Secret.');
	    }
	    if (options.domain && typeof options.domain !== 'function') {
	        throw new Error('The domain option, if specified, must be a function that accepts (ctx, req) and returns an Auth0 Domain.');
	    }
	    if (options.webtaskSecret && typeof options.webtaskSecret !== 'function') {
	        throw new Error('The webtaskSecret option, if specified, must be a function that accepts (ctx, req) and returns a key to be used to sign issued JWT tokens.');
	    }
	    if (options.getApiKey && typeof options.getApiKey !== 'function') {
	        throw new Error('The getApiKey option, if specified, must be a function that accepts (ctx, req) and returns an apiKey associated with the request.');
	    }
	    if (options.loginSuccess && typeof options.loginSuccess !== 'function') {
	        throw new Error('The loginSuccess option, if specified, must be a function that accepts (ctx, req, res, baseUrl) and generates a response.');
	    }
	    if (options.loginError && typeof options.loginError !== 'function') {
	        throw new Error('The loginError option, if specified, must be a function that accepts (error, ctx, req, res, baseUrl) and generates a response.');
	    }

	    options.clientId = options.clientId || function (ctx, req) {
	        return ctx.secrets.AUTH0_CLIENT_ID;
	    };
	    options.clientSecret = options.clientSecret || function (ctx, req) {
	        return ctx.secrets.AUTH0_CLIENT_SECRET;
	    };
	    options.domain = options.domain || function (ctx, req) {
	        return ctx.secrets.AUTH0_DOMAIN;
	    };
	    options.webtaskSecret = options.webtaskSecret || function (ctx, req) {
	        // By default we don't expect developers to specify WEBTASK_SECRET when
	        // creating authenticated webtasks. In this case we will use webtask token
	        // itself as a JWT signing key. The webtask token of a named webtask is secret
	        // and it contains enough entropy (jti, iat, ca) to pass
	        // for a symmetric key. Using webtask token ensures that the JWT signing secret 
	        // remains constant for the lifetime of the webtask; however regenerating 
	        // the webtask will invalidate previously issued JWTs. 
	        return ctx.secrets.WEBTASK_SECRET || req.x_wt.token;
	    };
	    options.getApiKey = options.getApiKey || function (ctx, req) {
	        if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
	            return req.headers.authorization.split(' ')[1];
	        } else if (req.query && req.query.apiKey) {
	            return req.query.apiKey;
	        }
	        return null;
	    };
	    options.loginSuccess = options.loginSuccess || function (ctx, req, res, baseUrl) {
	        res.writeHead(302, { Location: baseUrl + '?apiKey=' + ctx.apiKey });
	        return res.end();
	    };
	    options.loginError = options.loginError || function (error, ctx, req, res, baseUrl) {
	        if (req.method === 'GET') {
	            if (error.redirect) {
	                res.writeHead(302, { Location: error.redirect });
	                return res.end(JSON.stringify(error));
	            }
	            res.writeHead(error.code || 401, { 
	                'Content-Type': 'text/html', 
	                'Cache-Control': 'no-cache' 
	            });
	            return res.end(getNotAuthorizedHtml(baseUrl + '/login'));
	        }
	        else {
	            // Reject all other requests
	            return error(error, res);
	        }            
	    };
	    if (typeof options.authorized === 'string') {
	        options.authorized = [ options.authorized ];
	    }
	    if (Array.isArray(options.authorized)) {
	        var authorized = [];
	        options.authorized.forEach(function (a) {
	            authorized.push(a.toLowerCase());
	        });
	        options.authorized = function (ctx, res) {
	            if (ctx.user.email_verified) {
	                for (var i = 0; i < authorized.length; i++) {
	                    var email = ctx.user.email.toLowerCase();
	                    if (email === authorized[i] || authorized[i][0] === '@' && email.indexOf(authorized[i]) > 1) {
	                        return true;
	                    }
	                }
	            }
	            return false;
	        }
	    }
	    if (typeof options.exclude === 'string') {
	        options.exclude = [ options.exclude ];
	    }
	    if (Array.isArray(options.exclude)) {
	        var exclude = options.exclude;
	        options.exclude = function (ctx, res, appPath) {
	            return exclude.indexOf(appPath) > -1;
	        }
	    }

	    return createAuthenticatedWebtask(webtask, options);
	};

	function createAuthenticatedWebtask(webtask, options) {

	    // Inject middleware into the HTTP pipeline before the webtask handler
	    // to implement authentication endpoints and perform authentication 
	    // and authorization.

	    return function (ctx, req, res) {
	        if (!req.x_wt.jtn || !req.x_wt.container) {
	            return error({
	                code: 400,
	                message: 'Auth0 authentication can only be used with named webtasks.'
	            }, res);
	        }

	        var routingInfo = getRoutingInfo(req);
	        if (!routingInfo) {
	            return error({
	                code: 400,
	                message: 'Error processing request URL path.'
	            }, res);
	        }
	        switch (req.method === 'GET' && routingInfo.appPath) {
	            case '/login': handleLogin(options, ctx, req, res, routingInfo); break;
	            case '/callback': handleCallback(options, ctx, req, res, routingInfo); break;
	            default: handleAppEndpoint(webtask, options, ctx, req, res, routingInfo); break;
	        };
	        return;
	    };
	}

	function getRoutingInfo(req) {
	    var routingInfo = url.parse(req.url, true);
	    var segments = routingInfo.pathname.split('/');
	    if (segments[1] === 'api' && segments[2] === 'run' && segments[3] === req.x_wt.container && segments[4] === req.x_wt.jtn) {
	        // Shared domain case: /api/run/{container}/{jtn}
	        routingInfo.basePath = segments.splice(0, 5).join('/');
	    }
	    else if (segments[1] === req.x_wt.container && segments[2] === req.x_wt.jtn) {
	        // Custom domain case: /{container}/{jtn}
	        routingInfo.basePath = segments.splice(0, 3).join('/');
	    }
	    else {
	        return null;
	    }
	    routingInfo.appPath = '/' + segments.join('/');
	    routingInfo.baseUrl = [
	        req.headers['x-forwarded-proto'] || 'https',
	        '://',
	        req.headers.host,
	        routingInfo.basePath
	    ].join('');
	    return routingInfo;
	}

	var notAuthorizedTemplate = function () {/*
	<!DOCTYPE html5>
	<html>
	  <head>
	    <meta charset="utf-8"/>
	    <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
	    <meta name="viewport" content="width=device-width, initial-scale=1"/>
	    <link href="https://cdn.auth0.com/styleguide/latest/index.css" rel="stylesheet" />
	    <title>Access denied</title>
	  </head>
	  <body>
	    <div class="container">
	      <div class="row text-center">
	        <h1><a href="https://auth0.com" title="Go to Auth0!"><img src="https://cdn.auth0.com/styleguide/1.0.0/img/badge.svg" alt="Auth0 badge" /></a></h1>
	        <h1>Not authorized</h1>
	        <p><a href="##">Try again</a></p>
	      </div>
	    </div>
	  </body>
	</html>
	*/}.toString().match(/[^]*\/\*([^]*)\*\/\s*\}$/)[1];

	function getNotAuthorizedHtml(loginUrl) {
	    return notAuthorizedTemplate.replace('##', loginUrl);
	}


/***/ },
/* 8 */
/***/ function(module, exports) {

	module.exports = require("url");

/***/ },
/* 9 */
/***/ function(module, exports) {

	module.exports = function (err, res) {
	    res.writeHead(err.code || 500, { 
	        'Content-Type': 'application/json',
	        'Cache-Control': 'no-cache'
	    });
	    res.end(JSON.stringify(err));
	};


/***/ },
/* 10 */
/***/ function(module, exports, __webpack_require__) {

	var error = __webpack_require__(9);

	module.exports = function (webtask, options, ctx, req, res, routingInfo) {
	    return options.exclude && options.exclude(ctx, req, routingInfo.appPath)
	        ? run()
	        : authenticate();

	    function authenticate() {
	        var apiKey = options.getApiKey(ctx, req);
	        if (!apiKey) {
	            return options.loginError({
	                code: 401,
	                message: 'Unauthorized.',
	                error: 'Missing apiKey.',
	                redirect: routingInfo.baseUrl + '/login'
	            }, ctx, req, res, routingInfo.baseUrl);
	        }

	        // Authenticate

	        var secret = options.webtaskSecret(ctx, req);
	        if (!secret) {
	            return error({
	                code: 400,
	                message: 'The webtask secret must be provided to allow for validating apiKeys.'
	            }, res);
	        }

	        try {
	            ctx.user = req.user = __webpack_require__(11).verify(apiKey, secret);
	        }
	        catch (e) {
	            return options.loginError({
	                code: 401,
	                message: 'Unauthorized.',
	                error: e.message
	            }, ctx, req, res, routingInfo.baseUrl);       
	        }

	        ctx.apiKey = apiKey;

	        // Authorize

	        if  (options.authorized && !options.authorized(ctx, req)) {
	            return options.loginError({
	                code: 403,
	                message: 'Forbidden.'
	            }, ctx, req, res, routingInfo.baseUrl);        
	        }

	        return run();
	    }

	    function run() {
	        // Route request to webtask code
	        return webtask(ctx, req, res);
	    }
	};


/***/ },
/* 11 */
/***/ function(module, exports) {

	module.exports = require("jsonwebtoken");

/***/ },
/* 12 */
/***/ function(module, exports, __webpack_require__) {

	var error = __webpack_require__(9);

	module.exports = function(options, ctx, req, res, routingInfo) {
	    var authParams = {
	        clientId: options.clientId(ctx, req),
	        domain: options.domain(ctx, req)
	    };
	    var count = !!authParams.clientId + !!authParams.domain;
	    var scope = 'openid name email email_verified ' + (options.scope || '');
	    if (count ===  0) {
	        // TODO, tjanczuk, support the shared Auth0 application case
	        return error({
	            code: 501,
	            message: 'Not implemented.'
	        }, res);
	        // Neither client id or domain are specified; use shared Auth0 settings
	        // var authUrl = 'https://auth0.auth0.com/i/oauth2/authorize'
	        //     + '?response_type=code'
	        //     + '&audience=https://auth0.auth0.com/userinfo'
	        //     + '&scope=' + encodeURIComponent(scope)
	        //     + '&client_id=' + encodeURIComponent(routingInfo.baseUrl)
	        //     + '&redirect_uri=' + encodeURIComponent(routingInfo.baseUrl + '/callback');
	        // res.writeHead(302, { Location: authUrl });
	        // return res.end();
	    }
	    else if (count === 2) {
	        // Use custom Auth0 account
	        var authUrl = 'https://' + authParams.domain + '/authorize' 
	            + '?response_type=code'
	            + '&scope=' + encodeURIComponent(scope)
	            + '&client_id=' + encodeURIComponent(authParams.clientId)
	            + '&redirect_uri=' + encodeURIComponent(routingInfo.baseUrl + '/callback');
	        res.writeHead(302, { Location: authUrl });
	        return res.end();
	    }
	    else {
	        return error({
	            code: 400,
	            message: 'Both or neither Auth0 Client ID and Auth0 domain must be specified.'
	        }, res);
	    }
	};


/***/ },
/* 13 */
/***/ function(module, exports, __webpack_require__) {

	var error = __webpack_require__(9);

	module.exports = function (options, ctx, req, res, routingInfo) {
	    if (!ctx.query.code) {
	        return options.loginError({
	            code: 401,
	            message: 'Authentication error.',
	            callbackQuery: ctx.query
	        }, ctx, req, res, routingInfo.baseUrl);
	    }

	    var authParams = {
	        clientId: options.clientId(ctx, req),
	        domain: options.domain(ctx, req),
	        clientSecret: options.clientSecret(ctx, req)
	    };
	    var count = !!authParams.clientId + !!authParams.domain + !!authParams.clientSecret;
	    if (count !== 3) {
	        return error({
	            code: 400,
	            message: 'Auth0 Client ID, Client Secret, and Auth0 Domain must be specified.'
	        }, res);
	    }

	    return __webpack_require__(14)
	        .post('https://' + authParams.domain + '/oauth/token')
	        .type('form')
	        .send({
	            client_id: authParams.clientId,
	            client_secret: authParams.clientSecret,
	            redirect_uri: routingInfo.baseUrl + '/callback',
	            code: ctx.query.code,
	            grant_type: 'authorization_code'
	        })
	        .timeout(15000)
	        .end(function (err, ares) {
	            if (err || !ares.ok) {
	                return options.loginError({
	                    code: 502,
	                    message: 'OAuth code exchange completed with error.',
	                    error: err && err.message,
	                    auth0Status: ares && ares.status,
	                    auth0Response: ares && (ares.body || ares.text)
	                }, ctx, req, res, routingInfo.baseUrl);
	            }

	            return issueApiKey(ares.body.id_token);
	        });

	    function issueApiKey(id_token) {
	        var jwt = __webpack_require__(11);
	        var claims;
	        try {
	            claims = jwt.decode(id_token);
	        }
	        catch (e) {
	            return options.loginError({
	                code: 502,
	                message: 'Cannot parse id_token returned from Auth0.',
	                id_token: id_token,
	                error: e.message
	            }, ctx, req, res, routingInfo.baseUrl);
	        }

	        // Issue apiKey by re-signing the id_token claims 
	        // with configured secret (webtask token by default).

	        var secret = options.webtaskSecret(ctx, req);
	        if (!secret) {
	            return error({
	                code: 400,
	                message: 'The webtask secret must be be provided to allow for issuing apiKeys.'
	            }, res);
	        }

	        claims.iss = routingInfo.baseUrl;
	        req.user = ctx.user = claims;
	        ctx.apiKey = jwt.sign(claims, secret);

	        // Perform post-login action (redirect to /?apiKey=... by default)
	        return options.loginSuccess(ctx, req, res, routingInfo.baseUrl);
	    }
	};


/***/ },
/* 14 */
/***/ function(module, exports) {

	module.exports = require("superagent");

/***/ },
/* 15 */
/***/ function(module, exports) {

	module.exports = require("boom");

/***/ },
/* 16 */
/***/ function(module, exports) {

	module.exports = require("request");

/***/ },
/* 17 */
/***/ function(module, exports) {

	module.exports = require("lru-memoizer");

/***/ },
/* 18 */
/***/ function(module, exports, __webpack_require__) {

	var AWS = __webpack_require__(19);
	var _ = __webpack_require__(20);
	var util = __webpack_require__(21);
	var winston = __webpack_require__(1);
	var CircularJSON = __webpack_require__(22);
	var backoff = __webpack_require__(23);

	var LIMITS = {
	    EVENT_SIZE: 256000,
	    BATCH_SIZE: 1000000
	};

	/**
	 * @param {Object} options
	 * @param {string} [options.name]
	 * @param {string} [options.level]
	 * @param {string} [options.awsAccessKeyId]
	 * @param {string} [options.awsSecretKey]
	 * @param {string} [options.awsRegion]
	 * @param {string} options.logGroupName
	 * @param {string} options.logStreamName
	 * @param {boolean} [options.jsonMessage]
	 */
	var Transport = function (options) {
	    var self = this;

	    this.name = _.capitalize(options.name || "cloudwatch_" + options.logGroupName + "_" + options.logStreamName);
	    this.level = options.level || 'debug';
	    this.logGroupName = options.logGroupName;
	    this.logStreamName = options.logStreamName;
	    this.jsonMessage = options.jsonMessage;
	    this.cloudWatchLogs = null;

	    if (options.awsAccessKeyId && options.awsSecretKey && options.awsRegion) {
	        this.cloudWatchLogs = new AWS.CloudWatchLogs({
	            accessKeyId: options.awsAccessKeyId,
	            secretAccessKey: options.awsSecretKey,
	            region: options.awsRegion
	        });
	    } else if (options.awsRegion && !options.awsAccessKeyId && !options.awsSecretKey) {
	        // Amazon SDK will automatically pull access credentials from IAM Role when running on EC2 but region still needs to be configured
	        this.cloudWatchLogs = new AWS.CloudWatchLogs({region: options.awsRegion});
	    } else {
	        this.cloudWatchLogs = new AWS.CloudWatchLogs();
	    }

	    /* store payloads */
	    var payloadQueue = [];


	    this.add = function (message) {
	        var messageSize = CircularJSON.stringify(message).length;

	        if (messageSize > LIMITS.EVENT_SIZE) {
	            //For now return, in the future we need to try to split the object
	            console.warn('Rejecting message, message is to over the EVENT_SIZE Limit');
	            return;
	        }

	        var payload = {messages: [], size: 0, locked: false};

	        /*  If the queue is empty, or
	         *  if the new message would put the batch over max size limit or
	         *  if the batch is locked, insert a new batch
	         *  Otherwise, use the last batch */
	        if (payloadQueue.length == 0 ||
	            (payloadQueue[payloadQueue.length - 1].size + messageSize > LIMITS.BATCH_SIZE) ||
	            payloadQueue[payloadQueue.length - 1].locked)
	            payloadQueue.push(payload);
	        else
	            payload = payloadQueue[payloadQueue.length - 1];

	        payload.size = payload.size + messageSize;
	        payload.messages.push(message)

	        if(payloadQueue.length > 254){
	            payloadQueue.shift();

	            payloadQueue = _.takeRight(payloadQueue, 128);
	            console.warn('Payload queue too large, cutting in half!');
	        }
	    };


	    var findLogStream = function (callback) {
	        function next(nextToken) {
	            var params = {
	                logStreamNamePrefix: self.logStreamName,
	                logGroupName: self.logGroupName
	            };

	            if (nextToken)
	                params.nextToken = nextToken;

	            self.cloudWatchLogs.describeLogStreams(params, function (err, data) {
	                if (err)
	                    return callback(err);
	                var matches = _.find(data.logStreams, function (logStream) {
	                    return (logStream.logStreamName === self.logStreamName);
	                });

	                if (matches) {
	                    return callback(null, matches);
	                } else if (!data.nextToken) {
	                    console.warn("Log group and / or log stream do not exist.  Createing stream [Log group: " + self.logGroupName +
	                        "; Log Stream : " + self.logStreamName + "]");

	                    //Create the log group and / or log stream
	                    self.cloudWatchLogs.createLogGroup({logGroupName: self.logGroupName}, function(err, data) {
	                        if (err && err.code != "ResourceAlreadyExistsException") console.warn(err, err.stack);
	                        else {
	                            self.cloudWatchLogs.createLogStream({logGroupName: self.logGroupName,
	                                logStreamName:self.logStreamName}, function(err, data) {
	                                if (err) console.warn(err, err.stack);
	                            })
	                        }
	                    });
	                    return callback(new Error('LogGroup and/or LogStream does not exist.'));
	                } else {
	                    next(data.nextToken);
	                }
	            })
	        }

	        next();
	    };

	    var getToken = function getToken(callback) {
	        findLogStream(function (err, logStream) {
	            if (err) {
	                return callback(err);
	            } else {
	                return callback(null, logStream.uploadSequenceToken);
	            }
	        });
	    };


	    var upload = function (payload, callback) {
	        getToken(function (err, sequenceToken) {
	            if (err) {
	                callback(err);
	            } else {
	                var batch = {
	                    logGroupName: self.logGroupName,
	                    logStreamName: self.logStreamName,
	                    logEvents: payload.messages
	                };
	                if (sequenceToken) batch.sequenceToken = sequenceToken;

	                self.cloudWatchLogs.putLogEvents(batch, function (err, data) {
	                    return callback(err);
	                });
	            }
	        })
	    };


	    var fb = backoff.fibonacci({
	        randomisationFactor: 0.8675309,
	        initialDelay: 100,
	        maxDelay: 10000
	    });



	    fb.on('ready', function (number, delay) {

	        if (payloadQueue.length > 0) {

	            if (!payloadQueue[0].locked)
	                payloadQueue[0].locked = true;


	            upload(payloadQueue[0],
	                function (err) {
	                    if (err && err.code) {
	                        if (err.code != "ThrottlingException" &&
	                            err.code != "InvalidSequenceTokenException" &&
	                            err.code != "ResourceNotFoundException" &&
	                            err.code != "OperationAbortedException") {
	                            //Only dump the error if it's an exception we're not expecting.
	                            console.log(err.stack || err);
	                        }

	                        if(err.code == "ResourceNotFoundException" && number == 0){
	                            console.error('LogGroup and/or LogStream does not exist.');
	                        }
	                        fb.backoff();
	                    } else {
	                        payloadQueue.shift();

	                        fb.reset();
	                        fb.backoff();
	                    }
	                });

	        } else {
	            fb.reset();
	            fb.backoff();
	        }
	    });

	    fb.backoff();

	};

	util.inherits(Transport, winston.Transport);

	Transport.prototype.log = function (level, msg, meta, callback) {
	    var log = {level: level, msg: msg, meta: meta};
	    this.add({message: CircularJSON.stringify(log, null, '  '), timestamp: Date.now()});

	    // do not wait, just return right away
	    callback(null, true);
	};

	module.exports = Transport;


/***/ },
/* 19 */
/***/ function(module, exports) {

	module.exports = require("aws-sdk");

/***/ },
/* 20 */
/***/ function(module, exports) {

	module.exports = require("lodash");

/***/ },
/* 21 */
/***/ function(module, exports) {

	module.exports = require("util");

/***/ },
/* 22 */
/***/ function(module, exports) {

	/*!
	Copyright (C) 2013 by WebReflection

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in
	all copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
	THE SOFTWARE.

	*/
	var
	  // should be a not so common char
	  // possibly one JSON does not encode
	  // possibly one encodeURIComponent does not encode
	  // right now this char is '~' but this might change in the future
	  specialChar = '~',
	  safeSpecialChar = '\\x' + (
	    '0' + specialChar.charCodeAt(0).toString(16)
	  ).slice(-2),
	  escapedSafeSpecialChar = '\\' + safeSpecialChar,
	  specialCharRG = new RegExp(safeSpecialChar, 'g'),
	  safeSpecialCharRG = new RegExp(escapedSafeSpecialChar, 'g'),

	  safeStartWithSpecialCharRG = new RegExp('(?:^|([^\\\\]))' + escapedSafeSpecialChar),

	  indexOf = [].indexOf || function(v){
	    for(var i=this.length;i--&&this[i]!==v;);
	    return i;
	  },
	  $String = String  // there's no way to drop warnings in JSHint
	                    // about new String ... well, I need that here!
	                    // faked, and happy linter!
	;

	function generateReplacer(value, replacer, resolve) {
	  var
	    path = [],
	    all  = [value],
	    seen = [value],
	    mapp = [resolve ? specialChar : '[Circular]'],
	    last = value,
	    lvl  = 1,
	    i
	  ;
	  return function(key, value) {
	    // the replacer has rights to decide
	    // if a new object should be returned
	    // or if there's some key to drop
	    // let's call it here rather than "too late"
	    if (replacer) value = replacer.call(this, key, value);

	    // did you know ? Safari passes keys as integers for arrays
	    // which means if (key) when key === 0 won't pass the check
	    if (key !== '') {
	      if (last !== this) {
	        i = lvl - indexOf.call(all, this) - 1;
	        lvl -= i;
	        all.splice(lvl, all.length);
	        path.splice(lvl - 1, path.length);
	        last = this;
	      }
	      // console.log(lvl, key, path);
	      if (typeof value === 'object' && value) {
	    	// if object isn't referring to parent object, add to the
	        // object path stack. Otherwise it is already there.
	        if (indexOf.call(all, value) < 0) {
	          all.push(last = value);
	        }
	        lvl = all.length;
	        i = indexOf.call(seen, value);
	        if (i < 0) {
	          i = seen.push(value) - 1;
	          if (resolve) {
	            // key cannot contain specialChar but could be not a string
	            path.push(('' + key).replace(specialCharRG, safeSpecialChar));
	            mapp[i] = specialChar + path.join(specialChar);
	          } else {
	            mapp[i] = mapp[0];
	          }
	        } else {
	          value = mapp[i];
	        }
	      } else {
	        if (typeof value === 'string' && resolve) {
	          // ensure no special char involved on deserialization
	          // in this case only first char is important
	          // no need to replace all value (better performance)
	          value = value .replace(safeSpecialChar, escapedSafeSpecialChar)
	                        .replace(specialChar, safeSpecialChar);
	        }
	      }
	    }
	    return value;
	  };
	}

	function retrieveFromPath(current, keys) {
	  for(var i = 0, length = keys.length; i < length; current = current[
	    // keys should be normalized back here
	    keys[i++].replace(safeSpecialCharRG, specialChar)
	  ]);
	  return current;
	}

	function generateReviver(reviver) {
	  return function(key, value) {
	    var isString = typeof value === 'string';
	    if (isString && value.charAt(0) === specialChar) {
	      return new $String(value.slice(1));
	    }
	    if (key === '') value = regenerate(value, value, {});
	    // again, only one needed, do not use the RegExp for this replacement
	    // only keys need the RegExp
	    if (isString) value = value .replace(safeStartWithSpecialCharRG, '$1' + specialChar)
	                                .replace(escapedSafeSpecialChar, safeSpecialChar);
	    return reviver ? reviver.call(this, key, value) : value;
	  };
	}

	function regenerateArray(root, current, retrieve) {
	  for (var i = 0, length = current.length; i < length; i++) {
	    current[i] = regenerate(root, current[i], retrieve);
	  }
	  return current;
	}

	function regenerateObject(root, current, retrieve) {
	  for (var key in current) {
	    if (current.hasOwnProperty(key)) {
	      current[key] = regenerate(root, current[key], retrieve);
	    }
	  }
	  return current;
	}

	function regenerate(root, current, retrieve) {
	  return current instanceof Array ?
	    // fast Array reconstruction
	    regenerateArray(root, current, retrieve) :
	    (
	      current instanceof $String ?
	        (
	          // root is an empty string
	          current.length ?
	            (
	              retrieve.hasOwnProperty(current) ?
	                retrieve[current] :
	                retrieve[current] = retrieveFromPath(
	                  root, current.split(specialChar)
	                )
	            ) :
	            root
	        ) :
	        (
	          current instanceof Object ?
	            // dedicated Object parser
	            regenerateObject(root, current, retrieve) :
	            // value as it is
	            current
	        )
	    )
	  ;
	}

	function stringifyRecursion(value, replacer, space, doNotResolve) {
	  return JSON.stringify(value, generateReplacer(value, replacer, !doNotResolve), space);
	}

	function parseRecursion(text, reviver) {
	  return JSON.parse(text, generateReviver(reviver));
	}
	this.stringify = stringifyRecursion;
	this.parse = parseRecursion;

/***/ },
/* 23 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var Backoff = __webpack_require__(24);
	var ExponentialBackoffStrategy = __webpack_require__(29);
	var FibonacciBackoffStrategy = __webpack_require__(31);
	var FunctionCall = __webpack_require__(32);

	module.exports.Backoff = Backoff;
	module.exports.FunctionCall = FunctionCall;
	module.exports.FibonacciStrategy = FibonacciBackoffStrategy;
	module.exports.ExponentialStrategy = ExponentialBackoffStrategy;

	// Constructs a Fibonacci backoff.
	module.exports.fibonacci = function(options) {
	    return new Backoff(new FibonacciBackoffStrategy(options));
	};

	// Constructs an exponential backoff.
	module.exports.exponential = function(options) {
	    return new Backoff(new ExponentialBackoffStrategy(options));
	};

	// Constructs a FunctionCall for the given function and arguments.
	module.exports.call = function(fn, vargs, callback) {
	    var args = Array.prototype.slice.call(arguments);
	    fn = args[0];
	    vargs = args.slice(1, args.length - 1);
	    callback = args[args.length - 1];
	    return new FunctionCall(fn, vargs, callback);
	};


/***/ },
/* 24 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var events = __webpack_require__(25);
	var precond = __webpack_require__(26);
	var util = __webpack_require__(21);

	// A class to hold the state of a backoff operation. Accepts a backoff strategy
	// to generate the backoff delays.
	function Backoff(backoffStrategy) {
	    events.EventEmitter.call(this);

	    this.backoffStrategy_ = backoffStrategy;
	    this.maxNumberOfRetry_ = -1;
	    this.backoffNumber_ = 0;
	    this.backoffDelay_ = 0;
	    this.timeoutID_ = -1;

	    this.handlers = {
	        backoff: this.onBackoff_.bind(this)
	    };
	}
	util.inherits(Backoff, events.EventEmitter);

	// Sets a limit, greater than 0, on the maximum number of backoffs. A 'fail'
	// event will be emitted when the limit is reached.
	Backoff.prototype.failAfter = function(maxNumberOfRetry) {
	    precond.checkArgument(maxNumberOfRetry > 0,
	        'Expected a maximum number of retry greater than 0 but got %s.',
	        maxNumberOfRetry);

	    this.maxNumberOfRetry_ = maxNumberOfRetry;
	};

	// Starts a backoff operation. Accepts an optional parameter to let the
	// listeners know why the backoff operation was started.
	Backoff.prototype.backoff = function(err) {
	    precond.checkState(this.timeoutID_ === -1, 'Backoff in progress.');

	    if (this.backoffNumber_ === this.maxNumberOfRetry_) {
	        this.emit('fail', err);
	        this.reset();
	    } else {
	        this.backoffDelay_ = this.backoffStrategy_.next();
	        this.timeoutID_ = setTimeout(this.handlers.backoff, this.backoffDelay_);
	        this.emit('backoff', this.backoffNumber_, this.backoffDelay_, err);
	    }
	};

	// Handles the backoff timeout completion.
	Backoff.prototype.onBackoff_ = function() {
	    this.timeoutID_ = -1;
	    this.emit('ready', this.backoffNumber_, this.backoffDelay_);
	    this.backoffNumber_++;
	};

	// Stops any backoff operation and resets the backoff delay to its inital value.
	Backoff.prototype.reset = function() {
	    this.backoffNumber_ = 0;
	    this.backoffStrategy_.reset();
	    clearTimeout(this.timeoutID_);
	    this.timeoutID_ = -1;
	};

	module.exports = Backoff;


/***/ },
/* 25 */
/***/ function(module, exports) {

	module.exports = require("events");

/***/ },
/* 26 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * Copyright (c) 2012 Mathieu Turcotte
	 * Licensed under the MIT license.
	 */

	module.exports = __webpack_require__(27);

/***/ },
/* 27 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * Copyright (c) 2012 Mathieu Turcotte
	 * Licensed under the MIT license.
	 */

	var util = __webpack_require__(21);

	var errors = module.exports = __webpack_require__(28);

	function failCheck(ExceptionConstructor, callee, messageFormat, formatArgs) {
	    messageFormat = messageFormat || '';
	    var message = util.format.apply(this, [messageFormat].concat(formatArgs));
	    var error = new ExceptionConstructor(message);
	    Error.captureStackTrace(error, callee);
	    throw error;
	}

	function failArgumentCheck(callee, message, formatArgs) {
	    failCheck(errors.IllegalArgumentError, callee, message, formatArgs);
	}

	function failStateCheck(callee, message, formatArgs) {
	    failCheck(errors.IllegalStateError, callee, message, formatArgs);
	}

	module.exports.checkArgument = function(value, message) {
	    if (!value) {
	        failArgumentCheck(arguments.callee, message,
	            Array.prototype.slice.call(arguments, 2));
	    }
	};

	module.exports.checkState = function(value, message) {
	    if (!value) {
	        failStateCheck(arguments.callee, message,
	            Array.prototype.slice.call(arguments, 2));
	    }
	};

	module.exports.checkIsDef = function(value, message) {
	    if (value !== undefined) {
	        return value;
	    }

	    failArgumentCheck(arguments.callee, message ||
	        'Expected value to be defined but was undefined.',
	        Array.prototype.slice.call(arguments, 2));
	};

	module.exports.checkIsDefAndNotNull = function(value, message) {
	    // Note that undefined == null.
	    if (value != null) {
	        return value;
	    }

	    failArgumentCheck(arguments.callee, message ||
	        'Expected value to be defined and not null but got "' +
	        typeOf(value) + '".', Array.prototype.slice.call(arguments, 2));
	};

	// Fixed version of the typeOf operator which returns 'null' for null values
	// and 'array' for arrays.
	function typeOf(value) {
	    var s = typeof value;
	    if (s == 'object') {
	        if (!value) {
	            return 'null';
	        } else if (value instanceof Array) {
	            return 'array';
	        }
	    }
	    return s;
	}

	function typeCheck(expect) {
	    return function(value, message) {
	        var type = typeOf(value);

	        if (type == expect) {
	            return value;
	        }

	        failArgumentCheck(arguments.callee, message ||
	            'Expected "' + expect + '" but got "' + type + '".',
	            Array.prototype.slice.call(arguments, 2));
	    };
	}

	module.exports.checkIsString = typeCheck('string');
	module.exports.checkIsArray = typeCheck('array');
	module.exports.checkIsNumber = typeCheck('number');
	module.exports.checkIsBoolean = typeCheck('boolean');
	module.exports.checkIsFunction = typeCheck('function');
	module.exports.checkIsObject = typeCheck('object');


/***/ },
/* 28 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * Copyright (c) 2012 Mathieu Turcotte
	 * Licensed under the MIT license.
	 */

	var util = __webpack_require__(21);

	function IllegalArgumentError(message) {
	    Error.call(this, message);
	    this.message = message;
	}
	util.inherits(IllegalArgumentError, Error);

	IllegalArgumentError.prototype.name = 'IllegalArgumentError';

	function IllegalStateError(message) {
	    Error.call(this, message);
	    this.message = message;
	}
	util.inherits(IllegalStateError, Error);

	IllegalStateError.prototype.name = 'IllegalStateError';

	module.exports.IllegalStateError = IllegalStateError;
	module.exports.IllegalArgumentError = IllegalArgumentError;

/***/ },
/* 29 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var util = __webpack_require__(21);
	var precond = __webpack_require__(26);

	var BackoffStrategy = __webpack_require__(30);

	// Exponential backoff strategy.
	function ExponentialBackoffStrategy(options) {
	    BackoffStrategy.call(this, options);
	    this.backoffDelay_ = 0;
	    this.nextBackoffDelay_ = this.getInitialDelay();
	    this.factor_ = ExponentialBackoffStrategy.DEFAULT_FACTOR;

	    if (options && options.factor !== undefined) {
	        precond.checkArgument(options.factor > 1,
	            'Exponential factor should be greater than 1 but got %s.',
	            options.factor);
	        this.factor_ = options.factor;
	    }
	}
	util.inherits(ExponentialBackoffStrategy, BackoffStrategy);

	// Default multiplication factor used to compute the next backoff delay from
	// the current one. The value can be overridden by passing a custom factor as
	// part of the options.
	ExponentialBackoffStrategy.DEFAULT_FACTOR = 2;

	ExponentialBackoffStrategy.prototype.next_ = function() {
	    this.backoffDelay_ = Math.min(this.nextBackoffDelay_, this.getMaxDelay());
	    this.nextBackoffDelay_ = this.backoffDelay_ * this.factor_;
	    return this.backoffDelay_;
	};

	ExponentialBackoffStrategy.prototype.reset_ = function() {
	    this.backoffDelay_ = 0;
	    this.nextBackoffDelay_ = this.getInitialDelay();
	};

	module.exports = ExponentialBackoffStrategy;


/***/ },
/* 30 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var events = __webpack_require__(25);
	var util = __webpack_require__(21);

	function isDef(value) {
	    return value !== undefined && value !== null;
	}

	// Abstract class defining the skeleton for the backoff strategies. Accepts an
	// object holding the options for the backoff strategy:
	//
	//  * `randomisationFactor`: The randomisation factor which must be between 0
	//     and 1 where 1 equates to a randomization factor of 100% and 0 to no
	//     randomization.
	//  * `initialDelay`: The backoff initial delay in milliseconds.
	//  * `maxDelay`: The backoff maximal delay in milliseconds.
	function BackoffStrategy(options) {
	    options = options || {};

	    if (isDef(options.initialDelay) && options.initialDelay < 1) {
	        throw new Error('The initial timeout must be greater than 0.');
	    } else if (isDef(options.maxDelay) && options.maxDelay < 1) {
	        throw new Error('The maximal timeout must be greater than 0.');
	    }

	    this.initialDelay_ = options.initialDelay || 100;
	    this.maxDelay_ = options.maxDelay || 10000;

	    if (this.maxDelay_ <= this.initialDelay_) {
	        throw new Error('The maximal backoff delay must be ' +
	                        'greater than the initial backoff delay.');
	    }

	    if (isDef(options.randomisationFactor) &&
	        (options.randomisationFactor < 0 || options.randomisationFactor > 1)) {
	        throw new Error('The randomisation factor must be between 0 and 1.');
	    }

	    this.randomisationFactor_ = options.randomisationFactor || 0;
	}

	// Gets the maximal backoff delay.
	BackoffStrategy.prototype.getMaxDelay = function() {
	    return this.maxDelay_;
	};

	// Gets the initial backoff delay.
	BackoffStrategy.prototype.getInitialDelay = function() {
	    return this.initialDelay_;
	};

	// Template method that computes and returns the next backoff delay in
	// milliseconds.
	BackoffStrategy.prototype.next = function() {
	    var backoffDelay = this.next_();
	    var randomisationMultiple = 1 + Math.random() * this.randomisationFactor_;
	    var randomizedDelay = Math.round(backoffDelay * randomisationMultiple);
	    return randomizedDelay;
	};

	// Computes and returns the next backoff delay. Intended to be overridden by
	// subclasses.
	BackoffStrategy.prototype.next_ = function() {
	    throw new Error('BackoffStrategy.next_() unimplemented.');
	};

	// Template method that resets the backoff delay to its initial value.
	BackoffStrategy.prototype.reset = function() {
	    this.reset_();
	};

	// Resets the backoff delay to its initial value. Intended to be overridden by
	// subclasses.
	BackoffStrategy.prototype.reset_ = function() {
	    throw new Error('BackoffStrategy.reset_() unimplemented.');
	};

	module.exports = BackoffStrategy;


/***/ },
/* 31 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var util = __webpack_require__(21);

	var BackoffStrategy = __webpack_require__(30);

	// Fibonacci backoff strategy.
	function FibonacciBackoffStrategy(options) {
	    BackoffStrategy.call(this, options);
	    this.backoffDelay_ = 0;
	    this.nextBackoffDelay_ = this.getInitialDelay();
	}
	util.inherits(FibonacciBackoffStrategy, BackoffStrategy);

	FibonacciBackoffStrategy.prototype.next_ = function() {
	    var backoffDelay = Math.min(this.nextBackoffDelay_, this.getMaxDelay());
	    this.nextBackoffDelay_ += this.backoffDelay_;
	    this.backoffDelay_ = backoffDelay;
	    return backoffDelay;
	};

	FibonacciBackoffStrategy.prototype.reset_ = function() {
	    this.nextBackoffDelay_ = this.getInitialDelay();
	    this.backoffDelay_ = 0;
	};

	module.exports = FibonacciBackoffStrategy;


/***/ },
/* 32 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var events = __webpack_require__(25);
	var precond = __webpack_require__(26);
	var util = __webpack_require__(21);

	var Backoff = __webpack_require__(24);
	var FibonacciBackoffStrategy = __webpack_require__(31);

	// Wraps a function to be called in a backoff loop.
	function FunctionCall(fn, args, callback) {
	    events.EventEmitter.call(this);

	    precond.checkIsFunction(fn, 'Expected fn to be a function.');
	    precond.checkIsArray(args, 'Expected args to be an array.');
	    precond.checkIsFunction(callback, 'Expected callback to be a function.');

	    this.function_ = fn;
	    this.arguments_ = args;
	    this.callback_ = callback;
	    this.lastResult_ = [];
	    this.numRetries_ = 0;

	    this.backoff_ = null;
	    this.strategy_ = null;
	    this.failAfter_ = -1;
	    this.retryPredicate_ = FunctionCall.DEFAULT_RETRY_PREDICATE_;

	    this.state_ = FunctionCall.State_.PENDING;
	}
	util.inherits(FunctionCall, events.EventEmitter);

	// States in which the call can be.
	FunctionCall.State_ = {
	    // Call isn't started yet.
	    PENDING: 0,
	    // Call is in progress.
	    RUNNING: 1,
	    // Call completed successfully which means that either the wrapped function
	    // returned successfully or the maximal number of backoffs was reached.
	    COMPLETED: 2,
	    // The call was aborted.
	    ABORTED: 3
	};

	// The default retry predicate which considers any error as retriable.
	FunctionCall.DEFAULT_RETRY_PREDICATE_ = function(err) {
	  return true;
	};

	// Checks whether the call is pending.
	FunctionCall.prototype.isPending = function() {
	    return this.state_ == FunctionCall.State_.PENDING;
	};

	// Checks whether the call is in progress.
	FunctionCall.prototype.isRunning = function() {
	    return this.state_ == FunctionCall.State_.RUNNING;
	};

	// Checks whether the call is completed.
	FunctionCall.prototype.isCompleted = function() {
	    return this.state_ == FunctionCall.State_.COMPLETED;
	};

	// Checks whether the call is aborted.
	FunctionCall.prototype.isAborted = function() {
	    return this.state_ == FunctionCall.State_.ABORTED;
	};

	// Sets the backoff strategy to use. Can only be called before the call is
	// started otherwise an exception will be thrown.
	FunctionCall.prototype.setStrategy = function(strategy) {
	    precond.checkState(this.isPending(), 'FunctionCall in progress.');
	    this.strategy_ = strategy;
	    return this; // Return this for chaining.
	};

	// Sets the predicate which will be used to determine whether the errors
	// returned from the wrapped function should be retried or not, e.g. a
	// network error would be retriable while a type error would stop the
	// function call.
	FunctionCall.prototype.retryIf = function(retryPredicate) {
	    precond.checkState(this.isPending(), 'FunctionCall in progress.');
	    this.retryPredicate_ = retryPredicate;
	    return this;
	};

	// Returns all intermediary results returned by the wrapped function since
	// the initial call.
	FunctionCall.prototype.getLastResult = function() {
	    return this.lastResult_.concat();
	};

	// Returns the number of times the wrapped function call was retried.
	FunctionCall.prototype.getNumRetries = function() {
	    return this.numRetries_;
	};

	// Sets the backoff limit.
	FunctionCall.prototype.failAfter = function(maxNumberOfRetry) {
	    precond.checkState(this.isPending(), 'FunctionCall in progress.');
	    this.failAfter_ = maxNumberOfRetry;
	    return this; // Return this for chaining.
	};

	// Aborts the call.
	FunctionCall.prototype.abort = function() {
	    if (this.isCompleted() || this.isAborted()) {
	      return;
	    }

	    if (this.isRunning()) {
	        this.backoff_.reset();
	    }

	    this.state_ = FunctionCall.State_.ABORTED;
	    this.lastResult_ = [new Error('Backoff aborted.')];
	    this.emit('abort');
	    this.doCallback_();
	};

	// Initiates the call to the wrapped function. Accepts an optional factory
	// function used to create the backoff instance; used when testing.
	FunctionCall.prototype.start = function(backoffFactory) {
	    precond.checkState(!this.isAborted(), 'FunctionCall is aborted.');
	    precond.checkState(this.isPending(), 'FunctionCall already started.');

	    var strategy = this.strategy_ || new FibonacciBackoffStrategy();

	    this.backoff_ = backoffFactory ?
	        backoffFactory(strategy) :
	        new Backoff(strategy);

	    this.backoff_.on('ready', this.doCall_.bind(this, true /* isRetry */));
	    this.backoff_.on('fail', this.doCallback_.bind(this));
	    this.backoff_.on('backoff', this.handleBackoff_.bind(this));

	    if (this.failAfter_ > 0) {
	        this.backoff_.failAfter(this.failAfter_);
	    }

	    this.state_ = FunctionCall.State_.RUNNING;
	    this.doCall_(false /* isRetry */);
	};

	// Calls the wrapped function.
	FunctionCall.prototype.doCall_ = function(isRetry) {
	    if (isRetry) {
	        this.numRetries_++;
	    }
	    var eventArgs = ['call'].concat(this.arguments_);
	    events.EventEmitter.prototype.emit.apply(this, eventArgs);
	    var callback = this.handleFunctionCallback_.bind(this);
	    this.function_.apply(null, this.arguments_.concat(callback));
	};

	// Calls the wrapped function's callback with the last result returned by the
	// wrapped function.
	FunctionCall.prototype.doCallback_ = function() {
	    this.callback_.apply(null, this.lastResult_);
	};

	// Handles wrapped function's completion. This method acts as a replacement
	// for the original callback function.
	FunctionCall.prototype.handleFunctionCallback_ = function() {
	    if (this.isAborted()) {
	        return;
	    }

	    var args = Array.prototype.slice.call(arguments);
	    this.lastResult_ = args; // Save last callback arguments.
	    events.EventEmitter.prototype.emit.apply(this, ['callback'].concat(args));

	    var err = args[0];
	    if (err && this.retryPredicate_(err)) {
	        this.backoff_.backoff(err);
	    } else {
	        this.state_ = FunctionCall.State_.COMPLETED;
	        this.doCallback_();
	    }
	};

	// Handles the backoff event by reemitting it.
	FunctionCall.prototype.handleBackoff_ = function(number, delay, err) {
	    this.emit('backoff', number, delay, err);
	};

	module.exports = FunctionCall;


/***/ },
/* 33 */
/***/ function(module, exports) {

	module.exports = {
		"title": "Auth0 Logs to CloudWatch",
		"name": "auth0-logs-to-cloudwatch",
		"version": "1.1.0",
		"author": "auth0",
		"description": "This extension will take all of your Auth0 logs and export them to CloudWatch",
		"type": "cron",
		"logoUrl": "https://truesightpulse.bmc.com/wp-content/uploads/2016/11/cloudwatch.png",
		"repository": "https://github.com/pushpabrol/auth0-logs-cloudwatch",
		"keywords": [
			"auth0",
			"extension"
		],
		"schedule": "0 */5 * * * *",
		"auth0": {
			"scopes": "read:logs"
		},
		"secrets": {
			"CLOUDWATCH_LOG_GROUP_NAME": {
				"description": "Cloudwatch Log Group Name",
				"required": true
			},
			"CLOUDWATCH_LOG_STREAM_NAME": {
				"description": "Cloudwatch Log Group Stream Name",
				"required": true
			},
			"AWS_ACCESS_KEY_ID": {
				"description": "AWS Access Key Id Host",
				"required": true
			},
			"AWS_SECRET_KEY": {
				"description": "AWS Secret Key",
				"required": true
			},
			"AWS_REGION": {
				"description": "AWS Region",
				"required": true
			},
			"BATCH_SIZE": {
				"description": "The ammount of logs to be read on each execution. Maximun is 100.",
				"default": 100
			},
			"LOG_LEVEL": {
				"description": "This allows you to specify the log level of events that need to be sent",
				"type": "select",
				"allowMultiple": true,
				"options": [
					{
						"value": "-",
						"text": ""
					},
					{
						"value": "0",
						"text": "Debug"
					},
					{
						"value": "1",
						"text": "Info"
					},
					{
						"value": "2",
						"text": "Warning"
					},
					{
						"value": "3",
						"text": "Error"
					},
					{
						"value": "4",
						"text": "Critical"
					}
				]
			},
			"LOG_TYPES": {
				"description": "If you only want to send events with a specific type (eg: failed logins)",
				"type": "select",
				"allowMultiple": true,
				"options": [
					{
						"value": "-",
						"text": ""
					},
					{
						"value": "s",
						"text": "Success Login (Info)"
					},
					{
						"value": "seacft",
						"text": "Success Exchange (Info)"
					},
					{
						"value": "feacft",
						"text": "Failed Exchange (Error)"
					},
					{
						"value": "f",
						"text": "Failed Login (Error)"
					},
					{
						"value": "w",
						"text": "Warnings During Login (Warning)"
					},
					{
						"value": "du",
						"text": "Deleted User (Info)"
					},
					{
						"value": "fu",
						"text": "Failed Login (invalid email/username) (Error)"
					},
					{
						"value": "fp",
						"text": "Failed Login (wrong password) (Error)"
					},
					{
						"value": "fc",
						"text": "Failed by Connector (Error)"
					},
					{
						"value": "fco",
						"text": "Failed by CORS (Error)"
					},
					{
						"value": "con",
						"text": "Connector Online (Info)"
					},
					{
						"value": "coff",
						"text": "Connector Offline (Error)"
					},
					{
						"value": "fcpro",
						"text": "Failed Connector Provisioning (Critical)"
					},
					{
						"value": "ss",
						"text": "Success Signup (Info)"
					},
					{
						"value": "fs",
						"text": "Failed Signup (Error)"
					},
					{
						"value": "cs",
						"text": "Code Sent (Debug)"
					},
					{
						"value": "cls",
						"text": "Code/Link Sent (Debug)"
					},
					{
						"value": "sv",
						"text": "Success Verification Email (Debug)"
					},
					{
						"value": "fv",
						"text": "Failed Verification Email (Debug)"
					},
					{
						"value": "scp",
						"text": "Success Change Password (Info)"
					},
					{
						"value": "fcp",
						"text": "Failed Change Password (Error)"
					},
					{
						"value": "sce",
						"text": "Success Change Email (Info)"
					},
					{
						"value": "fce",
						"text": "Failed Change Email (Error)"
					},
					{
						"value": "scu",
						"text": "Success Change Username (Info)"
					},
					{
						"value": "fcu",
						"text": "Failed Change Username (Error)"
					},
					{
						"value": "scpn",
						"text": "Success Change Phone Number (Info)"
					},
					{
						"value": "fcpn",
						"text": "Failed Change Phone Number (Error)"
					},
					{
						"value": "svr",
						"text": "Success Verification Email Request (Debug)"
					},
					{
						"value": "fvr",
						"text": "Failed Verification Email Request (Error)"
					},
					{
						"value": "scpr",
						"text": "Success Change Password Request (Debug)"
					},
					{
						"value": "fcpr",
						"text": "Failed Change Password Request (Error)"
					},
					{
						"value": "fn",
						"text": "Failed Sending Notification (Error)"
					},
					{
						"value": "limit_wc",
						"text": "Blocked Account (Critical)"
					},
					{
						"value": "limit_ui",
						"text": "Too Many Calls to /userinfo (Critical)"
					},
					{
						"value": "api_limit",
						"text": "Rate Limit On API (Critical)"
					},
					{
						"value": "sdu",
						"text": "Successful User Deletion (Info)"
					},
					{
						"value": "fdu",
						"text": "Failed User Deletion (Error)"
					}
				]
			}
		}
	};

/***/ }
/******/ ]);