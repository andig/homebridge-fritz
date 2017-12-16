/**
 * FritzAccessory
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

    FritzPlatform = require('./platform')(homebridge);

    return FritzAccessory;
};

function FritzAccessory(platform, ain, type) {
    this.platform = platform;
    this.ain = ain;
    this.type = type;

    // fix duplicate UUID (https://github.com/andig/homebridge-fritz/issues/27)
    this.uuid_base = type + ain;

    this.name = this.platform.getName(this.ain);
    this.device = this.platform.getDevice(this.ain);

    this.services = {
        AccessoryInformation: new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.SerialNumber, this.ain)
    };

    // these characteristics will not be present for e.g. device groups
    if (this.device.manufacturer) {
        this.services.AccessoryInformation
            .setCharacteristic(Characteristic.Manufacturer, this.device.manufacturer);
    }
    if (this.device.productname) {
        this.services.AccessoryInformation
            .setCharacteristic(Characteristic.Model, this.device.productname);
    }
    if (this.device.fwversion) {
        this.services.AccessoryInformation
            .setCharacteristic(Characteristic.FirmwareRevision, this.device.fwversion);
    }
}

FritzAccessory.prototype.getServices = function() {
    return Object.keys(this.services).map(function(key) {
        return this.services[key];
    }.bind(this));
};

FritzAccessory.prototype.getCurrentTemperature = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} temperature`);

    // characteristic CurrentTemperature is part of multiple services
    var service = this.services.Thermostat || this.services.TemperatureSensor;
    callback(null, service.fritzCurrentTemperature);

    this.platform.fritz('getTemperature', this.ain).then(function(temp) {
        service.fritzCurrentTemperature = temp;
        service.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
    });
};
