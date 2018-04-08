/**
 * FritzAlarmSensorAccessory
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

    inherits(FritzAlarmSensorAccessory, FritzAccessory);
    return FritzAlarmSensorAccessory;
};

function FritzAlarmSensorAccessory(platform, ain) {
    FritzAccessory.apply(this, Array.from(arguments).concat("alarm sensor"));

    extend(this.services, {
        ContactSensor: new Service.ContactSensor(this.name)
    });

    this.services.ContactSensor.getCharacteristic(Characteristic.ContactSensorState)
        .on('get', this.getSensorState.bind(this))
    ;

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzAlarmSensorAccessory.prototype.getSensorState = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} alarm state`);

    var service = this.services.ContactSensor;
    callback(null, service.fritzAlarmState);

    this.platform.fritz('getDeviceListFiltered', { identifier: this.ain }).then(function(devices) {
        console.warn(devices);
        var state = devices[0].alert.state ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        service.fritzAlarmState = state;
        service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setValue(state, undefined, FritzPlatform.Context);
    });
};

FritzAlarmSensorAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);

    // ContactSensor
    this.getSensorState(function(foo, state) {
        this.services.ContactSensor.getCharacteristic(Characteristic.ContactSensorState).setValue(foo, undefined, FritzPlatform.Context);
    }.bind(this));
};
