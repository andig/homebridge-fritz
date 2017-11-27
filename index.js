/**
 * Fritz!Box Platform Plugin for HomeBridge (https://github.com/nfarina/homebridge)
 *
 * @url https://github.com/andig/homebridge-fritz
 * @author Andreas Götz <cpuidle@gmx.de>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 6 */
"use strict";

var fritz = require('fritzapi');
var Promise = require('bluebird');
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



/**
 * FritzPlatform
 */

function FritzPlatform(log, config) {
    this.log = log;
    this.config = config;

    this.options = this.config.options || {};
    this.interval = 1000 * (this.config.interval || 60);  // 1 minute

    // array of hidden devices
    if (!Array.isArray(this.config.hide)) this.config.hide = [];

    // fritz url
    var url = this.config.url || 'http://fritz.box';
    if (!isWebUri(url)) this.log.warn("Invalid Fritz!Box url - forgot http(s)://?");
    // trailing slash
    if (url.substr(-1) == "/") url = url.slice(0, -1);
    this.options.url = url;
        
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
        var accessories = [];
        var self = this;

        fritz.getSessionID(this.config.username, this.config.password, this.options).then(function(sid) {
            self.log("Fritz!Box platform login successful");
            self.log(sid);
            self.sid = sid;
        })
        .then(function() {
            self.log("Discovering accessories");

            // wifi
            if (self.config.hide.indexOf("wifi") == -1) {
                accessories.push(new FritzWifiAccessory(self));
            }

            self.updateDeviceList().then(function(devices) {
                var jobs = [];

                // outlets
                jobs.push(self.fritz("getSwitchList").then(function(ains) {
                    self.log("Outlets found: %s", self.getArrayString(ains));

                    ains.forEach(function(ain) {
                        if (self.config.hide.indexOf(ain) == -1) {
                            accessories.push(new FritzOutletAccessory(self, ain));
                        }
                    });
                }));

                // thermostats
                jobs.push(self.fritz('getThermostatList').then(function(ains) {
                    self.log("Thermostats found: %s", self.getArrayString(ains));

                    ains.forEach(function(ain) {
                        if (self.config.hide.indexOf(ain) == -1) {
                            accessories.push(new FritzThermostatAccessory(self, ain));
                        }
                    });

                    // add remaining non-api devices that support temperature, e.g. Fritz!DECT 100 repeater
                    var sensors = [];
                    devices.forEach(function(device) {
                        if (device.temperature) {
                            var ain = device.identifier.replace(/\s/g, '');
                            if (!accessories.find(function(accessory) {
                                return accessory.ain && accessory.ain == ain;
                            })) {
                                sensors.push(ain);
                                if (self.config.hide.indexOf(ain) == -1) {
                                    accessories.push(new FritzTemperatureSensorAccessory(self, ain));
                                }
                            }
                        }
                    });
                    self.log("Sensors found: %s", self.getArrayString(sensors));
                }));

                Promise.all(jobs).then(function() {
                    callback(accessories);                    
                });
            })
            .catch(function(error) {
                self.log.error("Could not get devices from Fritz!Box. Please check if device supports the smart home API and user has sufficient privileges.");
                callback(accessories);
            });
        })
        .catch(function(error) {
            self.log.debug(error);
            self.log.error("Fritz!Box platform login failed");
        });
    },

    getArrayString: function(array) {
        return array.toString() || "none";
    },

    updateDeviceList: function() {
        return this.fritz("getDeviceList").then(function(devices) {
            // cache list of devices in options for reuse by non-API functions
            this.deviceList = devices;
            return devices;
        }.bind(this));
    },

    getDevice: function(ain) {
        var device = this.deviceList.find(function(device) {
            return device.identifier.replace(/\s/g, '') == ain;
        });
        return device || {}; // safeguard
    },

    getName: function(ain) {
        var dev = this.getDevice(ain);
        return dev.name || ain;
    },

    fritz: function(func) {
        var args = Array.prototype.slice.call(arguments, 1);
        var self = this;

        this.promise = (this.promise || Promise.resolve()).reflect()
            .then(function() {
                var fritzFunc = fritz[func];
                var funcArgs = [self.sid].concat(args).concat(self.options);

                self.log.debug("> %s (%s)", func, JSON.stringify(funcArgs.slice(0,-1)).slice(1,-1));

                return fritzFunc.apply(self, funcArgs).catch(function(error) {
                    if (error.response && error.response.statusCode == 403) {
                        return fritz.getSessionID(self.config.username, self.config.password, self.options).then(function(sid) {
                            self.log("Fritz!Box session renewed");
                            self.log("renewed:"+sid);
                            self.sid = sid;

                            funcArgs = [self.sid].concat(args).concat(self.options);
                            self.log("renewed, now calling:"+funcArgs.toString());
                            return fritzFunc.apply(self, funcArgs);
                        })
                        .catch(function(error) {
                            self.log.warn("Fritz!Box session renewal failed");
                            /* jshint laxbreak:true */
                            throw error === "0000000000000000"
                                ? "Invalid session id"
                                : error;
                        });
                    }

                    throw error;
                });
            })
            .catch(function(error) {
                self.log.debug(error);
                self.log.error("< %s failed", func);
                self.promise = null;

                return Promise.reject(func + " failed");
            })
        ;

        // debug result
        this.promise.then(function(res) {
            self.log.debug("< %s %s", func, JSON.stringify(res));
            return res;
        });

        return this.promise;
    }
};


/**
 * FritzWifiAccessory
 */

function FritzWifiAccessory(platform) {
    this.platform = platform;
    this.name = "Guest WLAN";

    this.services = {
        AccessoryInformation: new Service.AccessoryInformation(),
        Switch: new Service.Switch(this.name)
    };

    this.services.AccessoryInformation
        .setCharacteristic(Characteristic.Manufacturer, "AVM");
    this.services.AccessoryInformation
        .setCharacteristic(Characteristic.Model, "Fritz!Box");

    this.platform.fritz('getOSVersion').then(function(version) {
        this.services.AccessoryInformation
            .setCharacteristic(Characteristic.FirmwareRevision, version);
    }.bind(this));

    this.services.Switch.getCharacteristic(Characteristic.On)
        .on('get', this.getOn.bind(this))
        .on('set', this.setOn.bind(this))
    ;

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzWifiAccessory.prototype.getServices = function() {
    return [this.services.AccessoryInformation, this.services.Switch];
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
    var self = this;

    this.getOn(function(foo, state) {
        self.services.Switch.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context);
    });
};


/**
 * FritzAccessory
 */

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

    this.platform.fritz('getTemperature', this.ain).then(function(temp) {
        callback(null, temp);
    });
};


/**
 * FritzOutletAccessory
 */

inherits(FritzOutletAccessory, FritzAccessory);

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
    if (this.device.temperature) {
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

    this.platform.fritz('getSwitchState', this.ain).then(function(state) {
        callback(null, state);
    });
};

FritzOutletAccessory.prototype.setOn = function(on, callback, context) {
    if (context == FritzPlatform.Context)
        return;

    this.platform.log(`Switching ${this.type} ${this.ain} to ` + on);

    var func = on ? 'setSwitchOn' : 'setSwitchOff';
    this.platform.fritz(func, this.ain).then(function(state) {
        callback(null, state);
    });
};

FritzOutletAccessory.prototype.getInUse = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} in use`);

    this.platform.fritz('getSwitchPower', this.ain).then(function(power) {
        callback(null, power > 0);
    });
};

FritzOutletAccessory.prototype.getPowerUsage = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} power usage`);

    this.platform.fritz('getSwitchPower', this.ain).then(function(power) {
        callback(null, power);
    });
};

FritzOutletAccessory.prototype.getEnergyConsumption = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} energy consumption`);

    this.platform.fritz('getSwitchEnergy', this.ain).then(function(energy) {
        callback(null, energy / 1000.0);
    });
};

FritzOutletAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);
    var self = this;

    // Outlet
    this.getOn(function(foo, state) {
        self.services.Outlet.getCharacteristic(Characteristic.On).setValue(state, undefined, FritzPlatform.Context);
    });

    this.getPowerUsage(function(foo, power) {
        self.services.Outlet.getCharacteristic(FritzPlatform.PowerUsage).setValue(power, undefined, FritzPlatform.Context);
    });

    this.getInUse(function(foo, state) {
        self.services.Outlet.getCharacteristic(Characteristic.OutletInUse).setValue(state, undefined, FritzPlatform.Context);
    });

    this.getEnergyConsumption(function(foo, energy) {
        self.services.Outlet.getCharacteristic(FritzPlatform.EnergyConsumption).setValue(energy, undefined, FritzPlatform.Context);
    });

    // TemperatureSensor
    if (this.services.TemperatureSensor) {
        self.getCurrentTemperature(function(foo, temp) {
            self.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
        });
    }
};


/**
 * FritzThermostatAccessory
 */

inherits(FritzThermostatAccessory, FritzAccessory);

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

    this.platform.fritz('getTempTarget', this.ain).then(function(temp) {
        if (temp == 'off')
            callback(null, Characteristic.CurrentHeatingCoolingState.OFF);
        else
            callback(null, Characteristic.CurrentHeatingCoolingState.HEAT);
    });
};

FritzThermostatAccessory.prototype.getTargetHeatingCoolingState = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} target heating state`);
    var self = this;

    this.platform.fritz('getTempTarget', this.ain).then(function(temp) {
        if (temp == 'off')
            callback(null, Characteristic.TargetHeatingCoolingState.OFF);
        else if (temp == 'on')
            callback(null, Characteristic.TargetHeatingCoolingState.HEAT);
        else
            callback(null, Characteristic.TargetHeatingCoolingState.AUTO);
    });
};

FritzThermostatAccessory.prototype.setTargetHeatingCoolingState = function(state, callback, context) {
    if (context == FritzPlatform.Context)
        return;

    this.platform.log(`Setting ${this.type} ${this.ain} heating state`);
    var self = this, future;

    switch (state) {
        case Characteristic.TargetHeatingCoolingState.OFF:
        case Characteristic.TargetHeatingCoolingState.COOL:
            future = Promise.resolve('off');
            break;
        case Characteristic.TargetHeatingCoolingState.HEAT:
            future = Promise.resolve('on');
            break;
        case Characteristic.TargetHeatingCoolingState.AUTO:
            future = this.getCurrentAutoTemperature();
            break;
    }

    future.then(function(temp) {
        if (temp !== undefined) {
            self.platform.fritz('setTempTarget', self.ain, temp).then(function(temp) {
                callback(null, state);
            });
        }
    });
};

FritzThermostatAccessory.prototype.getCurrentAutoTemperature = function() {
    var self = this;
    return this.platform.updateDeviceList().then(function() {
        var device = self.platform.getDevice(self.ain);
        if (!device.hkr) {
            self.platform.log.error('Could not get thermostat schedule. Fritz!OS outdated?');
            return;
        }

        var hkr = device.hkr;

        // if next change is to comfort temp, we are in night mode
        /* jshint laxbreak:true */
        return fritz.api2temp(hkr.nextchange.tchange === hkr.komfort
            ? hkr.absenk
            : hkr.komfort
        );
    });
};

FritzThermostatAccessory.prototype.getTargetTemperature = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} target temperature`);

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

    this.platform.fritz('getBatteryCharge', this.ain).then(function(battery) {
        callback(null, battery);
    });
};

FritzThermostatAccessory.prototype.getChargingState = function(callback) {
    callback(null, Characteristic.ChargingState.NOT_CHARGEABLE);
};

FritzThermostatAccessory.prototype.getStatusLowBattery = function(callback) {
    this.platform.log(`Getting ${this.type} ${this.ain} battery status`);

    this.platform.fritz('getBatteryCharge', this.ain).then(function(battery) {
        /* jshint laxbreak:true */
        callback(null, battery < 20
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
        );
    });
};

FritzThermostatAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);
    var self = this;

    // Thermostat
    this.getCurrentTemperature(function(foo, temp) {
        self.services.Thermostat.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
    });

    this.getTargetTemperature(function(foo, temp) {
        self.services.Thermostat.getCharacteristic(Characteristic.TargetTemperature).setValue(temp, undefined, FritzPlatform.Context);
    });

    // BatteryService
    this.getBatteryLevel(function(foo, batteryLevel) {
        self.services.BatteryService.getCharacteristic(Characteristic.BatteryLevel).setValue(batteryLevel, undefined, FritzPlatform.Context);
    });

    this.getStatusLowBattery(function(foo, batteryState) {
        self.services.BatteryService.getCharacteristic(Characteristic.StatusLowBattery).setValue(batteryState, undefined, FritzPlatform.Context);
    });
};


/**
 * FritzTemperatureSensorAccessory
 */

inherits(FritzTemperatureSensorAccessory, FritzAccessory);

function FritzTemperatureSensorAccessory(platform, ain) {
    FritzAccessory.apply(this, Array.from(arguments).concat("temperature sensor"));

    extend(this.services, {
        TemperatureSensor: new Service.TemperatureSensor(this.name)
    });

    this.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({minValue: -50})
        .on('get', this.getCurrentTemperature.bind(this))
    ;

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzTemperatureSensorAccessory.prototype.update = function() {
    this.platform.log(`Updating ${this.type} ${this.ain}`);

    // TemperatureSensor
    this.getCurrentTemperature(function(foo, temp) {
        this.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
    }.bind(this));
};
