// Fritz!Box Platform Plugin for HomeBridge (https://github.com/nfarina/homebridge)
//
// @author Andreas Götz <cpuidle@gmx.de>

/* jslint node: true, laxcomma: true */
"use strict";

var fritz = require('smartfritz-promise');
var promise = require('bluebird');
var isWebUri = require('valid-url').isWebUri;
var inherits = require('util').inherits;
var extend = require('extend');
var Service, Characteristic;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    inherits(FritzPlatform.PowerUsage, Characteristic);
    inherits(FritzPlatform.EnergyConsumption, Characteristic);

    homebridge.registerPlatform("homebridge-fritz", "Fritz!Box", FritzPlatform);
};

// inherit before assigning prototypes
inherits(FritzOutletAccessory, FritzAccessory);
inherits(FritzThermostatAccessory, FritzAccessory);

/**
 * FritzPlatform
 */

function FritzPlatform(log, config) {
    this.log = log;
    this.config = config;

    this.options = this.config.options || {};
    this.options.url = this.config.url || 'http://fritz.box';
    this.interval = 1000 * (this.config.interval || 60);  // 1 minute

    // fritz url
    if (!isWebUri(this.options.url)) this.log.warn("Invalid Fritz!Box url - forgot http(s)://?");

    this.promise = null;
}

FritzPlatform.Context = 'FritzPlatform';

FritzPlatform.PowerUsage = function() {
    Characteristic.call(this, 'Power Usage', 'AE48F447-E065-4B31-8050-8FB06DB9E087');

    this.setProps({
        format: Characteristic.Formats.FLOAT,
        unit: 'W',
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });

    this.value = this.getDefaultValue();
};

FritzPlatform.EnergyConsumption = function() {
    Characteristic.call(this, 'Energy Consumption', 'C4805C5B-45B7-4E5B-BFCB-FE43E0FBC1E5');

    this.setProps({
        format: Characteristic.Formats.FLOAT,
        unit: 'kWh',
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });

    this.value = this.getDefaultValue();
};

FritzPlatform.prototype = {
    accessories: function(callback) {
        this.log("Discovering accessories");

        var accessories = [];
        var self = this;

        // wifi
        accessories.push(new FritzWifiAccessory(this));

        this.fritz("getDeviceList").then(function(devices) {
            // cache list of devices in options for reuse by non-API functions
            self.options.deviceList = devices;

            // outlets
            self.fritz("getSwitchList").then(function(ains) {
                self.log("Outlets found: %s", ains.toString());

                ains.forEach(function(ain) {
                    accessories.push(new FritzOutletAccessory(self, ain));
                });

                // thermostats
                self.fritz('getThermostatList').then(function(ains) {
                    self.log("Thermostats found: %s", ains.toString());

                    ains.forEach(function(ain) {
                        accessories.push(new FritzThermostatAccessory(self, ain));
                    });

                    // add remaining non-api devices
                    devices.forEach(function(device) {
                        var ain = device.identifier.replace(/\s/g, '');
                        var unknown = !accessories.find(function(accessory) {
                            return accessory.ain && accessory.ain == ain;
                        });

                        if (unknown && device.temperature) {
                            accessories.push(new FritzTemperatureSensorAccessory(self, ain));
                        }
                    });

                    callback(accessories);
                });
            });
        });
    },

    getDevice: function(ain) {
        if (this.options.deviceList) {
            var device = this.options.deviceList.find(function(device) {
                return device.identifier.replace(/\s/g, '') == ain;
            });
            return device;
        }
        return null;
    },

    getName: function(ain) {
        var dev = this.getDevice(ain);
        return dev ? dev.name || ain : ain;
    },

    fritz: function(func) {
        var args = Array.prototype.slice.call(arguments, 1);
        var self = this;

        this.promise = (this.promise || promise.resolve()).reflect()
            .then(function() {
                var fritzFunc = fritz[func];
                var funcArgs = [self.sid].concat(args).concat(self.options);

                if (self.config.debug)
                    self.log.debug("> %s (%s)", func, JSON.stringify(funcArgs.slice(0,-1)).slice(1,-1));

                return fritzFunc.apply(self, funcArgs).catch(function(error) {
                    if (error.response && error.response.statusCode == 403) {
                        return fritz.getSessionID(self.config.username, self.config.password, self.options).then(function(sid) {
                            self.log("Fritz!Box platform login successful");
                            self.sid = sid;

                            funcArgs = [self.sid].concat(args).concat(self.options);
                            return fritzFunc.apply(self, funcArgs);
                        });
                    }

                    throw error;
                });
            })
            .catch(function(error) {
                self.log.warn("> %s failed - retrying in 3 seconds", func);
                self.log.warn(error);

                return promise.delay(3000).then(function() {
                    self.promise = null;
                    return self.fritz.apply(self, [func].concat(args));
                });
            })
        ;

        if (this.config.debug) {
            this.promise.then(function(res) {
                self.log.debug("> %s %s", func, JSON.stringify(res));
                return res;
            });
        }

        return this.promise;
    }
};


/**
 * FritzWifiAccessory
 */

function FritzWifiAccessory(platform) {
    this.platform = platform;
    this.name = "Guest WLAN";

    this.service = new Service.Switch(this.name);

    this.service.getCharacteristic(Characteristic.On)
        .on('get', this.getOn.bind(this))
        .on('set', this.setOn.bind(this))
    ;

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzWifiAccessory.prototype.getServices = function() {
    return [this.service];
};

FritzWifiAccessory.prototype.getOn = function(callback) {
    this.platform.log("Getting guest WLAN state");

    this.platform.fritz('getGuestWlan').then(function(res) {
        callback(null, res.activate_guest_access);
    });
};

FritzWifiAccessory.prototype.setOn = function(on, callback, context) {
    if (context == FritzPlatform.Context)
        return;

    this.platform.log("Switching guest WLAN to " + on);

    this.platform.fritz('setGuestWlan', on ? true : false).then(function(res) {
        callback(null, res.activate_guest_access);
    });
};

FritzWifiAccessory.prototype.update = function() {
    this.platform.log("Updating guest WLAN");

    this.platform.fritz('getGuestWlan').then(function(res) {
        this.service.getCharacteristic(Characteristic.On).setValue(res.activate_guest_access, undefined, FritzPlatform.Context);
    }.bind(this));
};


/**
 * FritzAccessory
 */

function FritzAccessory(platform, ain) {
    this.platform = platform;
    this.ain = ain;
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


/**
 * FritzOutletAccessory
 */

function FritzOutletAccessory(platform, ain) {
    FritzAccessory.apply(this, arguments);

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
    if (this.device.temperature) {
        extend(this.services, {
            TemperatureSensor: new Service.TemperatureSensor(this.name)
        });

        this.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this))
        ;
    }

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzOutletAccessory.prototype.getOn = function(callback) {
    this.platform.log("Getting outlet " + this.ain + " state");

    this.platform.fritz('getSwitchState', this.ain).then(function(state) {
        callback(null, state);
    });
};

FritzOutletAccessory.prototype.setOn = function(on, callback, context) {
    if (context == FritzPlatform.Context)
        return;

    this.platform.log("Switching outlet " + this.ain + " to " + on);

    var func = on ? 'setSwitchOn' : 'setSwitchOff';
    this.platform.fritz(func, this.ain).then(function(state) {
        callback(null, state);
    });
};

FritzOutletAccessory.prototype.getInUse = function(callback) {
    this.platform.log("Getting outlet " + this.ain + " in use");

    this.platform.fritz('getSwitchPower', this.ain).then(function(power) {
        callback(null, power > 0);
    });
};

FritzOutletAccessory.prototype.getPowerUsage = function(callback) {
    this.platform.log("Getting outlet " + this.ain + " power usage");

    this.platform.fritz('getSwitchPower', this.ain).then(function(power) {
        callback(null, power);
    });
};

FritzOutletAccessory.prototype.getEnergyConsumption = function(callback) {
    this.platform.log("Getting outlet " + this.ain + " energy consumption");

    this.platform.fritz('getSwitchEnergy', this.ain).then(function(energy) {
        callback(null, energy / 1000.0);
    });
};

FritzOutletAccessory.prototype.getCurrentTemperature = function(callback) {
    this.platform.log("Getting outlet " + this.ain + " temperature");

    this.platform.fritz('getTemperature', this.ain).then(function(temp) {
        callback(null, temp);
    });
};

FritzOutletAccessory.prototype.update = function() {
    this.platform.log("Updating outlet " + this.ain);
    var self = this;

    this.platform.fritz('getSwitchState', this.ain).then(function(state) {
        self.services.Outlet.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context);

        self.platform.fritz('getSwitchPower', self.ain).then(function(power) {
            self.services.Outlet.getCharacteristic(FritzPlatform.PowerUsage).setValue(power, undefined, FritzPlatform.Context);
            self.services.Outlet.getCharacteristic(Characteristic.OutletInUse).setValue(power > 0, undefined, FritzPlatform.Context);

            self.platform.fritz('getSwitchEnergy', self.ain).then(function(energy) {
                self.services.Outlet.getCharacteristic(FritzPlatform.EnergyConsumption).setValue(energy / 1000.0, undefined, FritzPlatform.Context);
            });  

            if (self.services.TemperatureSensor) {            
                self.platform.fritz('getTemperature', self.ain).then(function(temp) {
                    self.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
                });
            }
        });
    });
};


/**
 * FritzThermostatAccessory
 */

function FritzThermostatAccessory(platform, ain) {
    FritzAccessory.apply(this, arguments);

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
    ;
    this.services.Thermostat.getCharacteristic(Characteristic.CurrentTemperature)
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
    this.platform.log("Getting thermostat " + this.ain + " heating state");

    this.platform.fritz('getTempTarget', this.ain).then(function(temp) {
        if (temp == 'off')
            callback(null, Characteristic.CurrentHeatingCoolingState.OFF);
        else
            callback(null, Characteristic.CurrentHeatingCoolingState.HEAT);
    });
};

FritzThermostatAccessory.prototype.getTargetHeatingCoolingState = function(callback) {
    callback(null, Characteristic.TargetHeatingCoolingState.AUTO);
};

FritzThermostatAccessory.prototype.getCurrentTemperature = function(callback) {
    this.platform.log("Getting thermostat " + this.ain + " temperature");

    this.platform.fritz('getTemperature', this.ain).then(function(temp) {
        callback(null, temp);
    });
};

FritzThermostatAccessory.prototype.getTargetTemperature = function(callback) {
    this.platform.log("Getting thermostat " + this.ain + " target temperature");

    this.platform.fritz('getTempTarget', this.ain).then(function(temp) {
        if (temp == 'off')
            callback(null, this.services.Thermostat.getCharacteristic(Characteristic.TargetTemperature).props.minValue);
        else if (temp == 'on')
            callback(null, this.services.Thermostat.getCharacteristic(Characteristic.TargetTemperature).props.maxValue);
        else
            callback(null, temp);
    }.bind(this));
};

FritzThermostatAccessory.prototype.setTargetTemperature = function(temp, callback, context) {
    if (context == FritzPlatform.Context)
        return;
    
    this.platform.log("Setting thermostat " + this.ain + " target temperature");

    this.platform.fritz('setTempTarget', this.ain, temp).then(function(temp) {
        callback(null, temp);
    });
};

FritzThermostatAccessory.prototype.getTemperatureDisplayUnits = function(callback) {
    callback(null, Characteristic.TemperatureDisplayUnits.CELSIUS);
};

FritzThermostatAccessory.prototype.getBatteryLevel = function(callback) {
    this.platform.log("Getting thermostat " + this.ain + " battery level");

    this.platform.fritz('getBatteryCharge', this.ain).then(function(battery) {
        callback(null, battery);
    });
};

FritzThermostatAccessory.prototype.getChargingState = function(callback) {
    callback(null, Characteristic.ChargingState.NOT_CHARGING);
};

FritzThermostatAccessory.prototype.getStatusLowBattery = function(callback) {
    this.platform.fritz('getBatteryCharge', this.ain).then(function(battery) {
        /* jshint laxbreak:true */
        callback(null, battery < 20 
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
        );
    });
};

FritzThermostatAccessory.prototype.update = function() {
    this.platform.log("Updating thermostat " + this.ain);

    this.platform.fritz('getTemperature', this.ain).then(function(temp) {
        this.services.Thermostat.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
    }.bind(this));
};


/**
 * FritzTemperatureSensorAccessory
 */

function FritzTemperatureSensorAccessory(platform, ain) {
    FritzAccessory.apply(this, arguments);

    extend(this.services, {
        TemperatureSensor: new Service.TemperatureSensor(this.name)
    });

    this.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', this.getCurrentTemperature.bind(this))
    ;

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzTemperatureSensorAccessory.prototype.getCurrentTemperature = function(callback) {
    this.platform.log("Getting temperature sensor " + this.ain + " temperature");

    this.platform.fritz('getTemperature', this.ain).then(function(temp) {
        callback(null, temp);
    });
};

FritzTemperatureSensorAccessory.prototype.update = function() {
    this.platform.log("Updating temperature sensor " + this.ain);

    this.platform.fritz('getTemperature', this.ain).then(function(temp) {
        this.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
    }.bind(this));
};
