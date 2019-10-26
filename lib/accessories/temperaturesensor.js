/**
 * FritzTemperatureSensorAccessory
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

    inherits(FritzTemperatureSensorAccessory, FritzAccessory);
    return FritzTemperatureSensorAccessory;
};

function FritzTemperatureSensorAccessory(platform, ain) {
    FritzAccessory.apply(this, Array.from(arguments).concat("temperature sensor"));

    extend(this.services, {
        TemperatureSensor: new Service.TemperatureSensor(this.name)
    });

    this.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({minValue: -50})
        .on('get', this.getCurrentTemperature.bind(this))
    ;

    this.services.TemperatureSensor.fritzCurrentTemperature = 20;

    this.update(); // execute immediately to get first initial values as fast as possible
    setInterval(this.update.bind(this), this.platform.interval);
}

FritzTemperatureSensorAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);
    this.queryCurrentTemperature();
};
