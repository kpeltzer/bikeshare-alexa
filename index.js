
/**
 * App ID for the skill
 */
var APP_ID = 'amzn1.echo-sdk-ams.app.09907f8d-f282-427d-8832-2f33fc631908';

var geocodeConfig = {
    apiKey: process.env.GOOGLE_API_KEY,
    formatter: null
};

//Number of Bike Stations to associate with address
var CLOSE_STATIONS_TO_RETURN = 5;

/**
 * Locales to ensure an address falls into range of a bike system. 
 * @type {Object}
 */
var SYSTEM_LOCALES = {
    'citibike' : [
        'New York County',
        'Kings County',
        'Queens County',
        'Richmond County',
        'Bronx County'
    ]
};
    
//Required Modules
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
    
    //Load current feed on session start
    stationPromise = getStationFeed();
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
    "OverwriteAddressIntent" : function (intent, session, response) {
        handleOverwriteAddressIntent(intent, session, response);
    },
    "KeepAddressIntent" : function (intent, session, response) {
        handleKeepAddressIntent(intent, session, response);
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
        var speech = '',
            reprompt = '';

        //TODO: Do a reprompt here
        if (address.data.zip === 0) {

            speech += "Welcome to Citibike. There is currently no address set for your home."
                + "You can add one by asking me to add address, followed by your street address and your zipcode.";

            reprompt += "<speak>Before you find any bikes, you first need to add an address. "
                + "You can add one by asking me to add address, followed by your street address and your zipcode."
                + "For example, you can say add address <say-as interpret-as\"address\">"
                + "1234 Broadway, 10001.</say-as></speak>";
        }
        else {
            speech += "Welcome to City Bike. I have your address on file. You can ask me, where is the closest bike, or find me a bike."
            reprompt +="<speak>Since I have your address on file, you can ask me, find me a bike, and I'll give you "
                + "the closest station to you with bikes available.";
        }

        response.tell(
            {speech: speech},
            {speech: reprompt, type: AlexaSkill.speechOutputType.SSML}
        );


    });
}


/**
 * Intent Handler Functions
 */

function handleFindBikeIntent(intent, session, response) {

    var LOW_BIKE_THRESHOLD = 3;

    storage.loadAddress(session, function(address) {
        var speech = '',
            stationFeedPromise,
            closestStations,
            bikesAvailable = false,
            bikeWord = 'bike',
            speechOutput = '';

        if (address.data.zip === 0) {
            speech += "Welcome to City Bike. There is currently no address set for your home."
                + "You can add one by asking me to add an address, followed by your street address and your zipcode.";
            response.tell(speech);
            return false;
        }

        closestStations = address.data.closestStations;

        stationPromise.then(function(feed) {

            //Run through each station and determine if it has bikes.
            var currentStationData = {},
                availableBikes,
                lowBikeThreshold = false,
                stationAddress = '';
            _.some(closestStations, function(station) { 

                currentStationData = _.find(feed, ['id', station.id]);

                //Saved station isn't in feed
                if (_.isUndefined(currentStationData)) {
                    return false;
                }

                availableBikes = currentStationData.availableBikes;

                if (availableBikes > 0) {
                    bikesAvailable = true;
                    bikeWord += availableBikes === 1 ? '' : 's';
                    stationAddress = formatBikeStationAddress(currentStationData.stationName);

                    if (lowBikeThreshold) {
                        lowBikeThreshold = false;
                        speechOutput += "<speak>The next closest station"
                            + "with bikes available is" + stationAddress
                            + "</speak>";
                    }

                    speechOutput += "<speak>"
                        + stationAddress
                        + " has " + currentStationData.availableBikes
                        + " " + bikeWord + " available.</speak>";

                    if (availableBikes <= LOW_BIKE_THRESHOLD) {
                        lowBikeThreshold = true;
                        return false;
                    }

                    return true;
                }
                //Next iteration
                else {
                    return false;
                }
            });

            if (!bikesAvailable) {
                speechOutput = "<speak>No bikes were availble near you.</speak>"
            }

            response.tell({
                speech: speechOutput,
                type: AlexaSkill.speechOutputType.SSML
            });
        });

    });
}

function handleAddAddressIntent(intent, session, response) {

    storage.loadAddress(session, function(currentAddress) {

        var address,
            hasOverwrittenAddress = !_.isUndefined(session.attributes.overwrittenAddress);

        /** If an address is already saved for the user, we'll prompt
        to overwrite.  */
        if (currentAddress.data.formattedAddress && !hasOverwrittenAddress) {
            session.attributes.overwrittenAddress = intent.slots.Address.value;
            response.ask("Looks like you already have an address saved."
                + "Do you want to overwrite it?");
        }

        //Use overwritten address first if it exists, and then use the one passed in the intent. 
        address = hasOverwrittenAddress ? session.attributes.overwrittenAddress : intent.slots.Address.value;

        if (_.isUndefined(address)) {
            response.tell("Looks like I couldn't understand your address."
                + "Please try asking to add again.");
        }
        
        //Use Google Geocode service to attach a latitude/longitude
        geocoder.geocode(address)
            .then(function(res) {

                console.log(res);
                var address = res[0];

                addressInLocale = isAddressInLocale(
                    'citibike',
                    address.administrativeLevels.level2long
                );

                //TODO: Make sure address is in New York City
                if (!addressInLocale) {
                    response.tell("Sorry, this service is only available"
                        + " for addresses in New York City."
                    );
                }
    
                saveNewAddress(address, currentAddress, session, response);
            })
            .catch(function(err) {
                console.log(err);
                response.tell("Sorry, I'm unable to lookup your address."
                    + "Please try again."
                );

            });

    });

}

function handleOverwriteAddressIntent(intent, session, response) {

    //Check to make sure we have an address to overwrite
    if (!session.attributes.overwrittenAddress) {
        response.tell("I'm sorry, but I don't know which question you are "
            + "answering yes to.");
        return false;
    }

    //Call the original function to save an address
    handleAddAddressIntent(intent, session, response);
}

function handleKAddressIntent(intent, session, response) {
    response.tell("Ok. I'll keep your current address.");
}

function handleAddressQueryIntent(intent, session, response) {

}

/**
 * Citibike specific functions
 */


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

function saveNewAddress (firstAddress, currentAddress, session, response) {

    var speechOutput = '',
        saveWord = session.attributes.overwrittenAddress ? 'overwritten' : 'saved';


    currentAddress.data = _.merge(currentAddress.data, {
        latitude: firstAddress.latitude,
        longitude: firstAddress.longitude,
        formattedAddress: firstAddress.formattedAddress
    });

    //Find the closest stations
    stationPromise.then(function(stations) {

        currentAddress.data.closestStations = getClosestStations(stations, firstAddress.latitude, firstAddress.longitude);

        currentAddress.save(function() {

            speechOutput += "<speak>Your address has been " + saveWord + " as " 
            + "<say-as interpret-as=\"address\">" 
            + firstAddress.formattedAddress + "</say-as>. You can now ask, "
            + "find me the closest bike.</speak>"

            response.tell({
                speech: speechOutput,
                type: AlexaSkill.speechOutputType.SSML
            });

        });
    });
  
}

/**
 * [isAddressInLocale description]
 * @param  {string} system Which Bike System to check against. 
 * @param  {string} locale The locale the address is in. 
 * @return {boolean}        True if address is in locale, false if not. 
 */
function isAddressInLocale(system, locale) {

    if (!_.isUndefined(SYSTEM_LOCALES[system])) {
        return !!_.find(SYSTEM_LOCALES[system],function(o) {
            return o === locale;
        });
    }

    return false;
}

/**
 * Takes the Bike Station address from the API and formats it into SSML
 * so Alexa can properly pronounce/speak it. 
 * @param  {string} address The address of the bike station from the API. 
 * @return {string}         The formatted address.
 */
function formatBikeStationAddress(address) {

    //Replace '&' symbol
    address = address
    .replace('&', 'and')
    //Wrap numbers in ordinal tags
    .replace(/\b(\d+)\b/g, '<say-as interpret-as=\"ordinal\">$1</say-as>');

    return '<say-as interpret-as=\"address\">'
    + address + '</say-as>';
}


// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
    // Create an instance of the Citibike skill.
    var citibike = new Citibike();
    citibike.execute(event, context);
};


