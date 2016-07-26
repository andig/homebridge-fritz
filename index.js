// Fritz!Box Platform Plugin for HomeBridge (https://github.com/nfarina/homebridge)
//
// @author Andreas Götz <cpuidle@gmx.de>

/*jslint node: true */
"use strict";

var fritz = require('smartfritz-promise');
var promise = require('bluebird');
var isWebUri = require('valid-url').isWebUri;
var inherits = require('util').inherits;
var Service, Accessory, Characteristic;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;

    inherits(FritzPlatform.PowerUsage, Characteristic);

    homebridge.registerPlatform("homebridge-fritz", "Fritz!Box", FritzPlatform);
};


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

                    callback(accessories);
                });
            });
        });
    },

    getDevice: function(ain) {
        var name;
        if (this.options.deviceList) {
            name = this.options.deviceList.find(function(device) {
                return device.identifier.replace(/\s/g, '') == ain;
            });
        }
        return name || ain;
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
                    self.log("> %s (%s)", func, JSON.stringify(funcArgs.slice(0,-1)).slice(1,-1));

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
                self.log.error(error);

                return promise.delay(3000).then(function() {
                    self.promise = null;
                    return self.fritz.apply(self, [func].concat(args));
                });
            })
        ;

        if (this.config.debug) {
            this.promise.then(function(res) {
                self.log("> %s %s", func, JSON.stringify(res));
                return res;
            });
        }

        return this.promise;
    },

    getServices: function(services) {
        return Object.keys(services).map(function(key) {
            return services[key];
        });        
    }
};


/**
 * FritzWifiAccessory
 */

function FritzWifiAccessory(platform) {
    this.platform = platform;
    this.name = "Guest WLAN";

    this.service = new Service.Switch("Guest WLAN");

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
 * FritzOutletAccessory
 */

function FritzOutletAccessory(platform, ain) {
    this.platform = platform;
    this.ain = ain;
    this.name = this.platform.getName(this.ain);

    var device = this.platform.getDevice(this.ain);

    this.services = {
        AccessoryInformation: new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, device.manufacturer)
            .setCharacteristic(Characteristic.Model, device.productname)
        ,
        Outlet: new Service.Outlet(this.ain),
        TemperatureSensor: new Service.TemperatureSensor(this.ain)
    };

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

    this.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', this.getCurrentTemperature.bind(this))
    ;

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzOutletAccessory.prototype.getServices = function() {
    return this.platform.getServices(this.services);
};

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
            self.services.Outlet.getCharacteristic(Characteristic.OutletInUse).setValue(power > 0, undefined, FritzPlatform.Context);
            self.services.Outlet.getCharacteristic(FritzPlatform.PowerUsage).setValue(power, undefined, FritzPlatform.Context);

            self.platform.fritz('getTemperature', self.ain).then(function(temp) {
                self.services.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
            });
        });
    });
};


/**
 * FritzThermostatAccessory
 */

function FritzThermostatAccessory(platform, ain) {
    this.platform = platform;
    this.ain = ain;
    this.name = this.platform.getName(this.ain);

    var device = this.platform.getDevice(this.ain);

    this.services = {
        AccessoryInformation: new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, device.manufacturer)
            .setCharacteristic(Characteristic.Model, device.productname)
        ,
        Thermostat: new Service.Thermostat(this.ain)
    }

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

    setInterval(this.update.bind(this), this.platform.interval);
}

FritzThermostatAccessory.prototype.getServices = function() {
    return this.platform.getServices(this.services);
};

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

FritzThermostatAccessory.prototype.update = function() {
    this.platform.log("Updating thermostat " + this.ain + " temperature");

    this.platform.fritz('getTemperature', this.ain).then(function(temp) {
        this.services.Thermostat.getCharacteristic(Characteristic.CurrentTemperature).setValue(temp, undefined, FritzPlatform.Context);
    }.bind(this));
};
