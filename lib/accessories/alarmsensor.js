/**
 * FritzAlarmSensorAccessory
 *
 * @url https://github.com/andig/homebridge-fritz
 * @author Andreas Götz <cpuidle@gmx.de>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 6 */
"use strict";

const inherits = require('util').inherits;
const extend = require('extend');

let Service, Characteristic, FritzPlatform, FritzAccessory;

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

    this.update(); // execute immediately to get first initial values as fast as possible
    setInterval(this.update.bind(this), this.platform.interval);
}

FritzAlarmSensorAccessory.prototype.getSensorState = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} alarm state`);

    callback(null, this.services.ContactSensor.fritzAlarmState);
    this.querySensorState();
};

FritzAlarmSensorAccessory.prototype.querySensorState = function() {
    this.platform.fritz('getDeviceListFiltered', { identifier: this.ain }).then(function (devices) {
        const service = this.services.ContactSensor;
        let state = +devices[0].alert.state
            ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : Characteristic.ContactSensorState.CONTACT_DETECTED;

        // invert if enabled
        state = this.platform.deviceConfig(`${this.ain}.invert`, false)
            ? 1-state
            : state;

        service.fritzAlarmState = state;
        service.getCharacteristic(Characteristic.ContactSensorState).updateValue(state);
    }.bind(this));
};

FritzAlarmSensorAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);
    this.querySensorState();
};
