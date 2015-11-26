//==========
// Identity
//==========

// When we get an auth token string, we store it here.
exports.tokenString = '';

// This function initiates a web auth flow, eventually getting a token string and passing it to the given callback.
exports.getTokenString = function(successCallback, errorCallback) {
    // Get the auth token.
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
        if (token) {
            exports.tokenString = token;
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

// This function initiates a web auth flow, eventually getting a token string and passing it to the given callback.
exports.getTokenStringPromise = function() {
    return new Promise(function(successCallback, errorCallback) {
        // Get the auth token.
        chrome.identity.getAuthToken({ interactive: true }, 
            function(token) {
                if (token) {
                    exports.tokenString = token;
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
    });
}

