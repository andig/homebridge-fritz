/**
 * FritzThermostatAccessory
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

    // init some default values until the first update response arrives
    this.services.Thermostat.fritzCurrentTemperature = 20;
    this.services.BatteryService.fritzBatteryLevel = 100;
    this.services.BatteryService.fritzStatusLowBattery = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    this.services.Thermostat.fritzCurrentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF;
    this.services.Thermostat.fritzTargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.AUTO;
    this.services.Thermostat.fritzTargetTemperature = 20;

    this.update(); // execute immediately to get first initial values as fast as possible
    setInterval(this.update.bind(this), this.platform.interval);
}

FritzThermostatAccessory.prototype.getCurrentHeatingCoolingState = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} current heating state`);

    // current state gets queried in getTargetTemperature
    callback(null, this.services.Thermostat.fritzCurrentHeatingCoolingState);
};

FritzThermostatAccessory.prototype.getTargetHeatingCoolingState = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} target heating state`);

    // target state gets queried in getTargetTemperature
    callback(null, this.services.Thermostat.fritzTargetHeatingCoolingState);
};

FritzThermostatAccessory.prototype.setTargetHeatingCoolingState = function(state, callback) {
    this.platform.log(`Setting ${this.type} ${this.ain} heating state`);

    const service = this.services.Thermostat;

    service.fritzTargetHeatingCoolingState = state;

    let currentState = Characteristic.CurrentHeatingCoolingState.HEAT;
    // noinspection FallThroughInSwitchStatementJS
    switch (state) {
        case Characteristic.TargetHeatingCoolingState.COOL:
            currentState = Characteristic.CurrentHeatingCoolingState.COOL;
            // fall through to the next
        case Characteristic.TargetHeatingCoolingState.HEAT:
            this.queryNightAndComfortTemperatures(true);
            break;
        case Characteristic.TargetHeatingCoolingState.OFF:
            this.platform.fritz("setTempTarget", this.ain, "off");
            currentState = Characteristic.CurrentHeatingCoolingState.OFF;
            break;
        case Characteristic.TargetHeatingCoolingState.AUTO:
            this.platform.fritz("setTempTarget", this.ain, service.fritzTargetTemperature);
            break;
    }

    service.fritzCurrentHeatingCoolingState = currentState;
    service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(currentState);

    callback();
};

FritzThermostatAccessory.prototype.getTargetTemperature = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} target temperature`);

    callback(null, this.services.Thermostat.fritzTargetTemperature);

    this.queryTargetTemperature(); // send query to fritz box; this will also update target/current heating cooling states
};

FritzThermostatAccessory.prototype.setTargetTemperature = function(temperature, callback) {
    this.platform.log(`Setting ${this.type} ${this.ain} target temperature`);

    const service = this.services.Thermostat;

    service.fritzTargetTemperature = temperature;
    service.fritzTargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.AUTO;
    service.fritzCurrentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.HEAT;

    service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(service.fritzTargetHeatingCoolingState);
    service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(service.fritzCurrentHeatingCoolingState);

    this.platform.fritz('setTempTarget', this.ain, temperature).then(temperature => {

        service.getCharacteristic(Characteristic.TargetTemperature).updateValue(temperature);
    });

    callback();
};

FritzThermostatAccessory.prototype.getTemperatureDisplayUnits = function(callback) {
    callback(null, Characteristic.TemperatureDisplayUnits.CELSIUS);
};

FritzThermostatAccessory.prototype.queryTargetTemperature = function() {
    this.platform.fritz('getTempTarget', this.ain).then(temperature => {
        const service = this.services.Thermostat;

        let targetTemperature = temperature;
        let currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.HEAT;
        let targetHeatingCoolingState = service.fritzTargetHeatingCoolingState; // only changes when temperature reads 'off'

        if (temperature === "off") {
            targetTemperature = service.fritzTargetTemperature;
            currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF;
            targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.OFF;
        } else if (temperature === "on") {
            targetTemperature = service.getCharacteristic(Characteristic.TargetTemperature).props.maxValue;
        }

        if (targetHeatingCoolingState === Characteristic.TargetHeatingCoolingState.COOL) {
            currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.COOL;
        }

        service.fritzCurrentHeatingCoolingState = currentHeatingCoolingState;
        service.fritzTargetHeatingCoolingState = targetHeatingCoolingState;

        service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(currentHeatingCoolingState);
        service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(targetHeatingCoolingState);

        if (targetHeatingCoolingState !== Characteristic.TargetHeatingCoolingState.COOL
            && targetHeatingCoolingState !== Characteristic.TargetHeatingCoolingState.HEAT) {
            service.fritzTargetTemperature = targetTemperature;
            service.getCharacteristic(Characteristic.TargetTemperature).updateValue(targetTemperature);
        }
    });
};

FritzThermostatAccessory.prototype.queryNightAndComfortTemperatures = function(sendTargetTempUpdate) {
    const service = this.services.Thermostat;
    const targetHeatingCoolingState = service.fritzTargetHeatingCoolingState;

    let func = undefined;
    if (targetHeatingCoolingState === Characteristic.TargetHeatingCoolingState.COOL) {
        func = "getTempNight";
    } else if (targetHeatingCoolingState === Characteristic.TargetHeatingCoolingState.HEAT) {
        func = "getTempComfort";
    } else {
        return;
    }

    this.platform.fritz(func, this.ain).then(temperature => {
        service.fritzTargetTemperature = temperature; // overwrite the current temperature
        service.getCharacteristic(Characteristic.TargetTemperature).updateValue(temperature);

        if (sendTargetTempUpdate) {
            this.platform.fritz("setTempTarget", this.ain, temperature);
        }
    });
};

FritzThermostatAccessory.prototype.getBatteryLevel = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} battery level`);

    var service = this.services.BatteryService;
    callback(null, service.fritzBatteryLevel);
};

FritzThermostatAccessory.prototype.getChargingState = function(callback) {
    callback(null, Characteristic.ChargingState.NOT_CHARGEABLE);
};

FritzThermostatAccessory.prototype.getStatusLowBattery = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} battery status`);

    var service = this.services.BatteryService;
    callback(null, service.fritzStatusLowBattery);
};

FritzThermostatAccessory.prototype.queryBatteryLevel = function() {
    this.platform.fritz('getBatteryCharge', this.ain).then(batteryLevel => {
        const service = this.services.BatteryService;

        service.fritzBatteryLevel = batteryLevel;
        service.fritzStatusLowBattery = batteryLevel < 20
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

        // update internal value; event get only sent when value changes
        service.getCharacteristic(Characteristic.BatteryLevel).updateValue(service.fritzBatteryLevel);
        service.getCharacteristic(Characteristic.StatusLowBattery).updateValue(service.fritzStatusLowBattery);
    });
};

FritzThermostatAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);

    this.queryCurrentTemperature();
    this.queryTargetTemperature();
    this.queryNightAndComfortTemperatures(false);
    this.queryBatteryLevel();
};
