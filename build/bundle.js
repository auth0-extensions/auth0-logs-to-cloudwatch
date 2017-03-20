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

	/* WEBPACK VAR INJECTION */(function(setImmediate) {"use npm";
	"use strict";

	var winston = __webpack_require__(4);
	var Auth0 = __webpack_require__(5);
	var async = __webpack_require__(6);
	var moment = __webpack_require__(7);
	var useragent = __webpack_require__(8);
	var express = __webpack_require__(9);
	var Webtask = __webpack_require__(10);
	var app = express();

	var winstCwatch = __webpack_require__(21);

	function lastLogCheckpoint(req, res) {
	  var ctx = req.webtaskContext;
	  var required_settings = ['AUTH0_DOMAIN', 'AUTH0_GLOBAL_CLIENT_ID', 'AUTH0_GLOBAL_CLIENT_SECRET'];
	  var missing_settings = required_settings.filter(function (setting) {
	    return !ctx.data[setting];
	  });

	  if (missing_settings.length) {
	    return res.status(400).send({ message: 'Missing settings: ' + missing_settings.join(', ') });
	  }

	  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
	  req.webtaskContext.read('history', {}, function (err, data) {

	    var startCheckpointId = typeof data === 'undefined' ? null : data.checkpointId;

	    // Initialize both clients.
	    var auth0 = new Auth0({
	      domain: ctx.data.AUTH0_DOMAIN,
	      clientID: ctx.data.AUTH0_GLOBAL_CLIENT_ID,
	      clientSecret: ctx.data.AUTH0_GLOBAL_CLIENT_SECRET
	    });

	    var logger = new winston.Logger({
	      transports: [new winstCwatch({
	        logGroupName: "auth0-pushp",
	        logStreamName: "auth0-pushp-stream",
	        awsAccessKeyId: "AKIAI2NS6FD5W7AL2EOQ",
	        awsSecretKey: "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",
	        awsRegion: "us-east-1"
	      })]
	    });

	    // Start the process.
	    async.waterfall([function (callback) {
	      auth0.getAccessToken(function (err) {
	        if (err) {
	          console.log('Error authenticating:', err);
	        }
	        return callback(err);
	      });
	    }, function (callback) {
	      var getLogs = function getLogs(context) {
	        console.log("Downloading logs from: " + (context.checkpointId || 'Start') + ".");

	        context.logs = context.logs || [];
	        auth0.getLogs({ take: 200, from: context.checkpointId }, function (err, logs) {
	          if (err) {
	            return callback(err);
	          }

	          if (logs && logs.length) {
	            logs.forEach(function (l) {
	              return context.logs.push(l);
	            });
	            context.checkpointId = context.logs[context.logs.length - 1]._id;
	            return setImmediate(function () {
	              return getLogs(context);
	            });
	          }

	          console.log("Total logs: " + context.logs.length + ".");
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

	      var types_filter = ctx.data.LOG_TYPES && ctx.data.LOG_TYPES.split(',') || [];
	      var log_matches_types = function log_matches_types(log) {
	        if (!types_filter || !types_filter.length) return true;
	        return log.type && types_filter.indexOf(log.type) >= 0;
	      };

	      context.logs = context.logs.filter(function (l) {
	        return l.type !== 'sapi' && l.type !== 'fapi';
	      }).filter(log_matches_level).filter(log_matches_types);

	      console.log("Filtered logs on log level '" + min_log_level + "': " + context.logs.length + ".");

	      if (ctx.data.LOG_TYPES) {
	        console.log("Filtered logs on '" + ctx.data.LOG_TYPES + "': " + context.logs.length + ".");
	      }

	      callback(null, context);
	    }, function (context, callback) {
	      console.log('Uploading blobs...');

	      async.eachLimit(context.logs, 5, function (log, cb) {
	        var date = moment(log.date);
	        var url = date.format('YYYY/MM/DD') + "/" + date.format('HH') + "/" + log._id + ".json";
	        console.log("Uploading " + url + ".");

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

	        return req.webtaskContext.write('history', JSON.stringify({ checkpointId: startCheckpointId }), {}, function (error) {
	          if (error) return res.status(500).send(error);

	          res.status(500).send({
	            error: err
	          });
	        });
	      }

	      console.log('Job complete.');
	      return req.webtaskContext.write('history', JSON.stringify({
	        checkpointId: context.checkpointId,
	        totalLogsProcessed: context.logs.length
	      }), {}, function (error) {
	        if (error) return res.status(500).send(error);

	        res.sendStatus(200);
	      });
	    });
	  });
	}

	var logTypes = {
	  's': {
	    event: 'Success Login',
	    level: 1 // Info
	  },
	  'seacft': {
	    event: 'Success Exchange',
	    level: 1 // Info
	  },
	  'feacft': {
	    event: 'Failed Exchange',
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
	};

	app.get('/', lastLogCheckpoint);
	app.post('/', lastLogCheckpoint);

	module.exports = Webtask.fromExpress(app);
	/* WEBPACK VAR INJECTION */}.call(exports, __webpack_require__(1).setImmediate))

/***/ },
/* 1 */
/***/ function(module, exports, __webpack_require__) {

	var apply = Function.prototype.apply;

	// DOM APIs, for completeness

	exports.setTimeout = function() {
	  return new Timeout(apply.call(setTimeout, window, arguments), clearTimeout);
	};
	exports.setInterval = function() {
	  return new Timeout(apply.call(setInterval, window, arguments), clearInterval);
	};
	exports.clearTimeout =
	exports.clearInterval = function(timeout) {
	  if (timeout) {
	    timeout.close();
	  }
	};

	function Timeout(id, clearFn) {
	  this._id = id;
	  this._clearFn = clearFn;
	}
	Timeout.prototype.unref = Timeout.prototype.ref = function() {};
	Timeout.prototype.close = function() {
	  this._clearFn.call(window, this._id);
	};

	// Does not start the time, just sets up the members needed.
	exports.enroll = function(item, msecs) {
	  clearTimeout(item._idleTimeoutId);
	  item._idleTimeout = msecs;
	};

	exports.unenroll = function(item) {
	  clearTimeout(item._idleTimeoutId);
	  item._idleTimeout = -1;
	};

	exports._unrefActive = exports.active = function(item) {
	  clearTimeout(item._idleTimeoutId);

	  var msecs = item._idleTimeout;
	  if (msecs >= 0) {
	    item._idleTimeoutId = setTimeout(function onTimeout() {
	      if (item._onTimeout)
	        item._onTimeout();
	    }, msecs);
	  }
	};

	// setimmediate attaches itself to the global object
	__webpack_require__(2);
	exports.setImmediate = setImmediate;
	exports.clearImmediate = clearImmediate;


/***/ },
/* 2 */
/***/ function(module, exports, __webpack_require__) {

	/* WEBPACK VAR INJECTION */(function(global, process) {(function (global, undefined) {
	    "use strict";

	    if (global.setImmediate) {
	        return;
	    }

	    var nextHandle = 1; // Spec says greater than zero
	    var tasksByHandle = {};
	    var currentlyRunningATask = false;
	    var doc = global.document;
	    var registerImmediate;

	    function setImmediate(callback) {
	      // Callback can either be a function or a string
	      if (typeof callback !== "function") {
	        callback = new Function("" + callback);
	      }
	      // Copy function arguments
	      var args = new Array(arguments.length - 1);
	      for (var i = 0; i < args.length; i++) {
	          args[i] = arguments[i + 1];
	      }
	      // Store and register the task
	      var task = { callback: callback, args: args };
	      tasksByHandle[nextHandle] = task;
	      registerImmediate(nextHandle);
	      return nextHandle++;
	    }

	    function clearImmediate(handle) {
	        delete tasksByHandle[handle];
	    }

	    function run(task) {
	        var callback = task.callback;
	        var args = task.args;
	        switch (args.length) {
	        case 0:
	            callback();
	            break;
	        case 1:
	            callback(args[0]);
	            break;
	        case 2:
	            callback(args[0], args[1]);
	            break;
	        case 3:
	            callback(args[0], args[1], args[2]);
	            break;
	        default:
	            callback.apply(undefined, args);
	            break;
	        }
	    }

	    function runIfPresent(handle) {
	        // From the spec: "Wait until any invocations of this algorithm started before this one have completed."
	        // So if we're currently running a task, we'll need to delay this invocation.
	        if (currentlyRunningATask) {
	            // Delay by doing a setTimeout. setImmediate was tried instead, but in Firefox 7 it generated a
	            // "too much recursion" error.
	            setTimeout(runIfPresent, 0, handle);
	        } else {
	            var task = tasksByHandle[handle];
	            if (task) {
	                currentlyRunningATask = true;
	                try {
	                    run(task);
	                } finally {
	                    clearImmediate(handle);
	                    currentlyRunningATask = false;
	                }
	            }
	        }
	    }

	    function installNextTickImplementation() {
	        registerImmediate = function(handle) {
	            process.nextTick(function () { runIfPresent(handle); });
	        };
	    }

	    function canUsePostMessage() {
	        // The test against `importScripts` prevents this implementation from being installed inside a web worker,
	        // where `global.postMessage` means something completely different and can't be used for this purpose.
	        if (global.postMessage && !global.importScripts) {
	            var postMessageIsAsynchronous = true;
	            var oldOnMessage = global.onmessage;
	            global.onmessage = function() {
	                postMessageIsAsynchronous = false;
	            };
	            global.postMessage("", "*");
	            global.onmessage = oldOnMessage;
	            return postMessageIsAsynchronous;
	        }
	    }

	    function installPostMessageImplementation() {
	        // Installs an event handler on `global` for the `message` event: see
	        // * https://developer.mozilla.org/en/DOM/window.postMessage
	        // * http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#crossDocumentMessages

	        var messagePrefix = "setImmediate$" + Math.random() + "$";
	        var onGlobalMessage = function(event) {
	            if (event.source === global &&
	                typeof event.data === "string" &&
	                event.data.indexOf(messagePrefix) === 0) {
	                runIfPresent(+event.data.slice(messagePrefix.length));
	            }
	        };

	        if (global.addEventListener) {
	            global.addEventListener("message", onGlobalMessage, false);
	        } else {
	            global.attachEvent("onmessage", onGlobalMessage);
	        }

	        registerImmediate = function(handle) {
	            global.postMessage(messagePrefix + handle, "*");
	        };
	    }

	    function installMessageChannelImplementation() {
	        var channel = new MessageChannel();
	        channel.port1.onmessage = function(event) {
	            var handle = event.data;
	            runIfPresent(handle);
	        };

	        registerImmediate = function(handle) {
	            channel.port2.postMessage(handle);
	        };
	    }

	    function installReadyStateChangeImplementation() {
	        var html = doc.documentElement;
	        registerImmediate = function(handle) {
	            // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
	            // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
	            var script = doc.createElement("script");
	            script.onreadystatechange = function () {
	                runIfPresent(handle);
	                script.onreadystatechange = null;
	                html.removeChild(script);
	                script = null;
	            };
	            html.appendChild(script);
	        };
	    }

	    function installSetTimeoutImplementation() {
	        registerImmediate = function(handle) {
	            setTimeout(runIfPresent, 0, handle);
	        };
	    }

	    // If supported, we should attach to the prototype of global, since that is where setTimeout et al. live.
	    var attachTo = Object.getPrototypeOf && Object.getPrototypeOf(global);
	    attachTo = attachTo && attachTo.setTimeout ? attachTo : global;

	    // Don't get fooled by e.g. browserify environments.
	    if ({}.toString.call(global.process) === "[object process]") {
	        // For Node.js before 0.9
	        installNextTickImplementation();

	    } else if (canUsePostMessage()) {
	        // For non-IE10 modern browsers
	        installPostMessageImplementation();

	    } else if (global.MessageChannel) {
	        // For web workers, where supported
	        installMessageChannelImplementation();

	    } else if (doc && "onreadystatechange" in doc.createElement("script")) {
	        // For IE 6–8
	        installReadyStateChangeImplementation();

	    } else {
	        // For older browsers
	        installSetTimeoutImplementation();
	    }

	    attachTo.setImmediate = setImmediate;
	    attachTo.clearImmediate = clearImmediate;
	}(typeof self === "undefined" ? typeof global === "undefined" ? this : global : self));

	/* WEBPACK VAR INJECTION */}.call(exports, (function() { return this; }()), __webpack_require__(3)))

/***/ },
/* 3 */
/***/ function(module, exports) {

	// shim for using process in browser
	var process = module.exports = {};

	// cached from whatever global is present so that test runners that stub it
	// don't break things.  But we need to wrap it in a try catch in case it is
	// wrapped in strict mode code which doesn't define any globals.  It's inside a
	// function because try/catches deoptimize in certain engines.

	var cachedSetTimeout;
	var cachedClearTimeout;

	function defaultSetTimout() {
	    throw new Error('setTimeout has not been defined');
	}
	function defaultClearTimeout () {
	    throw new Error('clearTimeout has not been defined');
	}
	(function () {
	    try {
	        if (typeof setTimeout === 'function') {
	            cachedSetTimeout = setTimeout;
	        } else {
	            cachedSetTimeout = defaultSetTimout;
	        }
	    } catch (e) {
	        cachedSetTimeout = defaultSetTimout;
	    }
	    try {
	        if (typeof clearTimeout === 'function') {
	            cachedClearTimeout = clearTimeout;
	        } else {
	            cachedClearTimeout = defaultClearTimeout;
	        }
	    } catch (e) {
	        cachedClearTimeout = defaultClearTimeout;
	    }
	} ())
	function runTimeout(fun) {
	    if (cachedSetTimeout === setTimeout) {
	        //normal enviroments in sane situations
	        return setTimeout(fun, 0);
	    }
	    // if setTimeout wasn't available but was latter defined
	    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
	        cachedSetTimeout = setTimeout;
	        return setTimeout(fun, 0);
	    }
	    try {
	        // when when somebody has screwed with setTimeout but no I.E. maddness
	        return cachedSetTimeout(fun, 0);
	    } catch(e){
	        try {
	            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
	            return cachedSetTimeout.call(null, fun, 0);
	        } catch(e){
	            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
	            return cachedSetTimeout.call(this, fun, 0);
	        }
	    }


	}
	function runClearTimeout(marker) {
	    if (cachedClearTimeout === clearTimeout) {
	        //normal enviroments in sane situations
	        return clearTimeout(marker);
	    }
	    // if clearTimeout wasn't available but was latter defined
	    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
	        cachedClearTimeout = clearTimeout;
	        return clearTimeout(marker);
	    }
	    try {
	        // when when somebody has screwed with setTimeout but no I.E. maddness
	        return cachedClearTimeout(marker);
	    } catch (e){
	        try {
	            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
	            return cachedClearTimeout.call(null, marker);
	        } catch (e){
	            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
	            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
	            return cachedClearTimeout.call(this, marker);
	        }
	    }



	}
	var queue = [];
	var draining = false;
	var currentQueue;
	var queueIndex = -1;

	function cleanUpNextTick() {
	    if (!draining || !currentQueue) {
	        return;
	    }
	    draining = false;
	    if (currentQueue.length) {
	        queue = currentQueue.concat(queue);
	    } else {
	        queueIndex = -1;
	    }
	    if (queue.length) {
	        drainQueue();
	    }
	}

	function drainQueue() {
	    if (draining) {
	        return;
	    }
	    var timeout = runTimeout(cleanUpNextTick);
	    draining = true;

	    var len = queue.length;
	    while(len) {
	        currentQueue = queue;
	        queue = [];
	        while (++queueIndex < len) {
	            if (currentQueue) {
	                currentQueue[queueIndex].run();
	            }
	        }
	        queueIndex = -1;
	        len = queue.length;
	    }
	    currentQueue = null;
	    draining = false;
	    runClearTimeout(timeout);
	}

	process.nextTick = function (fun) {
	    var args = new Array(arguments.length - 1);
	    if (arguments.length > 1) {
	        for (var i = 1; i < arguments.length; i++) {
	            args[i - 1] = arguments[i];
	        }
	    }
	    queue.push(new Item(fun, args));
	    if (queue.length === 1 && !draining) {
	        runTimeout(drainQueue);
	    }
	};

	// v8 likes predictible objects
	function Item(fun, array) {
	    this.fun = fun;
	    this.array = array;
	}
	Item.prototype.run = function () {
	    this.fun.apply(null, this.array);
	};
	process.title = 'browser';
	process.browser = true;
	process.env = {};
	process.argv = [];
	process.version = ''; // empty string to avoid regexp issues
	process.versions = {};

	function noop() {}

	process.on = noop;
	process.addListener = noop;
	process.once = noop;
	process.off = noop;
	process.removeListener = noop;
	process.removeAllListeners = noop;
	process.emit = noop;

	process.binding = function (name) {
	    throw new Error('process.binding is not supported');
	};

	process.cwd = function () { return '/' };
	process.chdir = function (dir) {
	    throw new Error('process.chdir is not supported');
	};
	process.umask = function() { return 0; };


/***/ },
/* 4 */
/***/ function(module, exports) {

	module.exports = require("winston");

/***/ },
/* 5 */
/***/ function(module, exports) {

	module.exports = require("auth0@0.8.2");

/***/ },
/* 6 */
/***/ function(module, exports) {

	module.exports = require("async");

/***/ },
/* 7 */
/***/ function(module, exports) {

	module.exports = require("moment");

/***/ },
/* 8 */
/***/ function(module, exports) {

	module.exports = require("useragent");

/***/ },
/* 9 */
/***/ function(module, exports) {

	module.exports = require("express");

/***/ },
/* 10 */
/***/ function(module, exports, __webpack_require__) {

	exports.auth0 = __webpack_require__(11);
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
	        var Boom = __webpack_require__(19);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        cb(Boom.preconditionFailed('Storage is not available in this context'));
	    }

	    function readFromPath(path, options, cb) {
	        var Boom = __webpack_require__(19);
	        var Request = __webpack_require__(20);

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
	        var Boom = __webpack_require__(19);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        cb(Boom.preconditionFailed('Storage is not available in this context'));
	    }

	    function writeToPath(path, data, options, cb) {
	        var Boom = __webpack_require__(19);
	        var Request = __webpack_require__(20);

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
/* 11 */
/***/ function(module, exports, __webpack_require__) {

	var url = __webpack_require__(12);
	var error = __webpack_require__(13);
	var handleAppEndpoint = __webpack_require__(14);
	var handleLogin = __webpack_require__(16);
	var handleCallback = __webpack_require__(17);

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
/* 12 */
/***/ function(module, exports) {

	module.exports = require("url");

/***/ },
/* 13 */
/***/ function(module, exports) {

	module.exports = function (err, res) {
	    res.writeHead(err.code || 500, { 
	        'Content-Type': 'application/json',
	        'Cache-Control': 'no-cache'
	    });
	    res.end(JSON.stringify(err));
	};


/***/ },
/* 14 */
/***/ function(module, exports, __webpack_require__) {

	var error = __webpack_require__(13);

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
	            ctx.user = req.user = __webpack_require__(15).verify(apiKey, secret);
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
/* 15 */
/***/ function(module, exports) {

	module.exports = require("jsonwebtoken");

/***/ },
/* 16 */
/***/ function(module, exports, __webpack_require__) {

	var error = __webpack_require__(13);

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
/* 17 */
/***/ function(module, exports, __webpack_require__) {

	var error = __webpack_require__(13);

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

	    return __webpack_require__(18)
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
	        var jwt = __webpack_require__(15);
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
/* 18 */
/***/ function(module, exports) {

	module.exports = require("superagent");

/***/ },
/* 19 */
/***/ function(module, exports) {

	module.exports = require("boom");

/***/ },
/* 20 */
/***/ function(module, exports) {

	module.exports = require("request");

/***/ },
/* 21 */
/***/ function(module, exports, __webpack_require__) {

	var AWS = __webpack_require__(22);
	var _ = __webpack_require__(23);
	var util = __webpack_require__(24);
	var winston = __webpack_require__(4);
	var CircularJSON = __webpack_require__(25);
	var backoff = __webpack_require__(26);

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
/* 22 */
/***/ function(module, exports) {

	module.exports = require("aws-sdk");

/***/ },
/* 23 */
/***/ function(module, exports) {

	module.exports = require(undefined);

/***/ },
/* 24 */
/***/ function(module, exports) {

	module.exports = require("util");

/***/ },
/* 25 */
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
/* 26 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var Backoff = __webpack_require__(27);
	var ExponentialBackoffStrategy = __webpack_require__(32);
	var FibonacciBackoffStrategy = __webpack_require__(34);
	var FunctionCall = __webpack_require__(35);

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
/* 27 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var events = __webpack_require__(28);
	var precond = __webpack_require__(29);
	var util = __webpack_require__(24);

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
/* 28 */
/***/ function(module, exports) {

	module.exports = require("events");

/***/ },
/* 29 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * Copyright (c) 2012 Mathieu Turcotte
	 * Licensed under the MIT license.
	 */

	module.exports = __webpack_require__(30);

/***/ },
/* 30 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * Copyright (c) 2012 Mathieu Turcotte
	 * Licensed under the MIT license.
	 */

	var util = __webpack_require__(24);

	var errors = module.exports = __webpack_require__(31);

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
/* 31 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * Copyright (c) 2012 Mathieu Turcotte
	 * Licensed under the MIT license.
	 */

	var util = __webpack_require__(24);

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
/* 32 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var util = __webpack_require__(24);
	var precond = __webpack_require__(29);

	var BackoffStrategy = __webpack_require__(33);

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
/* 33 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var events = __webpack_require__(28);
	var util = __webpack_require__(24);

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
/* 34 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var util = __webpack_require__(24);

	var BackoffStrategy = __webpack_require__(33);

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
/* 35 */
/***/ function(module, exports, __webpack_require__) {

	//      Copyright (c) 2012 Mathieu Turcotte
	//      Licensed under the MIT license.

	var events = __webpack_require__(28);
	var precond = __webpack_require__(29);
	var util = __webpack_require__(24);

	var Backoff = __webpack_require__(27);
	var FibonacciBackoffStrategy = __webpack_require__(34);

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


/***/ }
/******/ ]);