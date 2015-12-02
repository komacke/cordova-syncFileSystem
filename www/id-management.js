//----------------------------
// ID management with Drive and managing sync status
//----------------------------

var C = cordova.require('com.komacke.chromium.syncfilesystem.Constants');
var identity = cordova.require('com.komacke.chromium.syncfilesystem.Identity');
var xhr = cordova.require('com.komacke.chromium.syncfilesystem.Xhr');

// This function retrieves the file name for the given file id from local storage.
exports.getFileIdInfoForFileId = function(fileId, callback) {
    var getCallback = function(items) {
        // TODO: use array.filter
        for (var item in items) {
            if (items.hasOwnProperty(item)) {
                if (items[item].driveId === fileId) {
                    callback(items[item]);
                    return;
                }
            }
        }
        callback(null);
    };
    chrome.storage.internal.get(null, getCallback);
}

// This function gets the Drive file id using the given query.
exports.getDriveFileId = function(query, successCallback, errorCallback) {
    var getFileIdPromise = function(successCallback) {
        // If there's no error callback provided, make one.
        if (!errorCallback) {
            errorCallback = function(e) {
                console.log('getDriveFileId Error: ' + e);
            };
        }

        xhr.getJSON('https://www.googleapis.com/drive/v2/files?q=' + query)
        .then(
            function(json) {
                console.log('Successfully searched for file using query: ' + query + '.');
                var items = json.items;
                if (items.length === 0) {
                    console.log('  File not found.');
                    successCallback(null);
                    // errorCallback(C.FILE_NOT_FOUND_ERROR);
                } else if (items.length == 1) {
                    console.log('  File found with id: ' + items[0].id + '.');
                    successCallback(items[0]);
                } else {
                    console.log('  Multiple (' + items.length + ') copies found.');
                    errorCallback(C.MULTIPLE_FILES_FOUND_ERROR);
                }
            },
            errorCallback
        ).catch(function(e) {
            console.log(e.stack);
            errorCallback(e); 
        });
    }
    if (!successCallback) {
        return new Promise(getFileIdPromise);
    } else {
        getFileIdPromise(successCallback);
    }

}

// This function gets the Drive file id for the directory with the given name and parent id.
exports.getDirectoryId = function(directoryName, parentDirectoryId, shouldCreateDirectory, successCallback) {
    var fileIdKey = constructFileIdKey(directoryName);
    var getCallback = function(items) {
        if (items[fileIdKey]) {
            // If the file id has been cached, use it.
            console.log('Drive file id ' + items[fileIdKey].driveId + ' for directory ' + directoryName + ' retrieved from cache.');
            successCallback(items[fileIdKey].driveId);
        } else {
            // If the file id has not been cached, query for it, cache it, and pass it on.
            var query = 'mimeType = "application/vnd.google-apps.folder" and title = "' + directoryName + '" and trashed = false';
            if (parentDirectoryId) {
                query += ' and "' + parentDirectoryId + '" in parents';
            }
            var errorCallback;

            var augmentedSuccessCallback = function(driveIdInfo) {
                if (driveIdInfo == null)
                    successCallback(driveIdInfo);
                else {
                    var onCacheDriveIdSuccess = function() {
                        successCallback(driveIdInfo.id);
                    };
                    exports.cacheDriveId(directoryName, driveIdInfo.id, driveIdInfo.modifiedDate, C.FILE_STATUS_PENDING, onCacheDriveIdSuccess);
                }
            };

            // Create the error callback based on whether we should create a directory if it doesn't exist.
            if (shouldCreateDirectory) {
                errorCallback = function(e) {
                    if (e === C.FILE_NOT_FOUND_ERROR) {
                        // If the directory doesn't exist, create it.
                        createDirectory(directoryName, parentDirectoryId, augmentedSuccessCallback);
                    } else {
                        // If it's a different error, log it.
                        console.log('Retrieval of directory "' + directoryName + '" failed with error ' + e);
                    }
                };
            } else {
                errorCallback = function(e) {
                    // Log an error.
                    console.log('Retrieval of directory "' + directoryName + '" failed with error ' + e);
                };
            }
            exports.getDriveFileId(query, augmentedSuccessCallback, errorCallback);
        }
    };

    chrome.storage.internal.get(fileIdKey, getCallback);
}

// This function retrieves the Drive file id of the given file, if it exists.  Otherwise, it yields null.
exports.getFileId = function(fileName, parentDirectoryId, successCallback) {
  var getFileIdPromise = function(successCallback) {
    var fileIdKey = constructFileIdKey(fileName);
    var getCallback = function(items) {
        if (items[fileIdKey]) {
            // If the file id has been cached, use it.
            console.log('Drive file id for file ' + fileName + ' retrieved from cache.');
            console.log(items[fileIdKey]);
            successCallback(items[fileIdKey]);
        } else {
            // If the file id has not been cached, query for it, cache it, and pass it on.
            // In order to support paths, we need to call this function recursively.
            var slashIndex = fileName.indexOf('/');
            var query;
            if (slashIndex < 0) {
                query = 'title = "' + fileName + '" and "' + parentDirectoryId + '" in parents and trashed = false';
                var augmentedSuccessCallback = function(driveIdInfo) {
                    console.log("File: " + fileName + " not found in cache.");
                        successCallback(null);
/*
                    var onCacheDriveIdSuccess = function() {
                        successCallback(driveIdInfo);
                    };
                    exports.cacheDriveId(fileName, driveIdInfo.id, driveIdInfo.modifiedDate, C.FILE_STATUS_PENDING, onCacheDriveIdSuccess);
 */
               };
                var errorCallback = function(e) {
                    if (e === C.FILE_NOT_FOUND_ERROR) {
                        successCallback(null);
                    } else {
                        // If it's a different error, log it.
                        console.log('Retrieval of file "' + fileName + '" failed with error ' + e);
                    }
                };
                exports.getDriveFileId(query, augmentedSuccessCallback, errorCallback);
            } else {
                var nextDirectory = fileName.substring(0, slashIndex);
                var pathRemainder = fileName.substring(slashIndex + 1);
                query = 'mimeType = "application/vnd.google-apps.folder" and title = "' + nextDirectory + '" and "' + parentDirectoryId + '" in parents and trashed = false';
                var onGetDriveFileIdSuccess = function(driveIdInfo) {
                    if (driveIdInfo == null)
                        console.log(nextDirectory + " does not exist.");
                    else
                        exports.getFileId(pathRemainder, driveIdInfo.id, successCallback);
                };
                var onGetDriveFileIdError = function(e) {
                    console.log('Retrieval of directory "' + nextDirectory + '" failed with error ' + e);
                };
                exports.getDriveFileId(query, onGetDriveFileIdSuccess, onGetDriveFileIdError);
            }
        }
    };

    chrome.storage.internal.get(fileIdKey, getCallback);
  }
    if (!successCallback) {
        return new Promise(getFileIdPromise);
    } else {
        getFileIdPromise(successCallback);
    }
}

// This function retrieves the local file status, if it exists.  Otherwise, it yields null.
exports.getFileSyncStatus = function(fileName, successCallback) {
    var fileIdKey = constructFileIdKey(fileName);
    var getCallback = function(items) {
        if (items[fileIdKey]) {
            // If the file id has been cached, use it.
            console.log('Drive file id ' + items[fileIdKey].driveId + ' for file ' + fileName + ' has sync status ' + items[fileIdKey].syncStatus);
            successCallback(items[fileIdKey].syncStatus);
        } else {
            console.log('Sync status for file ' + fileName + ' not found.');
            successCallback(null);
        }
    };

    chrome.storage.internal.get(fileIdKey, getCallback);
}

// This function returns a key to use for file id caching.
constructFileIdKey = function(entryName) {
    return C.SYNC_FILE_SYSTEM_PREFIX + '-' + chrome.runtime.id + '-' + entryName;
}

// This function caches the given Drive id.
exports.cacheDriveId = function(fileName, driveId, modifiedDate, syncStatus, callback) {
    var fileIdObject = { };
    var key = constructFileIdKey(fileName);
    fileIdObject[key] = {fileName: fileName, driveId: driveId, modifiedDate: modifiedDate, syncStatus: syncStatus};
    var setCallback = function() {
        console.log('Drive id ' + driveId + ' for ' + fileName + ' saved to cache.');
        if (callback) {
            callback();
        }
    };
    chrome.storage.internal.set(fileIdObject, setCallback);
}

// This function removes the Drive id for the given file from the cache.
exports.removeDriveIdFromCache = function(fileName, callback) {
    var removeCallback = function() {
        console.log('Drive file id for ' + fileName + ' removed from cache.');
        if (callback) {
            callback();
        }
    }
    chrome.storage.internal.remove(constructFileIdKey(fileName), removeCallback);
}

