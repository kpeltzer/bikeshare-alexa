
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

//If a station has this many bikes or less, it is considered almost empty. 
var LOW_BIKE_THRESHOLD = 3;

//The amount of additional stations to return, if the inital station has less than the threshold
//of bikes available. 
var MAX_ADDITIONAL_STATIONS = 2;

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
 * Bikeshare is a child of AlexaSkill.
*/
var Bikeshare = function () {
    AlexaSkill.call(this, APP_ID);
};

// Extend AlexaSkill
Bikeshare.prototype = Object.create(AlexaSkill.prototype);
Bikeshare.prototype.constructor = Bikeshare;

Bikeshare.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
    console.log("Bikeshare onSessionStarted requestId: " + sessionStartedRequest.requestId
        + ", sessionId: " + session.sessionId);
    
    //Load current feed on session start
    stationPromise = getStationFeed();
};

Bikeshare.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
    console.log("Bikeshare onLaunch requestId: " + launchRequest.requestId + ", sessionId: " + session.sessionId);
    handleLaunchRequest(session, response);
};

Bikeshare.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
    console.log("Bikeshare onSessionEnded requestId: " + sessionEndedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any cleanup logic goes here
};

Bikeshare.prototype.intentHandlers = {
    // register custom intent handlers
    "FindBikeIntent": function (intent, session, response) {
        handleFindBikeIntent(intent, session, response);
    },
    "AddAddressIntent" : function (intent, session, response) {
        handleAddAddressIntent(intent, session, response);
    },
    "AMAZON.YesIntent" : function (intent, session, response) {
        handleOverwriteAddressIntent(intent, session, response);
    },
    "AMAZON.NoIntent" : function (intent, session, response) {
        handleKeepAddressIntent(intent, session, response);
    },
    "AMAZON.HelpIntent": function (intent, session, response) {
        handleHelpIntent(intent, session, response);
    },
    "AMAZON.StopIntent": function (intent, session, response) {
        handleStopIntent(intent, session, response);
    },
    "AMAZON.CancelIntent": function (intent, session, response) {
        handleStopIntent(intent, session, response);
    }
};

/**
 * Event Handler Functions
 */

function handleLaunchRequest(session, response) {


     storage.loadAddress(session, function(address) {
        var speechOutput = '',
            reprompt = '';

        //TODO: Do a reprompt here
        if (_.isEmpty(address.data.formattedAddress)) {

            speechOutput += "Welcome to Bike Share. I currently support City Bike in New York City. There is no address set for your home."
                + " You can add one by telling me, add an address, followed by your street address and your zipcode.";

            reprompt += "<speak>Before you find any bikes, you first need to add an address. "
                + "You can add one by asking me to add address, followed by your street address and your zipcode."
                + "For example, you can say, add address <say-as interpret-as=\"address\">"
                + "<say-as interpret-as=\"characters\">1234</say-as> Broadway, 10001.</say-as></speak>";
        }
        else {
            speechOutput += "Welcome to Bike Share. I have your address on file. You can now ask me, find me a bike."
            reprompt +="<speak>Since I have your address on file, you can ask me, find me a bike, and I'll give you "
                + "the closest station to you with bikes available.";
        }

        response.ask(
            {speech: speechOutput},
            {speech: reprompt, type: AlexaSkill.speechOutputType.SSML}
        );


    });
}


/**
 * Intent Handler Functions
 */

function handleFindBikeIntent(intent, session, response) {

    storage.loadAddress(session, function(address) {
        var stationFeedPromise,
            closestStations,
            bikesAvailable = false,
            bikeWord,
            speechOutput = "<speak>",
            reprompt

        if (_.isEmpty(address.data.formattedAddress)) {

            speechOutput += "Welcome to bike share. There is currently no address set for your home."
                + " You can add one by asking me to add an address, followed by your street address and your zipcode.</speak>";

            reprompt += "<speak>Before you find any bikes, you first need to add an address. "
                + "You can add one by asking me to add address, followed by your street address and your zipcode."
                + "For example, you can say add address <say-as interpret-as=\"address\">"
                + "1234 Broadway, 10001.</say-as></speak>";

            response.tell(
                {speech: speechOutput, type: AlexaSkill.speechOutputType.SSML},
                {speech: reprompt, type: AlexaSkill.speechOutputType.SSML}
            );
            return false;
        }

        closestStations = address.data.closestStations;

        stationPromise.then(function(feed) {

            //Run through each station and determine if it has bikes.
            var currentStationData = {},
                availableBikes,
                lowBikeThreshold = false,
                additionalStations = MAX_ADDITIONAL_STATIONS;
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
                    bikeWord = availableBikes === 1 ? 'bike' : 'bikes';
                    stationAddress = formatBikeStationAddress(currentStationData.stationName);

                    if (lowBikeThreshold) {

                        additionalStations--;
                        lowBikeThreshold = false;
                        speechOutput += "The next closest station"
                            + " with bikes available is" + stationAddress + ". ";
                        stationAddress = "That station";
                    }

                    speechOutput += 
                        stationAddress
                        + " has " + currentStationData.availableBikes
                        + " " + bikeWord + " available. ";

                    /** Station has low bikes available. Make another loop to get the next station as well. */
                    if (availableBikes <= LOW_BIKE_THRESHOLD && additionalStations > 0) {
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
                speechOutput = "<speak>No bikes were availble near you."
            }

            speechOutput += "</speak>";

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
            overwrittenAddress = _.get(session, "attributes.overwrittenAddress"),
            promptToOverwrite = _.get(session, "attributes.promptToOverwrite"),
            slotAddress = _.get(intent, "slots.Address.value");

        /** If an address is already saved for the user, we'll prompt
        to overwrite.  */
        if (currentAddress.data.formattedAddress && !promptToOverwrite) {

            session.attributes.promptToOverwrite = true;

            if (slotAddress) {
                session.attributes.overwrittenAddress = slotAddress;
            }

            response.ask("Looks like you already have an address saved."
                + " Do you want to overwrite it?");

            return false;
        }

        if (overwrittenAddress) {
            address = session.attributes.overwrittenAddress;
        }
        else if (slotAddress) {
            address = slotAddress;
        }
        else {
            address = undefined;
        }


        if (_.isUndefined(address) || _.isEmpty(address)) {
            var speech = "<speak>Which address do you want me to add? First, tell me the house number of your address.</speak>";

            //Empty out any potentially overwritten addresses
            session.attributes.overwrittenAddress = undefined;

            response.ask({
                speech: speech,
                type: AlexaSkill.speechOutputType.SSML
            });

            return false;
        }
        
        //Use Google Geocode service to attach a latitude/longitude
        geocoder.geocode(address)
            .then(function(res) {

                var address = res[0];

                if (!address.administrativeLevels) {
                    response.ask("Sorry, I had trouble understanding your address. Can you please repeat it?");
                }

                addressInLocale = isAddressInLocale(
                    'citibike',
                    address.administrativeLevels.level2long
                );

                if (!addressInLocale) {
                    console.log("Address Error:" + address);
                    response.tell("Sorry, this service is currently only available"
                        + " for City Bike in New York City. Stay tuned for more Bike Share systems soon."
                    );

                    return false;
                }
    
                saveNewAddress(address, currentAddress, session, response);
            })
            .catch(function(err) {
                console.log(err);
                response.tell("Sorry, I'm unable to lookup your address."
                    + " Please try again."
                );

            });

    });

}

function handleOverwriteAddressIntent(intent, session, response) {

    //Check to make sure we have an address to overwrite
    if (!session.attributes.promptToOverwrite) {
        response.tell("I'm sorry, but I don't know which question you are "
            + "answering yes to.");
        return false;
    }

    //Call the original function to save an address
    handleAddAddressIntent(intent, session, response);
}

function handleKeepAddressIntent(intent, session, response) {
    response.tell("Ok. I'll keep your current address.");
}

function handleHelpIntent(intent, session, response) {

    storage.loadAddress(session, function(address) {
        var speechOutput = "<speak>";

        //TODO: Do a reprompt here
        if (_.isEmpty(address.data.formattedAddress)) {

            speechOutput += "Welcome to Bike Share. I help you find the closest bikes in your local bike share system."
                + " Before you find any bikes, you first need to tell me where this Echo is located."
                + " You can start by telling me to add an address, followed by your street address and your zipcode."
                + " For example, you can say, add address <break time=\"300ms\"/><say-as interpret-as=\"address\">"
                + "<say-as interpret-as=\"characters\">1234</say-as> Broadway, 10001.</say-as></speak>";
        }
        else {
            speechOutput +="Welcome to Bike Share. I have your address on file. You can now ask me, find me a bike, and I'll give you "
                + "the closest station to you with bikes available. If you need to change your address, you can tell me, change my address,"
                + " and I'll give you a chance to overwrite it. To repeat this again, just say, help.</speak>";
        }

        response.ask(
            {speech: speechOutput, type: AlexaSkill.speechOutputType.SSML}
        );


    });
}

function handleStopIntent(intent, session, response) {
    response.tell("Goodbye");
}

/**
 * Bikeshare specific functions
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
            + "find me a bike.</speak>"

            response.ask({
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
    // Create an instance of the Bikeshare skill.
    var bikeshare = new Bikeshare();
    bikeshare.execute(event, context);
};


