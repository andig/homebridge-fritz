# homebridge-fritz
[![NPM Version](https://img.shields.io/npm/v/homebridge-fritz.svg)](https://www.npmjs.com/package/homebridge-fritz)
[![NPM Downloads](https://img.shields.io/npm/dt/homebridge-fritz.svg)](https://www.npmjs.com/package/homebridge-fritz)
[![Build status](https://travis-ci.org/andig/homebridge-fritz.svg?branch=master)](https://travis-ci.org/andig/homebridge-fritz)
[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=HGD5E9L28HQHC)


Homebridge platform plugin for FRITZ!Box.

This plugin exposes:

- WLAN guest access switch
- FRITZ!DECT outlets (200, 210)
- FRITZ!Powerline outlets (510, 540)
- FRITZ!DECT (300, 301) and Comet!DECT thermostats
- FRITZ!DECT (400) buttons
- FRITZ!DECT repeaters as temperature sensor (100)
- Window sensors including HAN FUN devices e.g. of Deutsche Telekom

## Installation

Follow the homebridge installation instructions at [homebridge](https://www.npmjs.com/package/homebridge).

Install this plugin globally:

    npm install -g homebridge-fritz

Add platform to `config.json`, for configuration see below.

## Configuration

```json
{
  "platforms": [
    {
      "platform": "FRITZ!Box",
      "name": "My FRITZ!Box",
      "username": "<username>",
      "password": "<password>",
      "url": "http://fritz.box",
      "interval": 60,
      "concurrent": true,
      "devices": {
        "wifi": {
          "name": "Guest WLAN",
          "display": true
        },
        "outlet-1": {
          "TemperatureSensor": false
        },
        "repeater-1": {
          "TemperatureSensor": false
        },
        "thermostat-2": {
          "ContactSensor": false
        },
        "hidden-3": {
          "display": false
        }
      },
      "options": {
        "strictSSL": false
      }
    }
  ]
}

```

The following settings are optional:

- `url`: FRITZ!Box address
- `interval`: polling interval for updating accessories if state was changed outside homebringe
- `concurrent`: set to `false` to avoid concurrent api requests. May work more stable on older FRITZ!Boxes but has slower performance
- `devices`: detailed configuration for individual devices. To be uniquely addressable, each device uses its `AIN` as key. The guest wifi device is always called `wifi`. Supported device configuration options are:
  - `display: false` to disable the device, e.g. useful for main wifi
  - `invert: true` to invert open/closed behaviour of `ContactSensor`
  - `ContactSensor: false` to disable the thermostat's open window `ContactSensor`
  - `TemperatureSensor: false` to disable the temperature sensors for outlets or repeaters
  - the `wifi` device additionally supports the `name` option for setting a custom name for the wifi guest access switch

## Common Issues / Frequently Asked Questions

1. Can't login to the FRITZ!Box

    Some users have reported that logging into the FRITZ!Box internally via `https` fails. This seems to be caused by the FritzApp *occupying* the same port.
    In this case you can connect internally via `http` or use the external IP.

      `FRITZ!Box platform login failed` messages can be caused by invalid login data or wrong url.

    Log messages if the form of:

        { error: { [Error: self signed certificate] code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }

    indicate that there are SSL security problems- most likely due to self-signed certificates. Use the `"strictSSL": false` option to disable the respective check.

2. Unable to update my thermostat

    Current FRITZ!Box firmwares seem to ignore API updates when the thermostat has been key-locked.
    No workaround available- please contact AVM to change this behaviour or don't use the locking mechanism.

3. Unable to update thermostat battery charge

    Battery charge is not an API function. That means that the user must have access to FRITZ!Box administration, not only to the SmartHome API in order to use this functionality.
    Update your FRITZ!Box user accordingly.

4. Can't toggle guest wifi

    Updating guest wifi state requires both a FRITZ!Box username, password and in some cases an https/ssl connection to the FRITZ!Box. If you use the `password only` option (System > FRITZ!Box Users > Login method) of the FRITZ!Box, make sure you provide any random username value at the `"username"` parameter, otherwise `401 - unauthorized` errors may occur.

5. Tips for using thermostat with Home App modes and scenes

    When scenes are used in the Home App, a target temperature have to be set. There are the modes Off and On.
    - Off - Switches off the thermostat
    - On - Set the selected temperature
    * Depending on the target and actual temperature, Homekit shows the thermostat as "cooling" or "heating"

## Debugging

If you experience problems with this plugin please provide a homebridge logfile by running homebridge with debugging enabled:

    homebridge -D

For even more detailed logs set `"debug": true` in the platform configuration.


## Acknowledgements

- homebridge-fritz is based on the [fritzapi](https://github.com/andig/fritzapi) library
- Original non-working fritz accessory https://github.com/tommasomarchionni/homebridge-FRITZBox
- Platform implementation inspired by https://github.com/rudders/homebridge-platform-wemo.
