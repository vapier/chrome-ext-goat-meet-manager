// Copyright 2021 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Common logging routines.  Provides consistent APIs while hiding
 *     the backend details: all logs are held by the background page while all
 *     others send their logs to the background.  All log entries are kept in
 *     memory to simplify: if there are no active foreground pages, then there
 *     probably aren't interesting logs, so let them all expire when Chrome
 *     automatically unloads the background page.
 */

/** @type {boolean} Whether to log debug messages. */
let debugEnabled = false;

/** @type {?Port} Connection to the background page. */
let port;

/** @type {string} The page that we're logging for. */
let page;

/** @type {!Array<string>} Log entries (for the background page). */
const entries = [];

/** @param {!Object} settings The log module settings. */
export function init(settings) {
  page = settings.page;
  port = settings.port;
  debugEnabled = settings.debug;
}

/** @param {boolean} enabled Update the debug preference. */
export function setDebug(enabled) {
  // If users toggle the debug settings, clear the history in the background
  // page in case there was a lot there.  It can suck up memory resoures if
  // there a lot.
  if (!enabled) {
    console.clear();
  }
  debugEnabled = enabled;
}

const DEBUG = Symbol('debug');
const INFO = Symbol('info');
const WARN = Symbol('warn');
const ERROR = Symbol('error');

/**
 * Save a log entry to the record.
 *
 * Only used by the background page.
 *
 * @param {!Object} log The new record to log.
 */
export function recordLog({page, level, message}) {
  const entry = `${new Date().toISOString()}: ${page}: ${level}: ${message}`;
  // Hack to make live debugging easier.
  if (debugEnabled) {
    console.log(entry);
  }
  entries.push(entry);
}

/**
 * Log a message.
 *
 * The background page processes directly.  Non-background pages send messages
 * to the background page to log.
 *
 * @param {!Symbol} level The log level.
 * @param {...any} args
 */
function log_(level, ...args) {
  const message = args.join(' ');
  if (port) {
    // Send message to background page.
    port.postMessage({command: 'log', page, level: level.description, message});
  } else {
    // We are the background page, so remember the log.
    recordLog({page, level: level.description, message});
  }
}

/**
 * Log a debug message like console.debug().
 *
 * @param {...any} args
 */
export function debug(...args) {
  if (!debugEnabled) {
    return;
  }

  log_(DEBUG, ...args);
}

/**
 * Log an info message like console.info().
 *
 * @param {...any} args
 */
export function info(...args) {
  log_(INFO, ...args);
}

/**
 * Alias to info like console.log().
 *
 * @param {...any} args
 */
export function log(...args) {
  log_(INFO, ...args);
}

/**
 * Log a warning like console.warn().
 *
 * @param {...any} args
 */
export function warn(...args) {
  log_(WARN, ...args);
}

/**
 * Log an error like console.error().
 *
 * @param {...any} args
 */
export function error(...args) {
  log_(ERROR, ...args);
}

/**
 * Return the current call stack after skipping a given number of frames.
 *
 * @param {number=} ignoreFrames How many inner stack frames to ignore.  The
 *     innermost 'getStack' call is always ignored.
 * @param {number=} count How many frames to return.
 * @return {!Array<string>} The stack frames.
 */
function getStack(ignoreFrames = 0, count = undefined) {
  const stackArray = new Error().stack.split('\n');

  // Always ignore the Error() object and getStack call itself.
  // [0] = 'Error'
  // [1] = '    at Object.lib.f.getStack (file:///.../lib_f.js:267:23)'
  ignoreFrames += 2;

  const max = stackArray.length - ignoreFrames;
  if (count === undefined) {
    count = max;
  } else if (count < 0) {
    count = 0;
  } else if (count > max) {
    count = max;
  }

  // Remove the leading spaces and "at" from each line:
  // '    at window.onload (file:///.../lib_test.js:11:18)'
  const stackObject = new Array();
  for (let i = ignoreFrames; i < count + ignoreFrames; ++i) {
    stackObject.push(stackArray[i].replace(/^\s*at\s+/, ''));
  }

  return stackObject;
}

/**
 * Assert a condition, else log an error.  Like console.assert().
 *
 * @param {boolean} condition The thing that should be true normally.
 * @param {...any} args
 */
export function assert(condition, ...args) {
  if (!condition) {
    error('assert failed', ...args, getStack());
  }
}

/** @return {!Array<string>} The log data. */
export function getLog() {
  if (port) {
    // The page should have a handler to deal with this.
    port.postMessage({command: 'get-log'});
  } else {
    return entries;
  }
}
