/**
 * FritzWifiAccessory
 *
 * @url https://github.com/andig/homebridge-fritz
 * @author Andreas Götz <cpuidle@gmx.de>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 6 */
"use strict";

const url = require("url");
const TR064 = require("tr-064-async").Fritzbox;

var Service, Characteristic, FritzPlatform;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    FritzPlatform = require('../platform')(homebridge);

    return FritzWifiAccessory;
};

function FritzWifiAccessory(platform) {
    this.platform = platform;
    this.name = this.platform.deviceConfig("wifi.name", "Guest WLAN");

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

    this.fallback = false;

    if (this.fallback) {
        // fritzapi screen scraping
        this.services.Switch.getCharacteristic(Characteristic.On)
            .on('get', this.getOnFallback.bind(this))
            .on('set', this.setOnFallback.bind(this))
        ;
    }
    else {
        this.platform.log("Using tr64 api for guest Wifi");

        var box = url.parse(this.platform.options.url);

        var options = {
          host: box.host || 'fritz.box',
          port: 49000,
          ssl: false,
          user: this.platform.config.username,
          password: this.platform.config.password
        };

        var tr64 = new TR064(options);
        var self = this;

        tr64.initTR064Device().then(() => {
            // remember device
            this.tr64 = tr64;

            // remember service
            let wifiService = "urn:dslforum-org:service:WLANConfiguration";
            this.tr64service = tr64.services[wifiService + ":3"] || tr64.services[wifiService + ":2"];

            this.services.Switch.getCharacteristic(Characteristic.On)
                .on('get', this.getOn.bind(this))
                .on('set', this.setOn.bind(this))
            ;
        }).catch((err) => {
            self.platform.log.error(err);
        });
    }

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzWifiAccessory.prototype.getServices = function() {
    return [this.services.AccessoryInformation, this.services.Switch];
};

FritzWifiAccessory.prototype.getOn = function(callback) {
    this.platform.log("Getting guest WLAN state");
    var self = this;

    var service = this.services.Switch;
    callback(null, service.fritzState);

    this.tr64service.actions.GetInfo().then((res) => {
        self.platform.log.debug("< %s %s", "tr64.GetInfo", JSON.stringify(res));

        service.fritzState = +res.NewEnable;
        service.getCharacteristic(Characteristic.On).setValue(service.fritzState, undefined, FritzPlatform.Context);
    }).catch((err) => {
        self.platform.log.error(err);
    });
};

FritzWifiAccessory.prototype.setOn = function(on, callback, context) {
    if (context == FritzPlatform.Context) {
        callback(null, on);
        return;
    }

    this.platform.log("Switching guest WLAN to " + on);
    var self = this;

    var payload = {'NewEnable':on ? '1' : '0'};

    this.tr64service.actions.SetEnable(payload).then((res) => {
        self.platform.log.debug("< %s %s", "tr64.SetEnable", JSON.stringify(res));

        // TODO: check GetInfo to see if successful
        callback(null, on);
    }).catch((err) => {
        self.platform.log.error(err);
    });
};

FritzWifiAccessory.prototype.getOnFallback = function(callback) {
    this.platform.log("Getting guest WLAN state");

    var service = this.services.Switch;
    callback(null, service.fritzState);

    this.platform.fritz('getGuestWlan').then(function(res) {
        service.fritzState = res.activate_guest_access;
        service.getCharacteristic(Characteristic.On).setValue(res.activate_guest_access, undefined, FritzPlatform.Context);
    });
};

FritzWifiAccessory.prototype.setOnFallback = function(on, callback, context) {
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

    var func = this.fallback ? this.getOnFallback.bind(this) : this.getOn.bind(this);

    func(function(foo, state) {
        self.services.Switch.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context);
    }.bind(this));
};
