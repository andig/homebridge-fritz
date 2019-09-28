/**
 * FritzOutletAccessory
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
    }

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzOutletAccessory.prototype.getOn = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} state`);

    var service = this.services.Outlet;
    callback(null, service.fritzState);

    this.platform.fritz('getSwitchState', this.ain).then(function(state) {
        service.fritzState = state;
        service.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context);
    });
};

FritzOutletAccessory.prototype.setOn = function(state, callback, context) {
    var service = this.services.Outlet;
    service.fritzState = state;

    callback(null, state);

    if (context == FritzPlatform.Context) {
        return;
    }

    this.platform.log(`Switching ${this.type} ${this.ain} to ` + state);

    var func = state ? 'setSwitchOn' : 'setSwitchOff';
    this.platform.fritz(func, this.ain).then(function(state) {
        service.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context)
    });
};

FritzOutletAccessory.prototype.getInUse = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} in use`);

    var service = this.services.Outlet;
    callback(null, service.fritzInUse);

    this.platform.fritz('getSwitchPower', this.ain).then(function(power) {
        var inUse = power > 0;
        service.fritzInUse = inUse;
        service.getCharacteristic(Characteristic.OutletInUse).setValue(inUse, undefined, FritzPlatform.Context);
    });
};

FritzOutletAccessory.prototype.getPowerUsage = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} power usage`);

    var service = this.services.Outlet;
    callback(null, service.fritzPowerUsage);

    this.platform.fritz('getSwitchPower', this.ain).then(function(power) {
        service.fritzPowerUsage = power;
        service.getCharacteristic(FritzPlatform.PowerUsage).setValue(power, undefined, FritzPlatform.Context);
    });
};

FritzOutletAccessory.prototype.getEnergyConsumption = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} energy consumption`);

    var service = this.services.Outlet;
    callback(null, service.fritzEnergyConsumption);

    this.platform.fritz('getSwitchEnergy', this.ain).then(function(energy) {
        energy = energy / 1000.0;
        service.fritzEnergyConsumption = energy;
        service.getCharacteristic(FritzPlatform.EnergyConsumption).setValue(energy, undefined, FritzPlatform.Context);
    });
};

FritzOutletAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);
    var self = this;

    // Outlet
    this.getOn(function(foo, state) {
        self.services.Outlet.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context);
    }.bind(this));

    this.getPowerUsage(function(foo, power) {
        self.services.Outlet.getCharacteristic(FritzPlatform.PowerUsage).setValue(power, undefined, FritzPlatform.Context);
    }.bind(this));

    this.getInUse(function(foo, state) {
        self.services.Outlet.getCharacteristic(Characteristic.OutletInUse).setValue(state, undefined, FritzPlatform.Context);
    }.bind(this));

    this.getEnergyConsumption(function(foo, energy) {
        self.services.Outlet.getCharacteristic(FritzPlatform.EnergyConsumption).setValue(energy, undefined, FritzPlatform.Context);
    }.bind(this));

    // TemperatureSensor
    if (this.services.TemperatureSensor) {
        this.getCurrentTemperature(function(foo, temp) {
            self.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
        }.bind(this));
    }
};
