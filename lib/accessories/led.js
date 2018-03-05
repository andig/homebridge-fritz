/**
 * FritzLEDAccessory
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

    return FritzLEDAccessory;
};

function FritzLEDAccessory(platform) {
    this.platform = platform;
    this.name = "LED status";

    this.services = {
        AccessoryInformation: new Service.AccessoryInformation(),
        Lightbulb: new Service.Lightbulb(this.name)
    };

    this.services.AccessoryInformation.setCharacteristic(Characteristic.Manufacturer, "AVM");
    this.services.AccessoryInformation.setCharacteristic(Characteristic.Model, "Fritz!Box");

    this.platform.fritz('getOSVersion').then(function(version) {
        this.services.AccessoryInformation.setCharacteristic(Characteristic.FirmwareRevision, version);
    }.bind(this));

    this.services.Lightbulb.getCharacteristic(Characteristic.On).on('set', this.setOn.bind(this));
    this.services.Lightbulb.getCharacteristic(Characteristic.Brightness).on('set', this.setBrightness.bind(this));

    setImmediate(this.update.bind(this));
}

FritzLEDAccessory.prototype.getServices = function() {
    return [this.services.AccessoryInformation, this.services.Lightbulb];
};

FritzLEDAccessory.prototype.setOn = function(on, callback, context) {
    var service = this.services.Lightbulb;
    var platform = this.platform;

    // changing brightness will immediately emit setOn(true), which we ignore here
    if (context == FritzPlatform.Context || service.updatePending) {
        callback(null);
        return;
    }

    platform.log("Switching LED on to: " + on);

    this.services.Lightbulb.getCharacteristic(Characteristic.Brightness).getValue(function(err, brightness){
        platform.fritz('setLEDStatus', on ? (brightness > 50 ? '0' : '1') : '2').then(function(res) {
            service.fritzState = res.led_display;
            platform.log("New LED status: " + res.led_display);
            callback(null);
        });
    }, FritzPlatform.Context);
};

FritzLEDAccessory.prototype.setBrightness = function(brightness, callback, context) {
    var service = this.services.Lightbulb;
    var plog = this.platform.log;

    if (context == FritzPlatform.Context) {
        callback(null);
        return;
    }

    plog("Switching LED brightness to: " + brightness);
    service.updatePending = true;

    this.platform.fritz('setLEDStatus', brightness > 50 ? '0' : (brightness > 0 ? '1' : '2')).then(function(res) {
        service.fritzState = res.led_display;
        service.updatePending = false;
        plog("New LED status: " + res.led_display);
        callback(null);
    });
};

FritzLEDAccessory.prototype.update = function() {
    var service = this.services.Lightbulb;
    var plog = this.platform.log;

    this.platform.fritz('getLEDStatus').then(function(res) {
        service.fritzState = res.led_display;
        plog("initial LED status: " + res.led_display);
        service.getCharacteristic(Characteristic.On).setValue(res.led_display !== '2', undefined, FritzPlatform.Context);
        service.getCharacteristic(Characteristic.Brightness).setValue(res.led_display === '1' ? 10 : 100, undefined, FritzPlatform.Context);
    });
};
