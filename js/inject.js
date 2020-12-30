// Copyright 2021 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Content script injected into every Google Meet tab.
 */

// NB: Cannot use import in injected pages :(.

'use strict';

/** @type {boolean} Whether to log debug messages. */
let debugEnabled;

/** @type {boolean} Whether user wants to mute audio by default. */
let defaultMuteAudio;

/** @type {boolean} Whether user wants to mute video by default. */
let defaultMuteVideo;

/**
 * Log a message.
 *
 * This will send to the background page for overall tracking.
 *
 * @param {string} level The log level to use: debug, info, warn, error.
 * @param {...any} args
 */
function log(level, ...args) {
  if (debugEnabled) {
    console.log(...args);
  }

  connection.send('log', {page: 'inject', level, message: args.join(' ')});
}

/**
 * Log a debug message.
 *
 * @param {...any} args
 */
function dbg(...args) {
  if (!debugEnabled) {
    return;
  }

  log('debug', ...args);
}

// Matches both microphone & video buttons.
const buttonSelector = '.U26fgb.JRY2Pb.mUbCce.kpROve.uJNmj';
// Matches only the hangup button.
const hangupSelector = '.U26fgb.JRY2Pb.mUbCce.kpROve.GaONte';
// Matches the internal state of the buttons (mute/etc...).
const stateSelector = '.IYwVEf.nAZzG';

/** @return {?Node} The Node for controlling the microphone. */
function getAudioElement() {
  return document.querySelectorAll(buttonSelector)[0];
}

/** @return {?Node} The Node for monitoring the microphone state. */
function getAudioTracker() {
  return getAudioElement()?.querySelector(stateSelector);
}

/** @return {?Node} The Node for controlling the camera. */
function getVideoElement() {
  return document.querySelectorAll(buttonSelector)[1];
}

/** @return {?Node} The Node for monitoring the camera state. */
function getVideoTracker() {
  return getVideoElement()?.querySelector(stateSelector);
}

/** @return {?Node} The Node for leaving the meeting. */
function getHangupElement() {
  return document.querySelector(hangupSelector);
}

/**
 * Toggle the mic/cam.
 *
 * @param {!Object} param Which settings to change.
 */
function commandToggle({audio, video}) {
  function act(ele) {
    ele.click();
  }

  if (audio) {
    act(getAudioElement());
  }
  if (video) {
    act(getVideoElement());
  }
}

/**
 * Mute the mic/cam.
 *
 * @param {!Object} param Which settings to change.
 */
function commandMute({audio, video}) {
  function act(ele) {
    if (ele.dataset.isMuted !== 'true') {
      ele.click();
    }
  }

  if (audio) {
    act(getAudioElement());
  }
  if (video) {
    act(getVideoElement());
  }
}

/**
 * Unmute the mic/cam.
 *
 * @param {!Object} param Which settings to change.
 */
function commandUnmute({audio, video}) {
  function act(ele) {
    if (ele.dataset.isMuted === 'true') {
      ele.click();
    }
  }

  if (audio) {
    act(getAudioElement());
  }
  if (video) {
    act(getVideoElement());
  }
}

/**
 * @const {!Map<string, function(!Object)} The valid set of commands.
 */
const commands = new Map([
  ['mute', commandMute],
  ['toggle', commandToggle],
  ['unmute', commandUnmute],
]);

/**
 * Callback when a message comes across the port (from the background page).
 *
 * This will dispatch to the command map.
 *
 * @param {!Object} message The message details.
 */
function onMessage(message) {
  const {command} = message;
  const handler = commands.get(command);
  if (handler) {
    dbg(`dispatching to ${command}`, message);
    handler.call(this, message);
  } else {
    console.warn(`unknown command '${command}'`, message);
  }
}

/**
 * Monitor the mic/cam for status changes.
 *
 * This fires when the user changes things, or we send messages to do it.
 * We always use the live state rather than attempting to mirror our own.
 *
 * @param {!Array<!MutationRecord>} mutations The DOM changes.
 * @param {!MutationObserver} observer The observer tracking changes for us.
 */
function onMutations(mutations, observer) {
  dbg('onMutations', mutations);

  // Always try to mute once.  Google Meet will start up with things muted by
  // default until it finishes detecting the hardware.  Our init logic will
  // find the DOM nodes faster & attempt to set the default once, but then the
  // Google Meet code runs after and unmutes on us.  This hack should be good
  // enough to handle the common/slow scenarios.
  if (defaultMuteAudio || defaultMuteVideo) {
    defaultMuteMeeting();
  }

  const audio = getAudioElement();
  const video = getVideoElement();
  connection.send('update', {
    audioMuted: audio.dataset.isMuted === 'true',
    videoMuted: video.dataset.isMuted === 'true',
  });
}

/**
 * Class to handle the life cycle of the connection to the background page.
 */
class Connection {
  constructor() {
    this.port = null;
  }

  /**
   * Create a new connection to the background page.
   */
  connect() {
    this.port = chrome.runtime.connect({name: document.location.pathname});
    dbg('connected', this.port);

    this.port.onMessage.addListener(onMessage);
    this.port.onDisconnect.addListener(this.reconnect.bind(this));
  }

  /**
   * Break the connection to the background page.
   */
  disconnect() {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
  }

  /**
   * Try to reconnect to the background page.
   *
   * NB: This is a bit optimistic.  Chrome doesn't seem to allow this.
   */
  reconnect() {
    dbg('disconnected ...');
    this.disconnect();
    this.connect();
  }

  /**
   * Helper to send a message to the background page.
   *
   * @param {string} command The command to send.
   * @param {!Object=} data The command arguments.
   */
  send(command, data = {}) {
    const message = Object.assign({}, data, {command});
    this.port.postMessage(message);
  }
}

/**
 * Display a message on top of the specified node.
 *
 * This is largely used to display a notification when we automatically mute
 * the mic/cam by default, but it could be used for other things ...
 *
 * @param {!Node} parent The container element.
 * @param {string|!Node} message The message to display.
 */
async function showPopup(parent, message) {
  // If it's a string, create a simple span node to wrap it up.
  // This allows us to set the whitespace settings.
  if (typeof message === 'string') {
    const span = document.createElement('span');
    span.textContent = message;
    span.style.whiteSpace = 'pre-wrap';
    message = span;
  }

  /** @const {!Node} Container for the message. */
  const node = parent.ownerDocument.createElement('div');
  node.appendChild(message);
  node.style.fontFamily = '"Google Sans", Roboto, sans-serif';
  node.style.position = 'absolute';
  node.style.color = 'white';
  node.style.fontSize = 'larger';
  node.style.fontWeight = 'bold';
  node.style.textShadow = '1px 1px black';

  // We have to hack the parent as its overflow settings clip our message.
  const oldOverflow = parent.style.overflow;
  parent.style.overflow = 'visible';

  // Show the message for a brief time.
  // NB: Need to delay a little to give the overflow time to readjust.
  setTimeout(() => {
    parent.appendChild(node);
    setTimeout(() => {
      parent.style.overflow = oldOverflow;
      node.remove();
    }, 2000);
  }, 500);
}

/** @const */
const connection = new Connection();
connection.connect();
// Export for debugging.
globalThis.connection = connection;

/** @type {?MutationObserver} Observe changes to mute settings. */
let observer;

/**
 * Process user's default mute settings.
 */
function defaultMuteMeeting() {
  if (defaultMuteAudio) {
    const audio = getAudioElement();
    if (audio.dataset.isMuted !== 'true') {
      audio.click();
      showPopup(audio, 'Audio\nmuted\nby\ndefault');
      // Since we only need to do this once at startup, clear the pref.
      // This way we can call this func multiple times.
      defaultMuteAudio = false;
    }
  }

  if (defaultMuteVideo) {
    const video = getVideoElement();
    if (video.dataset.isMuted !== 'true') {
      video.click();
      showPopup(video, 'Video\nmuted\nby\ndefault');
      // Since we only need to do this once at startup, clear the pref.
      // This way we can call this func multiple times.
      defaultMuteVideo = false;
    }
  }
}

/**
 * Wait for the mic/cam mute buttons to show up for us to hook.
 */
async function init() {
  let audio, video, aState, vState;

  // Wait for all the mic/cam elements to show up.
  while (true) {
    audio = getAudioElement();
    video = getVideoElement();
    aState = getAudioTracker();
    vState = getVideoTracker();

    dbg('init', audio?.dataset, video?.dataset, aState, vState);

    if (audio && video && aState && vState) {
      break;
    }

    dbg('retrying init ...');
    // If the system is slow, don't hammer it trying to get access to the
    // elements as fast as possible.  1 second seems like a reasonable balance
    // for responsiveness in the extension icon.  Even on fast systems, Meet
    // can take 1 or 2 seconds to load.  We don't go lower as background tabs
    // get slowed down significantly regardless of the system performance.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Send an initial update to the background page of the meeting state.
  connection.send('update', {
    audioMuted: audio.dataset.isMuted === 'true',
    videoMuted: video.dataset.isMuted === 'true',
  });

  // When reiniting, clean up previous observer.
  if (observer) {
    observer.disconnect();
  }
  // Watch for changes to the mic/cam to notify the background page.
  observer = new MutationObserver(onMutations);
  observer.observe(aState, {attributes: true});
  observer.observe(vState, {attributes: true});
}

/**
 * Overall main loop of the injected page.
 *
 * This will handle startup, pre-join idle, then joining, then disconnect.
 */
async function meetingLifeCycle() {
  /** @return {?Node} The main meeting node. */
  function getNode() {
    return document.querySelector('[data-allocation-index]');
  }

  // Wait for the meeting to initialize in general (before we join).
  await init();

  // Process default mute settings.
  defaultMuteMeeting();

  let nodeResolve, nodeReject;

  // Wait for the user to join the meeting.
  const startObserver = new MutationObserver((mutations, observer) => {
    // If the main node shows up, it means we joined the meeting.
    if (getNode()) {
      observer.disconnect();
      nodeResolve();
    }

    // If the user joined to present only, then stop monitoring it.
    // If the hangup button exists but not the mute buttons, assume that.
    if (getHangupElement() && !getAudioElement()) {
      dbg('user is only presenting -> disconnect');
      observer.disconnect();
      nodeReject();
    }
  });
  startObserver.observe(document.body, {childList: true, subtree: true});

  dbg('waiting for meeting start ...');
  await new Promise((resolve, reject) => {
    nodeResolve = resolve;
    nodeReject = reject;
  });

  connection.send('joined');

  // The buttons get recreated, so rebind them.
  await init();

  // Wait for the user to leave the meeting.
  const endObserver = new MutationObserver((mutations, observer) => {
    if (!getNode()) {
      dbg('meeting is over, cleaning up');
      observer.disconnect();
      nodeResolve();
    }
  });
  endObserver.observe(getNode().parentElement, {
    childList: true,
    subtree: true,
  });

  dbg('waiting for meeting end ...');
  await new Promise((resolve, reject) => {
    nodeResolve = resolve;
    nodeReject = reject;
  });
}

/**
 * Invoked when storage is fetched.
 *
 * @see https://developer.chrome.com/extensions/storage#get
 * @param {!Object} settings All the user settings that exist.
 * @private
 */
function initSettings(settings) {
  debugEnabled = !!settings['debug'];
  defaultMuteAudio = !!settings['default-mute-audio'];
  defaultMuteVideo = !!settings['default-mute-video'];
}

// If we crash horribly, log it at least.
window.addEventListener('error', (e) => {
  log('error', 'unhandled error', e.error.stack);
});

// Initial page startup: get user prefs, then kick off the lifecycle.
chrome.storage.sync.get(null, (settings) => {
  initSettings(settings);

  meetingLifeCycle()
    .catch((e) => {
      if (e) {
        console.warn('aborted', e);
      }
    })
    .finally(() => {
      // Tear everything down once we disconnect (or crash).
      if (observer) {
        observer.disconnect();
      }
      connection.disconnect();
    });
});
