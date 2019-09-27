/**
 * FritzButtonAccessory
 *
 * @url https://github.com/andig/homebridge-fritz
 * @author Andreas Götz <cpuidle@gmx.de>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 6 */
"use strict";

var inherits = require('util').inherits;
var extend = require('extend');

var Service, Characteristic, FritzPlatform, FritzAccessory;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    FritzPlatform = require('../platform')(homebridge);
    FritzAccessory = require('../accessory')(homebridge);

    inherits(FritzButtonAccessory, FritzAccessory);
    return FritzButtonAccessory;
};

function FritzButtonAccessory(platform, ain, index, name) {
    FritzAccessory.apply(this, Array.from(arguments).concat("button"));

    this.index = index; // button index of device
    this.name = name; // button name for index

    extend(this.services, {
        Switch: new Service.Switch(this.name)
    });

    this.services.Switch.getCharacteristic(Characteristic.On)
        .on('get', this.getButtonState.bind(this))
    ;

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzButtonAccessory.prototype.getButtonState = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} button state`);

    let service = this.services.Switch;
    callback(null, service.fritzButtonState);

    this.platform.fritz('getDeviceListFiltered', { identifier: this.ain }).then(function(devices) {
        let lastPressed = +devices[0].button[this.index].lastpressedtimestamp;

        var pressDetected;
        if (this.lastPressed === undefined) {
            pressDetected = Date.now() - lastPressed * 1000 < this.platform.interval;
        } else {
            pressDetected = this.lastPressed != lastPressed;
        }

        if (this.lastPressed !== undefined && this.lastPressed != lastPressed) {
            service.getCharacteristic(Characteristic.On).setValue(true);
            setTimeout(function() {
                service.getCharacteristic(Characteristic.On).setValue(false);
            }, 1000);
        }

        this.lastPressed = lastPressed;
    });
};

FritzButtonAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);

    // Switch
    this.getButtonState(function(foo, state) {
        this.services.Switch.getCharacteristic(Characteristic.SwitchState).setValue(foo, undefined, FritzPlatform.Context);
    }.bind(this));
};
