/**
 * FritzThermostatAccessory
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

    inherits(FritzThermostatAccessory, FritzAccessory);
    return FritzThermostatAccessory;
};

function FritzThermostatAccessory(platform, ain) {
    FritzAccessory.apply(this, Array.from(arguments).concat("thermostat"));

    extend(this.services, {
        Thermostat: new Service.Thermostat(this.name),
        BatteryService: new Service.BatteryService(this.name)
    });

    // Thermostat
    this.services.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', this.getCurrentHeatingCoolingState.bind(this))
    ;
    this.services.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('get', this.getTargetHeatingCoolingState.bind(this))
        .on('set', this.setTargetHeatingCoolingState.bind(this))
    ;
    this.services.Thermostat.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({minValue: -50})
        .on('get', this.getCurrentTemperature.bind(this))
    ;
    this.services.Thermostat.getCharacteristic(Characteristic.TargetTemperature)
        .on('get', this.getTargetTemperature.bind(this))
        .on('set', this.setTargetTemperature.bind(this))
    ;
    this.services.Thermostat.getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on('get', this.getTemperatureDisplayUnits.bind(this))
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

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzThermostatAccessory.prototype.getCurrentHeatingCoolingState = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} heating state`);

    var service = this.services.Thermostat;
    callback(null, service.fritzCurrentHeatingCoolingState);

    this.platform.fritz('getTempTarget', this.ain).then(function(temp) {
        var state = temp == 'off' ? Characteristic.CurrentHeatingCoolingState.OFF : Characteristic.CurrentHeatingCoolingState.HEAT;

        service.fritzCurrentHeatingCoolingState = state;
        service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setValue(state, undefined, FritzPlatform.Context);
    });
};

FritzThermostatAccessory.prototype.getTargetHeatingCoolingState = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} target heating state`);

    var service = this.services.Thermostat;
    callback(null, service.fritzTargetHeatingCoolingState);

    this.platform.fritz('getTempTarget', this.ain).then(function(temp) {
        var state;

        switch (temp) {
            case 'off':
                state = Characteristic.TargetHeatingCoolingState.OFF;
                break;
            case 'on':
                state = Characteristic.TargetHeatingCoolingState.HEAT;
                break;
            default:
                state = Characteristic.TargetHeatingCoolingState.AUTO;
        }

        service.fritzTargetHeatingCoolingState = state;
        service.getCharacteristic(Characteristic.TargetHeatingCoolingState).setValue(state, undefined, FritzPlatform.Context);
    });
};

FritzThermostatAccessory.prototype.setTargetHeatingCoolingState = function(state, callback, context) {
    if (context == FritzPlatform.Context) {
        callback(null, state);
        return;
    }

    this.platform.log(`Setting ${this.type} ${this.ain} heating state`);
    var self = this, promise;

    switch (state) {
        case Characteristic.TargetHeatingCoolingState.OFF:
        case Characteristic.TargetHeatingCoolingState.COOL:
            promise = this.platform.fritz('getTempNight', this.ain);
            break;
        case Characteristic.TargetHeatingCoolingState.HEAT:
            promise = this.platform.fritz('getTempComfort', this.ain);
            break;
        case Characteristic.TargetHeatingCoolingState.AUTO:
            callback(null, state);
            return;
    }

    promise.then(function(temp) {
        if (temp !== undefined) {
            self.platform.fritz('setTempTarget', self.ain, temp).then(function(temp) {
                callback(null, state);
            });
        }
    });
};

FritzThermostatAccessory.prototype.getTargetTemperature = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} target temperature`);

    var service = this.services.Thermostat;
    callback(null, service.fritzTargetTemperature);

    this.platform.fritz('getTempTarget', this.ain).then(function(temp) {
        if (temp == 'off')
            temp = this.services.Thermostat.getCharacteristic(Characteristic.TargetTemperature).props.minValue;
        else if (temp == 'on')
            temp = this.services.Thermostat.getCharacteristic(Characteristic.TargetTemperature).props.maxValue;

        service.fritzTargetTemperature = temp;
        service.getCharacteristic(Characteristic.TargetTemperature).setValue(temp, undefined, FritzPlatform.Context);
    }.bind(this));
};

FritzThermostatAccessory.prototype.setTargetTemperature = function(temp, callback, context) {
    if (context == FritzPlatform.Context) {
        callback(null, temp);
        return;
    }

    this.platform.log(`Setting ${this.type} ${this.ain} target temperature`);

    this.platform.fritz('setTempTarget', this.ain, temp).then(function(temp) {
        callback(null, temp);
    });
};

FritzThermostatAccessory.prototype.getTemperatureDisplayUnits = function(callback) {
    callback(null, Characteristic.TemperatureDisplayUnits.CELSIUS);
};

FritzThermostatAccessory.prototype.getBatteryLevel = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} battery level`);

    var service = this.services.BatteryService;
    callback(null, service.fritzBatteryLevel);

    this.platform.fritz('getBatteryCharge', this.ain).then(function(batteryLevel) {
        service.fritzBatteryLevel = batteryLevel;
        service.getCharacteristic(Characteristic.BatteryLevel).setValue(batteryLevel, undefined, FritzPlatform.Context);
    });
};

FritzThermostatAccessory.prototype.getChargingState = function(callback) {
    callback(null, Characteristic.ChargingState.NOT_CHARGEABLE);
};

FritzThermostatAccessory.prototype.getStatusLowBattery = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} battery status`);

    var service = this.services.BatteryService;
    callback(null, service.fritzStatusLowBattery);

    this.platform.fritz('getBatteryCharge', this.ain).then(function(battery) {
        /* jshint laxbreak:true */
        var batteryState = battery < 20
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

        service.fritzStatusLowBattery = batteryState;
        service.getCharacteristic(Characteristic.StatusLowBattery).setValue(batteryState, undefined, FritzPlatform.Context);
    });
};

FritzThermostatAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);
    var self = this;

    // Thermostat
    this.getCurrentTemperature(function(foo, temp) {
        self.services.Thermostat.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
    }.bind(this));

    this.getTargetTemperature(function(foo, temp) {
        self.services.Thermostat.getCharacteristic(Characteristic.TargetTemperature).setValue(temp, undefined, FritzPlatform.Context);
    }.bind(this));

    // BatteryService
    this.getBatteryLevel(function(foo, batteryLevel) {
        self.services.BatteryService.getCharacteristic(Characteristic.BatteryLevel).setValue(batteryLevel, undefined, FritzPlatform.Context);
    }.bind(this));

    this.getStatusLowBattery(function(foo, batteryState) {
        self.services.BatteryService.getCharacteristic(Characteristic.StatusLowBattery).setValue(batteryState, undefined, FritzPlatform.Context);
    }.bind(this));
};
