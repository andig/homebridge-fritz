/**
 * FritzPlatform
 *
 * @url https://github.com/andig/homebridge-fritz
 * @author Andreas Götz <cpuidle@gmx.de>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 6 */
"use strict";

var dotProp = require('dot-prop');
var fritz = require('fritzapi');
var Promise = require('bluebird');
var isWebUri = require('valid-url').isWebUri;
var inherits = require('util').inherits;
var mutex = require('async-mutex').Mutex;
var Characteristic, Homebridge;

module.exports = function(homebridge) {
    Homebridge = homebridge;
    Characteristic = homebridge.hap.Characteristic;

    inherits(FritzPlatform.PowerUsage, Characteristic);
    inherits(FritzPlatform.EnergyConsumption, Characteristic);

    return FritzPlatform;
};

function FritzPlatform(log, config) {
    this.log = log;
    this.config = config;

    this.options = this.config.options || {};
    this.interval = 1000 * (this.config.interval || 60);  // 1 minute

    this.pending = 0; // pending requests

    // device configuration
    this.config.devices = this.config.devices || {};
    if (typeof this.config.hide !== "undefined") {
        this.log.warn('Deprecated `hide` setting is ignored. Use `devices` instead');
    }

    // fritz url
    var url = this.config.url || 'http://fritz.box';
    if (!isWebUri(url)) this.log.warn("Invalid Fritz!Box url - forgot http(s)://?");
    // trailing slash
    if (url.substr(-1) == "/") url = url.slice(0, -1);
    this.options.url = url;

    this.promise = null;
}

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
            self.sid = sid;
        })
        .then(function() {
            self.log("Discovering accessories");

            // wifi
            if (self.deviceConfig("wifi.display", true)) {
                let FritzWifiAccessory = require('./accessories/wifi')(Homebridge);
                accessories.push(new FritzWifiAccessory(self));
            }

            self.updateDeviceList().then(function(devices) {
                var jobs = [];

                // outlets
                jobs.push(self.fritz("getSwitchList").then(function(ains) {
                    self.log("Outlets found: %s", self.getArrayString(ains));
                    let FritzOutletAccessory = require('./accessories/outlet')(Homebridge);

                    ains.forEach(function(ain) {
                        if (self.deviceConfig(`${ain}.display`, true)) {
                            accessories.push(new FritzOutletAccessory(self, ain));
                        }
                    });
                }));

                // thermostats
                jobs.push(self.fritz('getThermostatList').then(function(ains) {
                    self.log("Thermostats found: %s", self.getArrayString(ains));
                    let FritzThermostatAccessory = require('./accessories/thermostat')(Homebridge);

                    ains.forEach(function(ain) {
                        if (self.deviceConfig(`${ain}.display`, true)) {
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
                            }
                        }
                    });

                    if (sensors.length) {
                        let FritzTemperatureSensorAccessory = require('./accessories/temperaturesensor')(Homebridge);

                        sensors.forEach(function(ain) {
                            if (self.deviceConfig(`${ain}.display`, true) &&
                                self.deviceConfig(`${ain}.TemperatureSensor`, true)
                            ) {
                                accessories.push(new FritzTemperatureSensorAccessory(self, ain));
                            }
                        });
                    }
                    self.log("Sensors found: %s", self.getArrayString(sensors));
                }));

                // alarm sensors
                var alarms = [];
                devices.forEach(function(device) {
                    // @TODO deduplicate alarms similar to temp sensors
                    if (device.alert) {
                        alarms.push(device.identifier);
                    }
                });

                if (alarms.length) {
                    let FritzAlarmSensorAccessory = require('./accessories/alarmsensor')(Homebridge);

                    alarms.forEach(function(ain) {
                        if (self.deviceConfig(`${ain}.display`, true) &&
                            self.deviceConfig(`${ain}.ContactSensor`, true)
                        ) {
                            accessories.push(new FritzAlarmSensorAccessory(self, ain));
                        }
                    });
                }
                self.log("Alarm sensors found: %s", self.getArrayString(alarms));

                // buttons
                var buttons = [];
                devices.forEach(function (device) {
                    let FritzButtonAccessory = require('./accessories/button')(Homebridge);

                    if (device.button) {
                        var ain = device.identifier.replace(/\s/g, '');
                        if (!accessories.find(function (accessory) {
                            return accessory.ain && accessory.ain == ain;
                        })) {
                            buttons.push(ain);

                            if (self.deviceConfig(`${ain}.display`, true)) {
                                device.button.forEach(function(button, index) {
                                    accessories.push(new FritzButtonAccessory(self, ain, index, button.name));
                                });
                            }
                        }
                    }
                });
                self.log("Buttons found: %s", self.getArrayString(buttons));

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
            self.log.error("Initializing Fritz!Box platform accessories failed - wrong user credentials?");
        });
    },

    deviceConfig: function(key, defaultValue) {
        return dotProp.get(this.config.devices, key, defaultValue)
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

        // api call tracking
        if (self.config.concurrent !== false) {
            this.promise = null;
        }
        else if ((this.promise || Promise.resolve()).isPending()) {
            this.pending++;
            this.log.debug('%s pending api calls', this.pending);
        }

        this.promise = (this.promise || Promise.resolve()).reflect().then(function() {
            self.pending = Math.max(self.pending-1, 0);

            var fritzFunc = fritz[func];
            var funcArgs = [self.sid].concat(args).concat(self.options);

            self.log.debug("> %s (%s)", func, JSON.stringify(funcArgs.slice(0,-1)).slice(1,-1));

            return fritzFunc.apply(self, funcArgs).catch(function(error) {
                if (error.response && error.response.statusCode == 403) {
                    // self.renewSession().then(function(sid) {
                    // session renewal protected by mutex
                    mutex.runExclusive(self.renewSession).then(function(sid) {
                        funcArgs = [self.sid].concat(args).concat(self.options);
                        self.log("renewed, now calling:" + funcArgs.toString());
                        return fritzFunc.apply(self, funcArgs);
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
        });

        // debug result
        this.promise.then(function(res) {
            self.log.debug("< %s %s", func, JSON.stringify(res));
            return res;
        });

        return this.promise;
    },

    renewSession: function () {
        return fritz.getSessionID(self.config.username, self.config.password, self.options).then(function (sid) {
            self.log("Fritz!Box session renewed");
            self.log("renewed:" + sid);
            self.sid = sid;
            return sid;
        })
        .catch(function (error) {
            self.log.warn("Fritz!Box session renewal failed");
            /* jshint laxbreak:true */
            throw error === "0000000000000000"
                ? "Invalid session id"
                : error;
        });
    },

    fritzApi: function() {
        return fritz;
    }
};
