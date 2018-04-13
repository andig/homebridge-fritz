/**
 * FritzWifiAccessory
 *
 * @url https://github.com/andig/homebridge-fritz
 * @author Andreas Götz <cpuidle@gmx.de>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 6 */
"use strict";

var Service, Characteristic, FritzPlatform;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    FritzPlatform = require('../platform')(homebridge);

    return FritzWifiAccessory;
};

function FritzWifiAccessory(platform) {
    this.platform = platform;
    this.name = this.platform.config.wifiName || "Guest WLAN";

    this.services = {
        AccessoryInformation: new Service.AccessoryInformation(),
        Switch: new Service.Switch(this.name)
    };

    this.services.AccessoryInformation
        .setCharacteristic(Characteristic.Manufacturer, "AVM");
    this.services.AccessoryInformation
        .setCharacteristic(Characteristic.Model, "Fritz!Box");

    this.platform.fritz('getOSVersion').then(function(version) {
        this.services.AccessoryInformation
            .setCharacteristic(Characteristic.FirmwareRevision, version);
    }.bind(this));

    this.services.Switch.getCharacteristic(Characteristic.On)
        .on('get', this.getOn.bind(this))
        .on('set', this.setOn.bind(this))
    ;

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzWifiAccessory.prototype.getServices = function() {
    return [this.services.AccessoryInformation, this.services.Switch];
};

FritzWifiAccessory.prototype.getOn = function(callback) {
    this.platform.log("Getting guest WLAN state");

    var service = this.services.Switch;
    callback(null, service.fritzState);

    this.platform.fritz('getGuestWlan').then(function(res) {
        service.fritzState = res.activate_guest_access;
        service.getCharacteristic(Characteristic.On).setValue(res.activate_guest_access, undefined, FritzPlatform.Context);
    });
};

FritzWifiAccessory.prototype.setOn = function(on, callback, context) {
    if (context == FritzPlatform.Context) {
        callback(null, on);
        return;
    }

    this.platform.log("Switching guest WLAN to " + on);

    this.platform.fritz('setGuestWlan', on ? true : false).then(function(res) {
        callback(null, res.activate_guest_access);
    });
};

FritzWifiAccessory.prototype.update = function() {
    this.platform.log("Updating guest WLAN");
    var self = this;

    this.getOn(function(foo, state) {
        self.services.Switch.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context);
    });
};
