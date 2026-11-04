/* HVAC Notes: apply the reader's view settings (paper, font, text size) before the first paint, so they never flash.
   Only view settings are kept on the device (key dame.hvac-notes.view); everything else lives in the database. */
(function () {
  'use strict';
  try {
    var s = JSON.parse(localStorage.getItem('dame.hvac-notes.view') || '{}'), d = document.documentElement;
    if (s.paper && s.paper !== 'auto') d.setAttribute('data-paper', s.paper);
    if (s.font) d.setAttribute('data-font', s.font);
    if (s.size) d.style.setProperty('--read-size', s.size + 'px');
  } catch (e) { /* view settings are optional */ }
})();
