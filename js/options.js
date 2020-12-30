// Copyright 2021 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Code for the options page.
 * @suppress {moduleLoad} closure-compiler is buggy.
 */

import * as logging from './logging.js';

/** @const {!Array<string>} The prefs we bind to storage & UI. */
const allKeys = [
  'action-behavior',
  'autofocus',
  'debug',
  'default-mute-audio',
  'default-mute-video',
];
/** @type {!Map<string, !Node>} Map between user pref & UI element. */
const elements = new Map();

/**
 * Helper to briefly display a short message to the user.
 *
 * Mostly used to show the "Saved" notification.
 *
 * @param {string} msg The message to show.
 * @param {number} timeout How long (in msec) to display the message.
 */
function banner(msg, timeout = 3000) {
  const status = document.getElementById('status');
  status.innerText = msg;
  if (banner.clear) {
    clearTimeout(banner.clear);
  }
  banner.clear = setTimeout(() => {
    status.innerText = '';
    banner.clear = null;
  }, timeout);
}

/**
 * Callback whenever the user makes any change.
 *
 * Automatically bundle up all the settings & save them.  This avoids a separate
 * "Save" button the user has to remember to click.
 */
function save() {
  const settings = {};
  elements.forEach((e, key) => {
    if (e.checked !== undefined) {
      settings[key] = e.checked;
    } else {
      settings[key] = e.value;
    }
  });
  chrome.storage.sync.set(settings, () => banner('Saved!'));
}

/**
 * Invoked when storage is fetched.
 *
 * @see https://developer.chrome.com/extensions/storage#get
 * @param {!Object} settings All the user settings that exist.
 * @private
 */
function initSettings(settings) {
  logging.init({page: 'options', port, debug: !!settings['debug']});
  logging.getLog();

  for (const [key, setting] of Object.entries(settings)) {
    const e = elements.get(key);
    if (!e) {
      logging.warn(`Unknown setting '${key}'`);
      continue;
    }

    if (e.checked !== undefined) {
      e.checked = setting;
    } else {
      e.value = setting;
    }
  }

  banner('', 0);
}

/**
 * Callback when the user clicks the 'keyboard shortcuts' link.
 *
 * Chrome disallows <a> links to chrome:// URLs so we have to hack it.
 *
 * @param {!Event} event The user click.
 */
function shortcutsOnClick(event) {
  event.preventDefault();
  chrome.tabs.update({url: 'chrome://extensions/shortcuts'});
}

/**
 * Callback when the user clicks the 'export logs' link.
 *
 * Automatically kick off a lazy refresh.  Just in case new stuff came in.
 * The current click might not get it, but the next one should.
 */
function onLogClick() {
  logging.getLog();
}

/**
 * Callback when the background page sends us a message.
 *
 * @param {!Object} message The message!
 */
function onMessage(message) {
  const {command} = message;
  switch (command) {
    default:
      logging.warn(`${port.name}: unknown command '${command}'`, message);
      break;

    case 'get-log': {
      const logLink = document.getElementById('log-download');
      if (logLink.href.startsWith('blob:')) {
        URL.revokeObjectURL(logLink.href);
      }
      logLink.href = URL.createObjectURL(new Blob([message.log]));
      break;
    }
  }
}

/**
 * Initialize the options page.
 */
function init() {
  allKeys.forEach((key) => {
    const e = document.getElementById(key);
    elements.set(key, e);
    e.addEventListener('change', save);
  });

  const shortcutsLink = document.getElementById('shortcuts');
  shortcutsLink.onclick = shortcutsOnClick;

  const onLogLink = document.getElementById('log-download');
  onLogLink.onclick = onLogClick;
}

/**
 * Helper to send a message to the background page.
 *
 * @param {string} command The command to send.
 * @param {!Object=} data The command arguments.
 */
function postMessage(command, data = {}) {
  const message = Object.assign({}, data, {command});
  port.postMessage(message);
}

/** @const {!Port} The connection to the background page. */
const port = chrome.runtime.connect({name: 'options'});
port.onMessage.addListener(onMessage);

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('error', (e) => {
  logging.error('unhandled error', e.error.stack);
});
chrome.storage.sync.get(initSettings);
