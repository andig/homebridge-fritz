/**
 * FRITZ!Box Platform Plugin for HomeBridge (https://github.com/nfarina/homebridge)
 *
 * @url https://github.com/andig/homebridge-fritz
 * @author Andreas Götz <cpuidle@gmx.de>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 6 */
"use strict";

module.exports = function(homebridge) {
    let FritzPlatform = require('./lib/platform')(homebridge);
    homebridge.registerPlatform("homebridge-fritz", "FRITZ!Box", FritzPlatform);
};
