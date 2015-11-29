//==========
// Identity
//==========

// When we get an auth token string, we store it here.
exports.tokenString = '';

// This function initiates a web auth flow, eventually getting a token string and passing it to the given callback.
exports.getTokenString = function(successCallback, errorCallback) {
    // overloaded - if no callbacks then thenify - clean up after we fully migrate all calls promises
    if (! (successCallback || errorCallback) ) {
        return new Promise(exports.getTokenString);
    }

    // Get the auth token.
    chrome.identity.getAuthToken({ interactive: true }, 
        function(token) {
            if (token) {
                exports.tokenString = token;
                if (typeof successCallback === 'function') {
                    successCallback();
                }
            } else {
                exports.tokenString = null;
                // if no errorCallback, then caller doesn't care if offline
                chrome.runtime.lastError = { message: "Sync: authentication failed." };
                if (typeof errorCallback === 'function') {
                    errorCallback();
                } else {
                    successCallback();
                }
            }
        });
}

