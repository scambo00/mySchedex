/**
 The MIT License (MIT)

 Copyright (c) 2016 @biddster

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

module.exports = function (RED) {
    'use strict';

    var moment = require('moment-timezone');
	var SunCalc = require('suncalc');
    var _ = require("lodash");
    var fmt = 'YYYY-MM-DD HH:mm';
	var timezoner = require('timezoner');

    RED.nodes.registerType('mySchedex', function (config) {
        RED.nodes.createNode(this, config);
        var node = this,
            on = setupEvent('on', 'dot'),
            off = setupEvent('off', 'ring');
        on.inverse = off;
        off.inverse = on;
		
		node.weekday = new Array(7);
        node.weekday[0]=  config.sun;
        node.weekday[1] = config.mon;
        node.weekday[2] = config.tue;
        node.weekday[3] = config.wed;
        node.weekday[4] = config.thu;
        node.weekday[5] = config.fri;
        node.weekday[6] = config.sat;
				
		/* Request timezone with location coordinates */
	    timezoner.getTimeZone(
            config.lat, // Latitude coordinate
            config.lon, // Longitude coordinate
            function (err, data) {
                if (err) {
                    node.status({fill: 'red', shape: 'dot', text: 'timezone error'});
					//add node warning
                } else {
                    moment.tz.setDefault(data.timeZoneId);
			    }
            }
        );

        node.on('input', function (msg) {
            var handled = false;
            // TODO - with these payload options, we can't support on and ontime etc.
            if (msg.payload === 'on') {
                handled = true;
                send(on, true);
            }
            if (msg.payload === 'off') {
                handled = true;
                send(off, true);
            }
            if (msg.payload === 'suspended') {
                handled = true;
                config.suspended = true;
                bootstrap();
            }
			if (msg.payload === 'resume') {
				handled = true;
				config.suspended = false;
				bootstrap();
			}
            if (msg.payload.hasOwnProperty('ontime')) {
                handled = true;
                on.time = msg.payload.ontime;
                if (!config.suspended) {
                    schedule(on);
                }
            }
            if (msg.payload.hasOwnProperty('offtime')) {
                handled = true;
                off.time = msg.payload.offtime;
                if (!config.suspended) {
                    schedule(off);
                }
            }
            if (!handled) {
                node.status({fill: 'red', shape: 'dot', text: 'Unsupported input'});
            }
        });

        node.on('close', suspend);

        function setupEvent(eventName, shape) {
            var filtered = _.pickBy(config, function (value, key) {
                return key && key.indexOf(eventName) === 0;
            });
            var event = _.mapKeys(filtered, function (value, key) {
                return key.substring(eventName.length).toLowerCase();
            });
            event.name = eventName.toUpperCase();
            event.shape = shape;
            event.callback = function () {
                send(event);
                schedule(event);
            };
            return event;
        }

        function send(event, manual) {

			if(weekday[moment().day()]){
				node.send({topic: event.topic, payload: event.payload});
                node.status({
                fill: manual ? 'blue' : 'green',
                shape: event.shape,
                text: event.name + (manual ? ' manual' : ' auto') + (config.suspended ? ' - scheduling suspended' : (' until ' + event.inverse.moment.format(fmt)))
                });
			}
			else{
				node.status({
                fill: 'grey',
                shape: 'dot',
                text: ' scheduling suspended today'
                });
			}
        }

        function schedule(event, isInitial) {
            var now = moment();
            var matches = new RegExp(/(\d+):(\d+)/).exec(event.time);
            if (matches && matches.length) {
                // Don't use 'now' here as hour and minute mutate the moment.
                event.moment = moment().hour(matches[1]).minute(matches[2]);
            } else {
                var sunCalcTimes = SunCalc.getTimes(new Date(), config.lat, config.lon);
                var date = sunCalcTimes[event.time];
                if (date) {
                    event.moment = moment(date);
                }
            }
            if (event.moment) {
                event.moment.seconds(0);
                if (!isInitial || isInitial && now.isAfter(event.moment)) {
                    event.moment.add(1, 'day');
                }
                if (event.offset) {
                    var adjustment = event.offset;
                    if (event.randomoffset) {
                        adjustment = event.offset * Math.random();
                    }
                    event.moment.add(adjustment, 'minutes');
                }

                var delay = event.moment.diff(now);
                if (event.timeout) {
                    clearTimeout(event.timeout);
                }
                event.timeout = setTimeout(event.callback, delay);
            } else {
                node.status({fill: 'red', shape: 'dot', text: 'Invalid time: ' + event.time});
            }
        }

        function suspend() {
            clearTimeout(on.timeout);
            clearTimeout(off.timeout);
            node.status({fill: 'grey', shape: 'dot', text: 'Scheduling suspended - manual mode only'});
        }

        function resume() {
            schedule(on, true);
            schedule(off, true);
            var firstEvent = on.moment.isBefore(off.moment) ? on : off;
            var message = firstEvent.name + ' ' + firstEvent.moment.format(fmt) + ', ' +
                firstEvent.inverse.name + ' ' + firstEvent.inverse.moment.format(fmt);
            node.status({fill: 'yellow', shape: 'dot', text: message});
        }

        function bootstrap() {
            if (config.suspended) {
                suspend();
            } else {
                resume();
            }
        }

        bootstrap();
    });
};