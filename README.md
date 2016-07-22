# homebridge-fritz

Homebridge platform plugin for FRITZ!Box.

This plugin exposes:

  - Wlan guest access switch
  - Fritz!DECT outlets
  - Comet!DECT thermostats


## Installation

Follow the homebridge installation instructions at [homebridge](https://www.npmjs.com/package/homebridge).

Install this plugin globally:

```
npm install -g homebridge-fritz
```

Add platform to `config.json`, for configuration see below.


## Configuration

```
{
  "platforms": [
    {
      "platform": "Fritz!Box",
      "name": "My FritzBox",
      "username": "<username>",
      "password": "<password>",
      "url": "192.168.0.1",
      "interval": 60,
      "debug": false
    }
  ]
}

```

The `url`, `interval` and `debug` settings are optional:

  - `url`: Fritz!Box address
  - `interval`: polling interval for updating accessories if state was changed outside homebringe
  - `debug`: if true the smartfritz API calls are logged


## Acknowledgements

  - Original non-working fritz accessory https://github.com/tommasomarchionni/homebridge-FRITZBox
  - Platform implementation inspired by https://github.com/rudders/homebridge-platform-wemo.
