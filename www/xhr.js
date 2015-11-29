var identity = cordova.require('com.komacke.chromium.syncfilesystem.Identity');

exports.delete = function(url) {
    return new Promise(function(successCallback, errorCallback) {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200 || xhr.status === 204) {
                    console.log('File removed!');
                    callback();
                } else {
                    console.log('Failed to remove entry with status ' + xhr.status + '.');
                    if (errorCallback) 
                        errorCallback(xhr);
                }
            }
        };

        xhr.open('DELETE', url);
        xhr.setRequestHeader('Authorization', 'Bearer ' + identity.tokenString);
        xhr.send();
    });
}

exports.request = function(method, url, contentType, data) {
    identity.getTokenString()
    .then(
        function() {
            return new Promise(function(successCallback, errorCallback) {
                var xhr = new XMLHttpRequest();
                xhr.onreadystatechange = function() {
                    if (xhr.readyState === 4) {
                        if (xhr.status === 200) {
                            switch (contentType) {
                                case 'application/json':                        
                                    successCallback(JSON.parse(xhr.responseText));
                                    break;
                                default:
                                    successCallback(xhr.responseText);
                                    break;      
                            }
                        } else {
                            console.log('Failed to remove entry with status ' + xhr.status + '.');
                            if (errorCallback) 
                                errorCallback(xhr);
                        }
                    }
                };

                xhr.open(method, url);
                if (contentType)
                    xhr.setRequestHeader('Content-Type', contentType);
                xhr.setRequestHeader('Authorization', 'Bearer ' + identity.tokenString);
                xhr.send(data);
        }
    ).catch(
        function(e) {
            console.log(e.stack);
            errorCallback(e); 
        }
    );
}

exports.get = function(url) {
    return exports.request('GET', url);
}

exports.getJSON = function(url) {
    return exports.request('GET', url, 'application/json', null);
}

exports.postJSON = function(url, data) {
    return exports.request('POST', url, 'application/json', data);
}
