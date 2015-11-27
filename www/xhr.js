var identity = cordova.require('com.komacke.chromium.syncfilesystem.Identity');

exports.getJSON = function(url) {
    return new Promise(function(successCallback, errorCallback) {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    successCallback(JSON.parse(xhr.responseText));
                } else {
                    errorCallback(xhr.status);
                }
            }
        };

        xhr.open('GET', url);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + identity.tokenString);
        xhr.send();
    };
}