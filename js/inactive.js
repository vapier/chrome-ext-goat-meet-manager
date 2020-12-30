// Copyright 2021 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Code for the inactive popup page.
 */

/**
 * Helper for when the user clicks the "options" link.
 *
 * We have to route it to the Chrome API as there's no fixed URL.
 *
 * @param {!Event} event The user click.
 */
function optionsOnClick(event) {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
}

function init() {
  const optionsLink = document.getElementById('options');
  optionsLink.onclick = optionsOnClick;
}
window.addEventListener('DOMContentLoaded', init);
