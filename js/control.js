// Copyright 2021 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Code for the multiple meeting popup page.
 * @suppress {moduleLoad} closure-compiler is buggy.
 */

import * as logging from './logging.js';

/**
 * Callback when user selects a default meeting.
 *
 * @param {!Event} event The user click.
 */
function defaultOnClick(event) {
  const element = event.currentTarget;
  logging.debug('defaultOnClick', event);
  postMessage('default', {
    id: parseInt(element.id, 10),
    prefer: element.textContent === '☐',
  });
  element.textContent = element.textContent === '☐' ? '☑' : '☐';
  // Manually refresh as this is internal state.
  postMessage('list');
}

/**
 * Callback when user selects a meeting to focus.
 *
 * @param {!Event} event The user click.
 */
function focusOnClick(event) {
  const element = event.currentTarget;
  logging.debug('focusOnClick', event);
  postMessage('focus', {id: parseInt(element.id, 10)});
}

/**
 * Callback when user wants to toggle the microphone settings.
 *
 * @param {!Event} event The user click.
 */
function toggleAudioOnClick(event) {
  const element = event.currentTarget;
  logging.debug('muteAudioOnClick', event);
  postMessage('toggle', {id: parseInt(element.id, 10), audio: true});
  // Don't manually refresh as we'll wait for the pages to trigger updates.
}

/**
 * Callback when user wants to toggle the camera settings.
 *
 * @param {!Event} event The user click.
 */
function toggleVideoOnClick(event) {
  const element = event.currentTarget;
  logging.debug('muteVideoOnClick', event);
  postMessage('toggle', {id: parseInt(element.id, 10), video: true});
  // Don't manually refresh as we'll wait for the pages to trigger updates.
}

/**
 * Helper to create an image element for the mute/unmute status.
 *
 * @param {string} src The icon name.
 * @param {number} size How big the icon will be (square).
 * @return {!Node} The new image element.
 */
function newImg(src, size = 16) {
  const ret = document.createElement('img');
  ret.src = `../images/${src}.png`;
  ret.style.height = `${size}px`;
  return ret;
}

/**
 * Refresh the panel with the list of meetings.
 *
 * @param {!Array<!Object>} meetings Metadata about available meetings.
 */
function updateList(meetings) {
  logging.debug('updating list', meetings);
  const table = document.getElementById('meetings');
  const tbody = table.createTBody();

  // Clear out any previous tables of meetings as we have all fresh data.
  while (table.tBodies.length > 1) {
    table.tBodies[0].remove();
  }

  meetings.forEach((meeting) => {
    // New row for each meeting.
    const row = tbody.insertRow();

    // The default column.
    const select = row.insertCell();
    select.className = 'default';
    select.id = meeting.id;
    select.textContent = meeting.prefer ? '☑' : '☐';
    select.onclick = defaultOnClick;

    // The meeting id column.
    const link = row.insertCell();
    link.className = 'name';
    link.id = meeting.id;
    link.textContent = meeting.title;
    link.onclick = focusOnClick;

    // The active column.
    const active = row.insertCell();
    active.className = 'active';
    active.textContent = meeting.active ? '☑' : '-';

    // The audio settings column.
    const audio = row.insertCell();
    audio.className = 'audio';
    audio.id = meeting.id;
    audio.appendChild(
      meeting.audioMuted ? newImg('mic-off-96') : newImg('mic-on-96'),
    );
    audio.onclick = toggleAudioOnClick;

    // The video settings column.
    const video = row.insertCell();
    video.className = 'video';
    video.id = meeting.id;
    video.appendChild(
      meeting.videoMuted ? newImg('mic-off-96') : newImg('mic-on-96'),
    );
    video.onclick = toggleVideoOnClick;
  });
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

    case 'list':
      updateList(message.meetings);
      break;
  }
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
const port = chrome.runtime.connect({name: 'control'});
port.onMessage.addListener(onMessage);

// Kick off a request to the background page for current meetings.
postMessage('list');

/**
 * Invoked when storage is fetched.
 *
 * @see https://developer.chrome.com/extensions/storage#get
 * @param {!Object} settings All the user settings that exist.
 * @private
 */
function initSettings(settings) {
  logging.init({page: 'control', debug: !!settings['debug']});
}

chrome.storage.sync.get((settings) => {
  initSettings(settings);
});
