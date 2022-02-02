/**
 * FritzOutletAccessory
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

    inherits(FritzOutletAccessory, FritzAccessory);
    return FritzOutletAccessory;
};

function FritzOutletAccessory(platform, ain) {
    FritzAccessory.apply(this, Array.from(arguments).concat("outlet"));

    extend(this.services, {
        Outlet: new Service.Outlet(this.name)
    });

    // Outlet
    this.services.Outlet.getCharacteristic(Characteristic.On)
        .on('get', this.getOn.bind(this))
        .on('set', this.setOn.bind(this))
    ;

    this.services.Outlet.getCharacteristic(Characteristic.OutletInUse)
        .on('getInUse', this.getInUse.bind(this))
    ;

    this.services.Outlet.addCharacteristic(FritzPlatform.PowerUsage)
        .on('get', this.getPowerUsage.bind(this))
    ;

    this.services.Outlet.addCharacteristic(FritzPlatform.EnergyConsumption)
        .on('get', this.getEnergyConsumption.bind(this))
    ;

    // TemperatureSensor - add only of device supports it
    if (this.device.temperature && 
        this.platform.deviceConfig(`${ain}.TemperatureSensor`, true)
    ) {
        extend(this.services, {
            TemperatureSensor: new Service.TemperatureSensor(this.name)
        });

        this.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({minValue: -50})
            .on('get', this.getCurrentTemperature.bind(this))
        ;

        this.services.TemperatureSensor.fritzCurrentTemperature = 20;
    }

    this.services.Outlet.fritzState = false;
    this.services.Outlet.fritzInUse = false;
    this.services.Outlet.fritzPowerUsage = 0;
    this.services.Outlet.fritzEnergyConsumption = 0;

    this.update(); // execute immediately to get first initial values as fast as possible
    setInterval(this.update.bind(this), this.platform.interval);
}

FritzOutletAccessory.prototype.getOn = function(callback) {
    this.platform.log.debug(`Getting ${this.type} ${this.ain} state`);

    callback(null, this.services.Outlet.fritzState);

    this.queryOn();
};

FritzOutletAccessory.prototype.setOn = function(state, callback) {
    this.platform.log(`Switching ${this.type} ${this.ain} to ` + state);

    this.services.Outlet.fritzState = state;
    this.platform.fritz(state ? 'setSwitchOn' : 'setSwitchOff', this.ain);

    callback();
};

FritzOutletAccessory.prototype.queryOn = function() {
    this.platform.fritz('getSwitchState', this.ain).then(state => {
        const service = this.services.Outlet;
        service.fritzState = state;
        service.getCharacteristic(Characteristic.On).updateValue(state);
    });
};

FritzOutletAccessory.prototype.getInUse = function(callback) {
    this.platform.log.debug(`Getting ${this.type} ${this.ain} in use`);

    callback(null, this.services.Outlet.fritzInUse);
    this.queryPowerUsage();
};

FritzOutletAccessory.prototype.getPowerUsage = function(callback) {
    this.platform.log.debug(`Getting ${this.type} ${this.ain} power usage`);

    callback(null, this.services.Outlet.fritzPowerUsage);
    this.queryPowerUsage();
};

FritzOutletAccessory.prototype.queryPowerUsage = function() {
    this.platform.fritz('getSwitchPower', this.ain).then(power => {
        const service = this.services.Outlet;

        service.fritzInUse = power > 0;
        service.fritzPowerUsage = power;

        service.getCharacteristic(Characteristic.OutletInUse).updateValue(service.fritzInUse);
        service.getCharacteristic(FritzPlatform.PowerUsage).updateValue(power);
    });
};

FritzOutletAccessory.prototype.getEnergyConsumption = function(callback) {
    this.platform.log.debug(`Getting ${this.type} ${this.ain} energy consumption`);

    callback(null, this.services.Outlet.fritzEnergyConsumption);
    this.queryEnergyConsumption();
};

FritzOutletAccessory.prototype.queryEnergyConsumption = function() {
    this.platform.fritz('getSwitchEnergy', this.ain).then(energy => {
        const service = this.services.Outlet;

        energy = energy / 1000.0;
        service.fritzEnergyConsumption = energy;
        service.getCharacteristic(FritzPlatform.EnergyConsumption).updateValue(energy);
    });
};

FritzOutletAccessory.prototype.update = function() {
    this.platform.log.debug(`Updating ${this.type} ${this.ain}`);

    // Outlet
    this.queryOn();
    this.queryPowerUsage();
    this.queryEnergyConsumption();

    // TemperatureSensor
    if (this.services.TemperatureSensor) {
        this.queryCurrentTemperature();
    }
};
