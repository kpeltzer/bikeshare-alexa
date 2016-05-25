
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

var stationPromise;
    
//Required Modules
var request = require('request');
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
    "AddNumberIntent" : function (intent, session, response) {
        handleAddNumberIntent(intent, session, response);
    },
    "AddStreetNameIntent" : function (intent, session, response) {
        handleAddStreetNameIntent(intent, session, response);
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

            speechOutput += "<speak>Welcome to Bike Share. I currently support City Bike in New York City. There is no address set for your home."
                + " You can add one by telling me, add an address, and I'll prompt you with the next steps from there.</speak>";

            reprompt += "<speak>Before you find any bikes, you first need to add an address. "
                + "You can add one by asking me to add address, where I'll prompt you step-by-step to add one. " 
                + "First, I'll ask for your house number. If my address was <say-as interpret-as=\"characters\">1234</say-as> Broadway, <say-as interpret-as=\"characters\">10001</say-as>, "
                + "you would say, <say-as interpret-as=\"characters\">1234</say-as> for the house number. Next I'll ask for your street number. In this example instance,"
                + " it would just be, Broadway. Finally, I'll ask for your zipcode. With my example address, it would be <say-as interpret-as=\"characters\">10001</say-as></speak>";        
        }
        else {
            speechOutput += "<speak>Welcome to Bike Share. I have your address on file. You can now ask me, find me a bike.</speak>"
            reprompt +="<speak>Since I have your address on file, you can ask me, find me a bike, and I'll give you "
                + "the closest station to you with bikes available.</speak>";
        }

        response.ask(
            {speech: speechOutput, type: AlexaSkill.speechOutputType.SSML},
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
            reprompt = "<speak>";

        if (_.isEmpty(address.data.formattedAddress)) {

            speechOutput += "There is currently no address set for your home."
                + " You can add one by asking me to add an address.</speak>";

            reprompt += "Before you find any bikes, you first need to add an address. "
                + "You can add one by asking me to add an address, and I'll prompt you along the way to add one.</speak>";

            response.ask(
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
            currentAddress = _.get(currentAddress, 'data.formattedAddress'),
            speech;

        /** If an address is already saved for the user, we'll prompt
        to overwrite.  */
        if (!_.isEmpty(currentAddress)) {

            session.attributes.promptToOverwrite = true;

            response.ask("Looks like you already have an address saved."
                + " Do you want to overwrite it?");
        }

        speech = "<speak>Which address do you want me to add? First, tell me the house number of your address.</speak>";

        //Empty out any potentially overwritten addresses
        session.attributes.overwrittenAddress = undefined;

        response.ask({
            speech: speech,
            type: AlexaSkill.speechOutputType.SSML
        });

    });

}

function handleAddNumberIntent(intent, session, response) {

    /*
    Check if house number is set already in session. If it is,
    we're adding a zipcode.
     */
    var houseNumber = _.get(session, "attributes.houseNumber"),
        number = _.get(intent, "slots.Number.value"),
        streetName = _.get(session, "attributes.streetName");


    if (_.isUndefined(houseNumber) && number) {
        session.attributes.houseNumber = number;

        response.ask("Great. Now, tell me your street name.");
    }
    //Street Name wasn't properly given before zipcode
    else if(!streetName) {
        response.ask("Sorry, you gave me a zipcode before your street name. Please try giving me your street name again;" +
        " for example, Broadway, or 57th Street.");
    }
    //Number was a zipcode
    else {
        storage.loadAddress(session, function(currentAddress) {
            lookupAddress(houseNumber, streetName, number, function(res) {
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
                    response.tell("Sorry, you gave me an address that isn't quite ready for this service yet. Bike Share is only availble"
                        + " for City Bike in New York City. Stay tuned for more Bike Share systems soon."
                    );

                    return false;
                }

                saveNewAddress(address, currentAddress, session, response);
            });
        });
    }


}

function handleAddStreetNameIntent(intent, session, response) {

    var houseNumber = _.get(session, "attributes.houseNumber"),
        streetName = _.get(intent, "slots.StreetName.value");

    if (!houseNumber) {
        response.ask("You've given me a street name without a house number. What is your house number?");
    }
    else {
        session.attributes.streetName = streetName;
        response.ask("Thanks. Now, finally, what is your zipcode?");
    }

}

function handleOverwriteAddressIntent(intent, session, response) {

    //Check to make sure we have an address to overwrite
    if (!session.attributes.promptToOverwrite) {
        response.tell("I'm sorry, but I don't know which question you are "
            + "answering yes to.");
        return false;
    }

    response.ask("Ok, lets overwrite. First, tell me the house number of your address.");
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
                + " Before you find any bikes, you first need to tell me where this Echo is located. "
                + "You can add one by asking me to add address, where I'll prompt you step-by-step to add one. " 
                + "First, I'll ask for your house number. If my address was <say-as interpret-as=\"characters\">1234</say-as> Broadway, <say-as interpret-as=\"characters\">10001</say-as>,"
                + "you would say, <say-as interpret-as=\"characters\">1234</say-as>. Next I'll ask for you street number. In this instance,"
                + " it would just be, Broadway. Finally, I'll ask for your zipcode. With my address, it would be <say-as interpret-as=\"characters\">10001</say-as>.</speak>";   
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

    var endpoint = 'https://feeds.citibikenyc.com/stations/stations.json';

    var stationPromise = new Promise(function(resolve, reject) {

        request.get(endpoint, function (err, res, body) {

            console.log(body);

            if (err) {
                reject(err);
            }

            stations = JSON.parse(body);
            console.log(stations);
            resolve(stations.stationBeanList);
        });

    });

    return stationPromise;
}

function lookupAddress(houseNumber, streetName, zipcode, callback) {

    //First, form the address string.
    var address = houseNumber + " " + streetName + " " + zipcode;

    //Use Google Geocode service to attach a latitude/longitude
    geocoder.geocode(address)
        .then(callback)
        .catch(function(err) {
            console.log(err);
            response.tell("Sorry, I'm unable to lookup your address."
                + " Please try again."
            );

        });
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




