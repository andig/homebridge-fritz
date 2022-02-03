/**
 * FritzDect440Accessory
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

    inherits(FritzDect440Accessory, FritzAccessory);
    return FritzDect440Accessory;
};

function FritzDect440Accessory(platform, ain) {
    FritzAccessory.apply(this, Array.from(arguments).concat("temperature sensor"));

    extend(this.services, {
        TemperatureSensor: new Service.TemperatureSensor(this.name),
        HumiditySensor: new Service.HumiditySensor(this.name),
        BatteryService: new Service.BatteryService(this.name)
    });

    // TemperatureSensor
    this.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({minValue: -50})
        .on('get', this.getCurrentTemperature.bind(this))
    ;

    this.services.TemperatureSensor.getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on('get', this.getTemperatureDisplayUnits.bind(this))
    ;

    // HumiditySensor
    this.services.HumiditySensor.getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .on('get', this.getCurrentRelativeHumidity.bind(this))
    ;

    // BatteryService
    this.services.BatteryService.getCharacteristic(Characteristic.BatteryLevel)
        .on('get', this.getBatteryLevel.bind(this))
    ;
    this.services.BatteryService.getCharacteristic(Characteristic.ChargingState)
        .on('get', this.getChargingState.bind(this))
    ;
    this.services.BatteryService.getCharacteristic(Characteristic.StatusLowBattery)
        .on('get', this.getStatusLowBattery.bind(this))
    ;

    this.update(); // execute immediately to get first initial values as fast as possible
    setInterval(this.update.bind(this), this.platform.interval);
}

FritzDect440Accessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);

    let temperatureSensor = this.services.TemperatureSensor;
    let humiditySensor = this.services.HumiditySensor;
    let batteryService = this.services.BatteryService;

    this.platform.fritz('getDeviceListFiltered', { identifier: this.ain }).then(function(devices) {
        console.log(devices)

        let currentTemperature = parseInt(devices[0]['temperature']['celsius']) / 10;
        let currentRelativeHumidity = parseInt(devices[0]['humidity']['rel_humidity']);
        let batteryLevel = devices[0]['battery'];

        temperatureSensor.fritzCurrentTemperature = currentTemperature
        temperatureSensor.getCharacteristic(Characteristic.CurrentTemperature).setValue(temperatureSensor.fritzCurrentTemperature);

        humiditySensor.fritzCurrentRelativeHumidity = currentRelativeHumidity
        humiditySensor.getCharacteristic(Characteristic.CurrentTemperature).setValue(humiditySensor.fritzCurrentRelativeHumidity);

        batteryService.fritzBatteryLevel = batteryLevel
        batteryService.getCharacteristic(Characteristic.BatteryLevel).setValue(batteryService.fritzBatteryLevel);

        batteryService.fritzStatusLowBattery = batteryLevel < 20
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        batteryService.getCharacteristic(Characteristic.StatusLowBattery).updateValue(batteryService.fritzStatusLowBattery);
    }.bind(this));
};

FritzDect440Accessory.prototype.getBatteryLevel = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} battery level`);

    var service = this.services.BatteryService;
    callback(null, service.fritzBatteryLevel);
};

FritzDect440Accessory.prototype.getChargingState = function(callback) {
    callback(null, Characteristic.ChargingState.NOT_CHARGEABLE);
};

FritzDect440Accessory.prototype.getStatusLowBattery = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} battery status`);

    var service = this.services.BatteryService;
    callback(null, service.fritzStatusLowBattery);
};

FritzDect440Accessory.prototype.getCurrentRelativeHumidity = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} relative humidity`);

    var service = this.services.HumiditySensor;
    callback(null, service.fritzCurrentRelativeHumidity);
};

FritzDect440Accessory.prototype.getTemperatureDisplayUnits = function(callback) {
    callback(null, Characteristic.TemperatureDisplayUnits.CELSIUS);
};
