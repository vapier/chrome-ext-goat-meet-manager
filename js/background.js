// Copyright 2021 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Background script coordinating all meeting state & user events.
 * @suppress {moduleLoad} closure-compiler is buggy.
 */

import * as logging from './logging.js';

const homepageUrl = 'https://github.com/vapier/chrome-ext-goat-meet-manager';
const issuesUrl = `${homepageUrl}/issues`;

/** @type {boolean} User pref for automatically focusing meetings. */
let autofocus;

/** @type {string} Action button behavior. */
let actionButtonBehavior;

/**
 * Container for all the meetings we're tracking.
 *
 * Used whenever we want to operate on the overall meeting state (which is what
 * most things want to do).
 */
class Meetings {
  constructor() {
    /** @private {number} Unique per-meeting id. */
    this.nextId = 0;
    /** @const {!Map<number, !Meeting>} All the meetings we track. */
    this.meetings = new Map();
  }

  /**
   * @return {number} How many meetings exist.
   */
  get size() {
    return this.meetings.size;
  }

  /**
   * Add a meeting to our set.
   *
   * @param {!Meeting} meeting The meeting to add.
   */
  add(meeting) {
    meeting.id = this.nextId++;
    this.meetings.set(meeting.id, meeting);
    badge.update();
  }

  /**
   * Remove a meeting from our set.
   *
   * @param {!Meeting} meeting The meeting to remove.
   */
  remove(meeting) {
    this.meetings.delete(meeting.id);
    badge.update();
  }

  /**
   * Get a meeting by a specific id (the internal counter).
   *
   * @param {number} id The meeting to get.
   * @return {!Meeting|undefined} The meeting if it exists.
   */
  get(id) {
    return this.meetings.get(id);
  }

  /**
   * Get the meeting the user has marked as default/preferred.
   *
   * Up to one meeting may be marked as such at a time.
   *
   * @return {!Meeting|undefined}
   */
  get default() {
    let ret;
    this.meetings.forEach((meeting) => {
      if (meeting.prefer) {
        ret = meeting;
      }
    });
    return ret;
  }

  /**
   * Upate the user's default/preferred meeting.
   *
   * Up to one meeting may be marked as such at a time.  If a different meeting
   * is marked as the default, it will be cleared automatically.  This can be
   * used to clear the current preference too (so no meeting is the default).
   *
   * @param {number} id The (internal) meeting id.
   * @param {boolean=} value How to mark the meeting's preferred state.
   */
  setDefault(id, value = true) {
    this.meetings.forEach((meeting) => {
      if (meeting.id === id) {
        meeting.prefer = value;
      } else if (value && meeting.prefer) {
        meeting.prefer = false;
      }
    });
    badge.update();
  }

  /**
   * Find a meeting associated with a specific tab.
   *
   * @param {!Object} param The tab settings.
   * @return {!Meeting|undefined} The meeting if one exists.
   */
  find({tabId, windowId}) {
    let ret;
    this.meetings.forEach((meeting) => {
      const tab = meeting.port.sender.tab;
      if (tab.id === tabId && tab.windowId === windowId) {
        ret = meeting;
      }
    });
    return ret;
  }

  /**
   * Iterate over the meetings based on our algorithm.
   *
   * If a meeting has been marked default, then only process that one.
   * If no meetings are active (been joined), then process all meetings.
   * Else, process all active meetings.
   *
   * For the first meeting processed, honor the user's autofocus pref.
   *
   * @private
   * @param {function(!Meeting)} callback
   */
  processMeetings_(callback) {
    const prefer = this.default;
    if (prefer) {
      prefer.autofocus();
      callback(prefer);
      return;
    }

    const numActive = this.numActive;
    let focused = false;
    this.meetings.forEach((meeting) => {
      if (numActive === 0 || meeting.active) {
        if (focused === false) {
          focused = true;
          meeting.autofocus();
        }
        callback(meeting);
      }
    });
  }

  /**
   * Toggle mic/cam settings across meetings.
   *
   * @param {!Object} data Which settings to change.
   */
  toggle(data = {audio: true}) {
    this.processMeetings_((meeting) => meeting.toggle(data));
  }

  /**
   * Mute mic/cam settings across meetings.
   *
   * @param {!Object} data Which settings to change.
   */
  mute(data = {audio: true}) {
    this.processMeetings_((meeting) => meeting.mute(data));
  }

  /**
   * Unmute mic/cam settings across meetings.
   *
   * @param {!Object} data Which settings to change.
   */
  unmute(data = {audio: true}) {
    this.processMeetings_((meeting) => meeting.unmute(data));
  }

  /**
   * Focus the active meeting if the user prefs want it.
   */
  autofocus() {
    if (autofocus) {
      this.focus();
    }
  }

  /**
   * Focus the active meeting.
   */
  focus() {
    // NB: Some logic is duplicated in processMeetings_ resulting in us calling
    // focus on the same tab twice in a row, but that should be fine.
    let focused = false;
    this.processMeetings_((meeting) => {
      if (focused === false) {
        focused = true;
        meeting.focus();
      }
    });
  }

  /**
   * Helper for counting truthy fields of meeting objects.
   *
   * @param {string} property The field to check.
   * @return {number}
   * @private
   */
  countMeetings_(property) {
    let ret = 0;
    this.meetings.forEach((meeting) => {
      ret += meeting[property] ? 1 : 0;
    });
    return ret;
  }

  /**
   * @return {number} How many meetings are active (joined).
   */
  get numActive() {
    return this.countMeetings_('active');
  }

  /**
   * @return {number} How many meetings have audio muted.
   */
  get numAudioMuted() {
    return this.countMeetings_('audioMuted');
  }

  /**
   * @return {number} How many meetings have video muted.
   */
  get numVideoMuted() {
    return this.countMeetings_('videoMuted');
  }

  /**
   * @return {!Symbol} The high level state for the badge.
   */
  get state() {
    if (this.size === 0) {
      return Meetings.INACTIVE;
    }

    return this.numAudioMuted === this.size ? Meetings.MUTED : Meetings.UNMUTED;
  }

  /**
   * @return {!Symbol} The high level summary text for the badge.
   */
  get summary() {
    const size = this.size;
    const numAudioMuted = this.numAudioMuted;
    const numVideoMuted = this.numVideoMuted;
    if (size === 0) {
      return 'No meetings found. Please reload Google Meet pages to connect.';
    } else if (size === numAudioMuted) {
      return `All meetings are muted.`;
    } else if (numAudioMuted === 0) {
      return `No meetings are muted.`;
    } else {
      return `${size} active meetings; ${numAudioMuted} are muted.`;
    }
  }
}

Meetings.INACTIVE = Symbol('inactive');
Meetings.MUTED = Symbol('muted');
Meetings.UNMUTED = Symbol('unmuted');

/**
 * Container for a single meeting.
 */
class Meeting {
  constructor(port) {
    this.id = null;
    this.title = null;
    this.port = port;
    this.active = false;
    this.prefer = false;
    this.audioMuted = null;
    this.videoMuted = null;
  }

  bind() {
    meetings.add(this);

    this.port.onDisconnect.addListener(this.disconnect.bind(this));
    this.port.onMessage.addListener(this.recv.bind(this));
  }

  disconnect() {
    logging.debug('disconnect', this.port);
    meetings.remove(this);
  }

  toggle(data = {audio: true}) {
    this.send('toggle', data);
  }

  mute(data = {audio: true}) {
    this.send('mute', data);
  }

  unmute(data = {audio: true}) {
    this.send('unmute', data);
  }

  /**
   * Focus the active meeting if the user prefs want it.
   */
  autofocus() {
    if (autofocus) {
      this.focus();
    }
  }

  focus() {
    // NB: We can't rely on the port->sender details as they don't stay in
    // sync with the actual tab (like the index field).  So query the latest
    // state here to access it.
    chrome.tabs.get(this.port.sender.tab.id, (tab) => {
      chrome.windows.update(tab.windowId, {focused: true});
      chrome.tabs.highlight({tabs: tab.index, windowId: tab.windowId});
    });
  }

  send(command, data = {}) {
    const message = Object.assign({}, data, {command});
    this.port.postMessage(message);
  }

  /**
   * Invoked when a message came across the port.
   *
   * @see https://developer.chrome.com/extensions/runtime/#event-onMessage
   * @param {!Object} message
   * @private
   */
  recv(message) {
    logging.debug('recv', this.port, message);
    const {command} = message;
    const handler = this.commands.get(command);
    if (handler) {
      logging.debug(`dispatching to ${command}`, message);
      handler.call(this, message);
    } else {
      logging.warn(`${this.port.name}: unknown command '${command}'`, message);
    }
  }

  /**
   * The page wants to log stuff.
   *
   * @param {string} message The log message
   */
  message_log(message) {
    logging.recordLog(message);
  }

  /**
   * The user has joined the meeting, so it is now active.
   */
  message_joined() {
    this.active = true;
    badge.update();
  }

  /**
   * Update meeting info we care about.
   *
   * @param {!Object} param The new mic/cam settings.
   */
  message_update({title, audioMuted, videoMuted}) {
    if (title) {
      this.title = title.replace(/^Meet - /, '');
    }

    const update =
      this.audioMuted !== audioMuted || this.videoMuted !== videoMuted;
    this.audioMuted = audioMuted;
    this.videoMuted = videoMuted;
    // Debounce updates due to possible duplicate notifications.
    if (update) {
      badge.update();
    }
  }
}

// Build up a map of available messages for easier access later.
Meeting.prototype.commands = new Map();
Object.getOwnPropertyNames(Meeting.prototype).forEach((name) => {
  if (name.startsWith('message_')) {
    Meeting.prototype.commands.set(name.substr(8), Meeting.prototype[name]);
  }
});

/**
 * Callback when a foreground page sends us a message.
 *
 * This is used for all our custom pages, *not* the injected meetings pages.
 * Injected meetings route through the Meeting class (and its message_* APIs).
 *
 * @param {!Port} port The port the message came via.
 * @param {!Object} message The message!
 */
function onInternalPageMessage(port, message) {
  logging.debug('onInternalPageMessage', message);
  const {command} = message;
  switch (command) {
    default:
      logging.warn(`${port.name}: unknown command '${command}'`, message);
      break;

    case 'list': {
      const result = [];
      meetings.meetings.forEach((meeting) => {
        result.push({
          id: meeting.id,
          name: meeting.port.name,
          title: meeting.title,
          prefer: meeting.prefer,
          active: meeting.active,
          audioMuted: meeting.audioMuted,
          videoMuted: meeting.videoMuted,
        });
      });
      port.postMessage({command, meetings: result});
      break;
    }

    case 'default':
      meetings.setDefault(message.id, message.prefer);
      break;

    case 'focus': {
      const meeting = meetings.get(message.id);
      if (meeting) {
        meeting.focus();
      }
      break;
    }

    case 'toggle': {
      const meeting = meetings.get(message.id);
      if (meeting) {
        meeting.toggle(message);
      }
      break;
    }

    case 'log':
      logging.recordLog(message);
      break;

    case 'get-log':
      port.postMessage({command, log: logging.getLog().join('\n')});
      break;
  }
}

function onPopupDisconnect(port) {
  logging.debug('onPopupDisconnect');
  badge.popup = null;
}

/**
 * Invoked when internal code calls chrome.runtime.connect.
 *
 * @see https://developer.chrome.com/extensions/runtime#event-onConnect.
 * @param {!Port} port The new communication channel.
 * @private
 */
function onConnect(port) {
  logging.debug('onConnect', port);

  switch (port.name) {
    case 'control':
      logging.debug('connection from popup');
      logging.assert(port.sender.tab === undefined);
      port.onMessage.addListener(onInternalPageMessage.bind(this, port));
      port.onDisconnect.addListener(onPopupDisconnect.bind(this, port));
      badge.popup = port;
      break;

    case 'options':
      logging.debug('connection from options');
      port.onMessage.addListener(onInternalPageMessage.bind(this, port));
      break;

    default: {
      logging.debug('connection from new meeting');
      const meeting = new Meeting(port);
      meeting.bind();
      badge.update();
    }
  }
}

/**
 * Invoked when user clicks the extension icon.
 *
 * @see https://developer.chrome.com/extensions/browserAction/#event-onClicked
 * @param {!Tab} tab The active tab.
 * @private
 */
function onActionClicked(tab) {
  logging.debug('onActionClicked', tab);

  const meeting = meetings.find({tabId: tab.id, windowId: tab.windowId});

  switch (actionButtonBehavior) {
    case 'popup':
      // Shouldn't happen here ...
      return;

    default:
      logging.warn(`Unknown action behavior '${actionButtonBehavior}'`);

    case 'toggle-audio+popup':
    case 'toggle-audio':
      if (meeting) {
        meeting.toggle();
      } else {
        meetings.toggle();
      }
      break;

    case 'mute-audio+popup':
    case 'mute-audio':
      if (meeting) {
        meeting.mute();
      } else {
        meetings.mute();
      }
      break;

    case 'focus+popup':
    case 'focus':
      if (meeting) {
        meeting.focus();
      } else {
        meetings.focus();
      }
      break;
  }
}

/**
 * Invoked when user invokes a bound command (e.g. keyboard shortcut).
 *
 * @see https://developer.chrome.com/extensions/commands#event-onCommand
 * @param {string} command The command to run.
 * @param {!Tab} tab The active tab.
 * @private
 */
function onCommand(command, tab) {
  logging.debug('onCommand', command, tab);

  switch (command) {
    default:
      logging.error(`unknown command '${command}'`);
      break;

    case 'focus':
      meetings.focus();
      break;

    case 'mute-audio':
      meetings.mute({audio: true});
      break;
    case 'unmute-audio':
      meetings.unmute({audio: true});
      break;
    case 'toggle-mute-audio':
      meetings.toggle({audio: true});
      break;
    case 'mute-both':
      meetings.mute({audio: true, video: true});
      break;
    case 'unmute-both':
      meetings.unmute({audio: true, video: true});
      break;
    case 'toggle-mute-both':
      meetings.toggle({audio: true, video: true});
      break;
    case 'mute-video':
      meetings.mute({video: true});
      break;
    case 'unmute-video':
      meetings.unmute({video: true});
      break;
    case 'toggle-mute-video':
      meetings.toggle({video: true});
      break;
  }
}

/**
 * Invoked when storage changes.
 *
 * @see https://developer.chrome.com/extensions/storage#event-onChanged
 * @param {!StorageChanges} changes
 * @private
 */
function onStorageChanged(changes) {
  logging.debug('onStorageChanged');

  for (const [key, change] of Object.entries(changes)) {
    logging.debug(
      `storage '${key}' changed '${change.oldValue}' -> '${change.newValue}'`,
    );

    switch (key) {
      case 'debug':
        logging.setDebug(!!change.newValue);
        logging.info(`debug changed to ${change.newValue}`);
        break;

      case 'autofocus':
        autofocus = !!change.newValue;
        break;

      case 'action-behavior':
        actionButtonBehavior = change.newValue;
        break;
    }
  }

  badge.update();
}

/**
 * Invoked when storage is fetched.
 *
 * @see https://developer.chrome.com/extensions/storage#get
 * @param {!Object} settings All the user settings that exist.
 * @private
 */
function initSettings(settings) {
  logging.init({page: 'background', debug: !!settings['debug']});
  autofocus = !!settings['autofocus'];
  actionButtonBehavior = settings['action-behavior'];
}

/**
 * Class for managing the extension badge state.
 */
class Badge {
  constructor() {
    this.popup = null;
  }

  /**
   * Helper to call all the relevant badge extension APIs.
   *
   * @param {!Object} settings The badge settings.
   */
  set({icon, title, popup, text, color}) {
    if (icon !== undefined) {
      if (typeof icon === 'string') {
        icon = {19: `../images/${icon}-96.png`};
      }
      chrome.browserAction.setIcon({path: icon});
    }
    if (title !== undefined) {
      chrome.browserAction.setTitle({title});
    }
    if (popup !== undefined) {
      chrome.browserAction.setPopup({popup});
    }
    if (text !== undefined) {
      chrome.browserAction.setBadgeText({text});
    }
    if (color !== undefined) {
      chrome.browserAction.setBadgeBackgroundColor({color});
    }
  }

  /**
   * The popup action based on user prefs & meeting states.
   *
   * @return {string} The popup URL to use.
   */
  get popupAction() {
    const popup = 'html/control.html';
    switch (actionButtonBehavior) {
      case 'popup':
        return popup;

      default:
        logging.warn(`Unknown action behavior '${actionButtonBehavior}'`);

      case 'toggle-audio+popup':
      case 'focus+popup':
      case 'mute-audio+popup':
        if (meetings.default) {
          return '';
        } else if (
          meetings.numActive > 1 ||
          (meetings.numActive == 0 && meetings.size > 1)
        ) {
          return popup;
        }
        return '';

      case 'toggle-audio':
      case 'focus':
      case 'mute-audio':
        return '';
    }
  }

  /**
   * Update the badge icon/text/etc... based on current meetings state.
   */
  update() {
    // If a popup is connected, fake a refresh request.
    if (this.popup) {
      onInternalPageMessage(this.popup, {command: 'list'});
    }

    const state = meetings.state;
    const size = meetings.size;
    const summary = meetings.summary;

    switch (state) {
      default:
        logging.error(`unable to update to unknown badge state '${state}'`);
        break;

      case Meetings.INACTIVE:
        this.set({
          icon: 'inactive',
          title: summary,
          popup: 'html/inactive.html',
          text: '',
        });
        break;

      case Meetings.UNMUTED: {
        const numMuted = meetings.numAudioMuted;
        const text = numMuted === 0 ? `${size}` : `${numMuted}/${size}`;
        this.set({
          icon: 'mic-on',
          title: summary,
          popup: this.popupAction,
          text: text,
          color: '#219653',
        });
        break;
      }

      case Meetings.MUTED:
        this.set({
          icon: 'mic-off',
          title: summary,
          popup: this.popupAction,
          text: `${size}`,
          color: '#d92f25',
        });
        break;
    }
  }
}

/**
 * Callback from context menu clicks.
 *
 * @param {!Object} info The item clicked.
 * @param {!Tab=} tab When relevant, the active tab.
 */
function onContextMenu(info, tab = undefined) {
  switch (info.menuItemId) {
    default:
      logging.error('Unknown menu item', info);
      break;

    case 'focus':
      meetings.focus();
      break;

    case 'clear-default': {
      const meeting = meetings.default;
      if (meeting) {
        meeting.prefer = false;
        badge.update();
      }
      break;
    }

    case 'feedback':
      window.open(issuesUrl, '_blank', 'noreferrer,noopener');
      break;

    case 'cws': {
      const url = `https://chrome.google.com/webstore/detail/${chrome.runtime.id}/reviews`;
      window.open(url, '_blank', 'noreferrer,noopener');
      break;
    }
  }
}

function initContextMenus() {
  // Remove any previous entries.  This comes up when reloading the page.
  chrome.contextMenus.removeAll();

  chrome.contextMenus.onClicked.addListener(onContextMenu);

  /** @type {!Array<!chrome.contextMenus.CreateProperties>} */
  const entries = [
    {
      type: 'normal',
      id: 'focus',
      title: 'Focus active meeting',
      contexts: ['browser_action'],
    },
    {
      type: 'normal',
      id: 'clear-default',
      title: 'Clear default selection',
      contexts: ['browser_action'],
    },
    {
      type: 'normal',
      id: 'feedback',
      title: 'Report an issue',
      contexts: ['browser_action'],
    },
    {
      type: 'normal',
      id: 'cws',
      title: 'CWS Reviews',
      contexts: ['browser_action'],
    },
  ];
  entries.forEach((entry) => chrome.contextMenus.create(entry));
}

const badge = new Badge();
const meetings = new Meetings();
// Export for debugging.
globalThis.badge = badge;
globalThis.meetings = meetings;

function init() {
  badge.update();
  chrome.runtime.onConnect.addListener(onConnect);
  chrome.browserAction.onClicked.addListener(onActionClicked);
  chrome.commands.onCommand.addListener(onCommand);
  initContextMenus();
  chrome.storage.sync.onChanged.addListener(onStorageChanged);
}

window.addEventListener('error', (e) => {
  logging.error('unhandled error', e.error.stack);
});
chrome.storage.sync.get((settings) => {
  initSettings(settings);
  init();
});
