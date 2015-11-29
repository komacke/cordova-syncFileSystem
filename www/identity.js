//==========
// Identity
//==========

// When we get an auth token string, we store it here.
exports.tokenString = '';

// This function initiates a web auth flow, eventually getting a token string and passing it to the given callback.
exports.getTokenString = function() {
    return new Promise(function(resolve, reject) {
        // Get the auth token.
        chrome.identity.getAuthToken({ interactive: true }, 
            function(token) {
                if (token) {
                    exports.tokenString = token;
                    if (typeof resolve === 'function') {
                        resolve();
                    }
                } else {
                    exports.tokenString = null;
                    // if no errorCallback, then caller doesn't care if offline
                    chrome.runtime.lastError = { message: "Sync: authentication failed." };
                    if (typeof reject === 'function') {
                        reject();
                    } else {
                        resolve();
                    }
                }
            }
        )
    });
}

