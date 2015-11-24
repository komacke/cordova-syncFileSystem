//==========
// Identity
//==========

var runtime = require('cordova-plugin-chrome-apps-runtime.runtime');

// This function initiates a web auth flow, eventually getting a token string and passing it to the given callback.
exports.getTokenString = function(successCallback, errorCallback) {
    // Get the auth token.
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
        if (token) {
            _tokenString = token;
            if (typeof successCallback === 'function') {
                successCallback();
            }
        } else {
            chrome.runtime.lastError = { message: "Sync: authentication failed." };
            if (typeof errorCallback === 'function') {
                errorCallback();
            }
        }
    });
}
