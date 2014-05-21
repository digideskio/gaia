/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

const CC = Components.Constructor;
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import('resource://gre/modules/Services.jsm');

function debug(data) {
  dump('desktop-helper: ' + data + '\n');
}

const kChromeRootPath = 'chrome://desktop-helper.js/content/data/';

// XXX Scripts should be loaded based on the permissions of the apps not
// based on the domain.
const kScriptsPerDomain = {
  '.gaiamobile.org': [
    'ffos_runtime.js',
    'lib/bluetooth.js',
    'lib/cameras.js',
    'lib/mobile_connection.js',
    'lib/icc_manager.js',
    'lib/telephony.js',
    'lib/wifi.js'
  ]
};

let systemApp;
let otherApps = [];

function injectMocks() {
  // Track loading of apps to inject mock APIs
  Services.obs.addObserver(function(document) {
    // Some documents like XBL don't have location and should be ignored
    if (!document.location || !document.defaultView)
      return;
    let currentDomain = document.location.toString();
    let window = document.defaultView;

    // Do not include mocks for unit test sandboxes
    if (window.wrappedJSObject.mocha &&
        currentDomain.indexOf('_sandbox.html') !== -1) {
      return;
    }

    if (currentDomain.indexOf('system.gaiamobile') > -1) {
      systemApp = window.wrappedJSObject;
      systemApp.navigator.broadcastToClientApps = broadcastToClientApps;
      systemApp.navigator.triggerMozMessage = triggerMozMessage;
    }

    otherApps.push(window.wrappedJSObject);
    window.wrappedJSObject.navigator.sendToSystemApp = sendToSystemApp;
    window.wrappedJSObject.navigator.mozSetMessageHandler = function(ev, cb) {
      mozSetMessageHandler(window.wrappedJSObject, ev, cb);
    };

    debug('+++ loading scripts for app: ' + currentDomain + "\n");
    // Inject mocks based on domain
    for (let domain in kScriptsPerDomain) {
      if (currentDomain.indexOf(domain) == -1)
        continue;

      let includes = kScriptsPerDomain[domain];
      for (let i = 0; i < includes.length; i++) {
        debug('loading ' + includes[i] + '...');

        Services.scriptloader.loadSubScript(kChromeRootPath + includes[i],
                                            window.wrappedJSObject);
      }
    }

  }, 'document-element-inserted', false);
}

function hotfixAlarms() {
  // Replace existing alarm service xpcom factory by a new working one,
  // until a working fallback is implemented in platform code (bug 867868)

  // Sigh. Seems like there is a registration issue between all the addons.
  // This is dirty but delaying this seems to make it.
  var timer = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer);
  timer.initWithCallback(function() {
    Services.scriptloader.loadSubScript('chrome://desktop-helper.js/content/alarms.js', {});
  }, 1000, Ci.nsITimer.TYPE_ONE_SHOT);
}

function startup(data, reason) {
  try {
    hotfixAlarms();

    injectMocks();
  } catch (e) {
    debug('Something went wrong while trying to start desktop-helper: ' + e);
  }
}

function shutdown(data, reason) {
}

function install(data, reason) {
}

function uninstall(data, reason) {
}

function sendToSystemApp(detail) {
  systemApp.onFromContentApp && systemApp.onFromContentApp(JSON.stringify(detail));
}

function broadcastToClientApps(detail) {
  let toRemove = [];

  otherApps.forEach(function(win) {
    try {
      win.onFromSystemApp && win.onFromSystemApp(JSON.stringify(detail));
    }
    catch(e) {
      if ((''+e).indexOf('can\'t access dead object') > -1) {
        toRemove.push(win);
      }
      else {
        throw e;
      }
    }
  });

  toRemove.forEach(function(win) {
    otherApps.splice(otherApps.indexOf(win), 1);
  });
}

function mozSetMessageHandler(win, evName, callback) {
  win._messageHandlers = win._messageHandlers || {};
  win._messageHandlers[evName] = callback;
}

function triggerMozMessage(evName) {
  let toRemove = [];

  otherApps.forEach(function(win) {
    try {
      win._messageHandlers &&
        win._messageHandlers[evName] &&
        win._messageHandlers[evName]();
    }
    catch(e) {
      if ((''+e).indexOf('can\'t access dead object') > -1) {
        toRemove.push(win);
      }
      else {
        throw e;
      }
    }
  });

  toRemove.forEach(function(win) {
    otherApps.splice(otherApps.indexOf(win), 1);
  });
}

