
/**
 * App ID for the skill
 */
var APP_ID = 'amzn1.echo-sdk-ams.app.09907f8d-f282-427d-8832-2f33fc631908';

var geocodeConfig = {
    apiKey: process.env.GOOGLE_API_KEY,
    formatter: null
};
    

var http = require('http'),
    https = require('https'),
    rp = require('request-promise'),
    storage = require('./storage'),
    geocoder = require('node-geocoder')('google',undefined,geocodeConfig),
    _ = require('lodash'),
    Promise = require('promise'),
    geolib = require('geolib');

/**
 * The AlexaSkill prototype and helper functions
 */
var AlexaSkill = require('./AlexaSkill');

/**
 * Citibike is a child of AlexaSkill.
*/
var Citibike = function () {
    AlexaSkill.call(this, APP_ID);
};

// Extend AlexaSkill
Citibike.prototype = Object.create(AlexaSkill.prototype);
Citibike.prototype.constructor = Citibike;

Citibike.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
    console.log("Citibike onSessionStarted requestId: " + sessionStartedRequest.requestId
        + ", sessionId: " + session.sessionId);
    
    session.attributes.stationPromise = getStationFeed();
};

Citibike.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
    console.log("Citibike onLaunch requestId: " + launchRequest.requestId + ", sessionId: " + session.sessionId);
    handleLaunchRequest(session, response);
};

Citibike.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
    console.log("Citibike onSessionEnded requestId: " + sessionEndedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any cleanup logic goes here
};

Citibike.prototype.intentHandlers = {
    // register custom intent handlers
    "FindBikeIntent": function (intent, session, response) {
        handleFindBikeIntent(intent, session, response);
    },
    "AddAddressIntent" : function (intent, session, response) {
        handleAddAddressIntent(intent, session, response);
    },
    "AMAZON.HelpIntent": function (intent, session, response) {
        response.ask("You can say hello to me!", "You can say hello to me!");
    }
};

/**
 * Event Handler Functions
 */

function handleLaunchRequest(session, response) {


     storage.loadAddress(session, function(address) {
        console.log(address);
        var speech = '';

        if (address.data.zip === 0) {
            speech += "Welcome to Citibike. There is currently no address set for your home."
                + "You can add one by asking me to add address, followed by your street address and your zipcode.";
        }
        else {
            speech += "Welcome to City Bike. I have your address on file. You can ask me, where is the closest bike, or find me a bike."
        }

        response.tell(speech);


    });
}


/**
 * Intent Handler Functions
 */

function handleFindBikeIntent(intent, session, response) {

    storage.loadAddress(session, function(address) {
        var speech = '',
            stationFeedPromise,
            closestStations,
            bikesAvailable = false,
            speechOutput = '';

        if (address.data.zip === 0) {
            speech += "Welcome to Citibike. There is currently no address set for your home."
                + "You can add one by asking me to add an address, followed by your street address and your zipcode.";
            response.tell(speech);
            return false;
        }

        stationFeedPromise = session.attributes.stationPromise;
        closestStations = address.data.closestStations;

        stationFeedPromise.then(function(feed) {

            //Run through each station and determine if it has bikes.
            //TODO: Handle if the station has only a few bikes left
            var currentStationData = {};
            _.some(closestStations, function(station) { 
                currentStationData = _.find(feed, ['id', station.id]);

                //TODO: Handle if station isn't in feed

                //TODO: Handle if bikes are low
                if (currentStationData.availableBikes > 0) {
                    bikesAvailable = true;
                    speechOutput += currentStationData.stationName 
                        + " has " + currentStationData.availableBikes
                        + " bikes available."
                    return true;
                }
                //Next iteration
                else {
                    return false;
                }
            });

            if (!bikesAvailable) {
                speechOutput = "No bikes were availble near you."
            }

            response.tell(speechOutput);
        });

    });
}

function handleAddAddressIntent(intent, session, response) {

    storage.loadAddress(session, function(currentAddress) {

        //TODO: Handle address already saved 
        //
        //TODO: Handle empty address here
        if (intent.slots.Address.value === undefined) {

        }

        
        //Use Google Geocode service to attach a latitude/longitude
        geocoder.geocode(intent.slots.Address.value)
            .then(function(res) {
                saveNewAddress(res, currentAddress, session, response);
            })
            .catch(function(err) {
                //TODO: Handle no address found

            });

    });

}

function handleAddressQueryIntent(intent, session, response) {

}

/**
 * Citibike specific functions
 */

var CLOSE_STATIONS_TO_RETURN = 5;

function getClosestStations(stations, lat, long) {

    var stationsToReturn = CLOSE_STATIONS_TO_RETURN || 5,
        stationDistances = [],
        distance;


    //Return error 
    if (!stations) {
        return false;
    }

    _.each(stations, function (station, index) {
        distance = geolib.getDistance(
            {latitude: station.latitude, longitude: station.longitude},
            {latitude: lat, longitude: long}
        );

        stationDistances.push({
            id: station.id,
            name: station.stationName,
            distance: distance
        });
    })

    stationDistances = stationDistances
    .sort(function (a, b) {
        return a.distance - b.distance;
    })
    .slice(0, stationsToReturn);

    return stationDistances;

}

//Eventually cache at elasticache
function getStationFeed () {

    var endpoint = 'http://www.citibikenyc.com/stations/json';

    var stationPromise = new Promise(function(resolve, reject) {

        http.get(endpoint, function (res) {
            var response = ''
            res.on('data', function (data) {
                response += data;
            })

            res.on('end', function () {
                stations = JSON.parse(response);
                resolve(stations.stationBeanList);
            });

        }).on('error', function (e) {
            reject(e);
        });

    });

    return stationPromise;
}

function saveNewAddress (geocodeRes, currentAddress, session, response) {

    if (geocodeRes.length) {
        var firstAddress = geocodeRes[0];

        currentAddress.data = _.merge(currentAddress.data, {
            latitude: firstAddress.latitude,
            longitude: firstAddress.longitude,
            formattedAddress: firstAddress.formattedAddress
        });

        //Find the closest stations
        session.attributes.stationPromise.then(function(stations) {

            currentAddress.data.closestStations = getClosestStations(stations, firstAddress.latitude, firstAddress.longitude);

            currentAddress.save(function() {

                var speechOutput = "OK. Your address has been saved as " 
                + firstAddress.formattedAddress + ". You can now ask, "
                + "find me the closest bike."

                response.tell(speechOutput);
                return;
            });
        });

    }
    
}

// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
    // Create an instance of the Citibike skill.
    var citibike = new Citibike();
    citibike.execute(event, context);
};


