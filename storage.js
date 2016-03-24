'use strict';
var AWS = require("aws-sdk");

var storage = (function () {
    var dynamodb = new AWS.DynamoDB(),
        tableName = 'AddressData';

    /*
     * Stores address information for a user. 
     */
    function Address(session, data) {
        if (data) {
            this.data = data;
        } else {
            this.data = {
                formattedAddress: '',
                latitude: '',
                longitude: '',
                closestStations: [],
                type: 'home'
            };
        }
        this._session = session;
    }

    Address.prototype = {
        save: function (callback) {
            //save the game states in the session,
            //so next time we can save a read from dynamoDB
            this._session.attributes.address = this.data;
            dynamodb.putItem({
                TableName: tableName,
                Item: {
                    id: {
                        S: this._session.user.userId
                    },
                    Data: {
                        S: JSON.stringify(this.data)
                    }
                }
            }, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                }
                if (callback) {
                    callback();
                }
            });
        }
    };

    return {
        loadAddress: function (session, callback) {
            if (session.attributes.address) {
                console.log('get address from session=' + session.attributes.address);
                callback(new Address(session, session.attributes.address));
                return;
            }
            dynamodb.getItem({
                TableName: tableName,
                Key: {
                    id: {
                        S: session.user.userId
                    }
                }
            }, function (err, data) {
                var address;
                if (err) {
                    console.log(err, err.stack);
                    address = new Address(session);
                    callback(address);
                } else if (data.Item === undefined) {
                    address = new Address(session);
                    callback(address);
                } else {
                    console.log('get address from dynamodb=' + data.Item.Data.S);
                    address = new Address(session, JSON.parse(data.Item.Data.S));
                    session.attributes.address = address.data;
                    callback(address);
                }
            });
        },
        newAddress: function (session) {
            return new Address(session);
        }
    };
})();
module.exports = storage;
