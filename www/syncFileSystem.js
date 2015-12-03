// Copyright (c) 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var exec = cordova.require('cordova/exec');
var identity = cordova.require('com.komacke.chromium.syncfilesystem.Identity');
var idm = cordova.require('com.komacke.chromium.syncfilesystem.IdManagement');
var C = cordova.require('com.komacke.chromium.syncfilesystem.Constants');
var xhr = cordova.require('com.komacke.chromium.syncfilesystem.Xhr');

//=======
// Drive
//=======

// When we create or get the app's syncable Drive directory, we store its id here.
var _syncableAppDirectoryId;

// These listeners are called when a file's status changes.
var fileStatusListeners = [ ];

// The conflict resolution policy is used to determine how to handle file sync conflicts.
var conflictResolutionPolicy;

// This timer triggers the poll for changes on Drive
var pollTimer = null;

// Last network state to decide if we are transitioning back online
var lastNetworkState = '';

//-------------
// Local cache
//-------------

var localDirectoryEntry;

//----------------------------------
// FileSystem function augmentation
//----------------------------------

// This function overrides the necessary functions on a given Entry to enable syncability.
function enableSyncabilityForEntry(entry) {
    entry.remove = function(successCallback, errorCallback) {
        // For now, directories cannot be added or created using syncFileSystem.
        if (entry.isDirectory) {
            if (typeof errorCallback === 'function') {
                errorCallback(new FileError(FileError.INVALID_MODIFICATION_ERR));
            }
        }

        var onRemoveSuccess = function() {
            // Remove the file id from the cache.
            var onRemoveDriveIdFromCacheSuccess = function() {
                // If a file was removed, fire the file status listener.
                if (entry.isFile) {
                    var fileInfo = { fileEntry: entry, status: C.FILE_STATUS_SYNCED, action: C.SYNC_ACTION_DELETED, direction: C.SYNC_DIRECTION_LOCAL_TO_REMOTE };
                    for (var i = 0; i < fileStatusListeners.length; i++) {
                        fileStatusListeners[i](fileInfo);
                    }
                }

                if (typeof successCallback === 'function') {
                    successCallback();
                }
            };
            idm.removeDriveIdFromCache(entry.name, onRemoveDriveIdFromCacheSuccess);
        };
        var augmentedSuccessCallback = function() {
            remove(entry, onRemoveSuccess);
        };

        // Call the original function.  The augmented success callback will take care of the syncability addition work.
        FileEntry.prototype.remove.call(entry, augmentedSuccessCallback, errorCallback);
    };
}

// This function overrides the necessary functions on a given DirectoryEntry to enable syncability.
function enableSyncabilityForDirectoryEntry(directoryEntry) {
    // First, enable syncability for Entry functions.
    enableSyncabilityForEntry(directoryEntry);

    directoryEntry.getDirectory = function(path, options, successCallback, errorCallback) {
        // For now, directories cannot be added or created using syncFileSystem.
        if (typeof errorCallback === 'function') {
            errorCallback(new FileError(FileError.INVALID_MODIFICATION_ERR));
        }

        /*
        // When a directory is retrieved, enable syncability for it, sync it to Drive, and then call the given callback.
        // TODO(maxw): Handle syncing when a directory is dropped into the app directory; as of now, syncing only happens on creation and updating.
        // TODO(maxw): If a directory is intended to be created, it is synced whether it's actually created or it already existed.  Change this to sync only when truly created.
        var augmentedSuccessCallback = function(directoryEntry) {
            enableSyncabilityForDirectoryEntry(directoryEntry);

            // Only sync if the directory is being created and not merely retrieved.
            if (options.create) {
                var onSyncSuccess = function() {
                    if (typeof successCallback === 'function') {
                        successCallback(directoryEntry);
                    }
                };
                sync(directoryEntry, onSyncSuccess);
            } else {
                if (typeof successCallback === 'function') {
                    successCallback(directoryEntry);
                }
            }
        };

        // Call the original function.  The augmented success callback will take care of the syncability addition work.
        DirectoryEntry.prototype.getDirectory.call(directoryEntry, path, options, augmentedSuccessCallback, errorCallback);
        */
    };

    directoryEntry.getFile = function(path, options, successCallback, errorCallback) {
        // When a file is retrieved, enable syncability for it, sync it to Drive, and then call the given callback.
        // TODO(maxw): Handle syncing when a file is dropped into the app directory; as of now, syncing only happens on creation and updating.
        // TODO(maxw): If a file is intended to be created, it is synced whether it's actually created or it already existed.  Change this to sync only when truly created.
        var augmentedSuccessCallback = function(fileEntry) {
            enableSyncabilityForFileEntry(fileEntry);

            // Only sync if the file is being created and not merely retrieved.
/*            if (options.create) {
                var onSyncSuccess = function() {
                    if (typeof successCallback === 'function') {
                        successCallback(fileEntry);
                    }
                };
                sync(fileEntry, onSyncSuccess);
            } else {
                if (typeof successCallback === 'function') {
                    successCallback(fileEntry);
                }
            }
            */
                    successCallback(fileEntry);
        };

        // Call the original function.  The augmented success callback will take care of the syncability addition work.
        DirectoryEntry.prototype.getFile.call(directoryEntry, path, options, augmentedSuccessCallback, errorCallback);
    };
}

// This function overrides the necessary functions on a given FileEntry to enable syncability.
// It also uploads the associated file to Drive.
function enableSyncabilityForFileEntry(fileEntry) {
    // First, enable syncability for Entry functions.
    enableSyncabilityForEntry(fileEntry);

    fileEntry.createWriter = function(successCallback, errorCallback) {
        var augmentedSuccessCallback = function(fileWriter) {
            enableSyncabilityForFileWriter(fileWriter, fileEntry);
            if (successCallback) {
                successCallback(fileWriter);
            }
        };

        // Call the original function.  The augmented success callback will take care of the syncability addition work.
        FileEntry.prototype.createWriter.call(fileEntry, augmentedSuccessCallback, errorCallback);
    };
}

// This function overrides the necessary functions on a given FileWriter to enable syncability.
function enableSyncabilityForFileWriter(fileWriter, fileEntry) {
    fileWriter.write = function(data) {
        // We want to augment the `onwrite` and `onwriteend` listeners to add syncing.
        // TODO(maxw): Augment onwriteend.
        if (fileWriter.onwrite) {
            var originalOnwrite = fileWriter.onwrite;
            fileWriter.onwrite = function(evt) {
//                var onSyncSuccess = function() {
                    originalOnwrite(evt);
//                };
                sync(fileEntry, null);
            };
        } else {
            fileWriter.onwrite = function(evt) {
                sync(fileEntry, null);
            };
        }

        // Call the original function.  The augmented success callback will take care of the syncability addition work.
        FileWriter.prototype.write.call(fileWriter, data);
    };
}

originalResolveLocalFileSystemURL = window.resolveLocalFileSystemURL;
window.resolveLocalFileSystemURL = function(url, successCallback, errorCallback) {
    originalResolveLocalFileSystemURL(url, function(entry) {
        if (entry && entry.filesystem && entry.filesystem.name === "syncable") {
            if (entry.isFile) {
                enableSyncabilityForFileEntry(entry);
            } else if (entry.isDirectory) {
                enableSyncabilityForDirectoryEntry(entry);
            } else {
                enableSyncabilityForEntry(entry);
            }
        }
        successCallback(entry);
    }, errorCallback);
};

//------------------
// Syncing to Drive
//------------------

// This function creates an app-specific directory on the user's Drive.
function createAppDirectoryOnDrive(directoryEntry, successCallback, errorCallback) {
    var onGetSyncableAppDirectoryIdSuccess = function(syncableAppDirectoryId) {
        // Keep that directory id!  We'll need it.
        _syncableAppDirectoryId = syncableAppDirectoryId;
        successCallback(directoryEntry);
    };
    var onGetSyncableRootDirectoryIdSuccess = function(syncableRootDirectoryId) {
        // Get the app directory id.
        idm.getDirectoryId(chrome.runtime.id /* directoryName */, syncableRootDirectoryId /* parentDirectoryId */, true /* shouldCreateDirectory */, onGetSyncableAppDirectoryIdSuccess);
    };
    // Get the Drive "Chrome Syncable FileSystem" directory id.
    idm.getDirectoryId('Chrome Syncable FileSystem', null /* parentDirectoryId */, true /* shouldCreateDirectory */, onGetSyncableRootDirectoryIdSuccess);
}

// This function syncs an entry to Drive, creating it if necessary.
function sync(entry, callback) {
    // Drive, unfortunately, does not allow searching by path.
    // Begin the process of drilling down to find the correct parent directory.  We can start with the app directory.
    var pathRemainder = entry.fullPath;
    var appIdIndex = pathRemainder.indexOf(chrome.runtime.id);

    // If the app id isn't in the path, we can't sync it.
    if (appIdIndex < 0) {
        console.log("Entry cannot be synced because it is not a descendant of the app directory.");
        return;
    }

    // Augment the callback to fire the status listener, but only if we've synced a file, not a directory.
    var augmentedCallback = function(fileAction) {
        if (fileAction && entry.isFile) {
            var fileInfo = { fileEntry: entry, status: C.FILE_STATUS_SYNCED, action: fileAction, direction: C.SYNC_DIRECTION_LOCAL_TO_REMOTE };
            for (var i = 0; i < fileStatusListeners.length; i++) {
                fileStatusListeners[i](fileInfo);
            }
        }

        if (callback) {
            callback();
        }
    };

    // Using the remainder of the path, start the recursive process of drilling down.
    pathRemainder = pathRemainder.substring(appIdIndex + chrome.runtime.id.length + 1);
    syncAtPath(entry, _syncableAppDirectoryId, pathRemainder, augmentedCallback);
}

// This function syncs an entry to Drive, given its path, creating it if necessary.
function syncAtPath(entry, currentDirectoryId, pathRemainder, callback) {
    var slashIndex = pathRemainder.indexOf('/');
    var nextDirectoryName;
    var onGetDirectoryIdSuccess;

    if (slashIndex < 0) {
        // We're done diving and can sync the entry.
        if (entry.isFile) {
            uploadFile(entry, currentDirectoryId /* parentDirectoryId */, callback);
        } else if (entry.isDirectory) {
            nextDirectoryName = pathRemainder;
            onGetDirectoryIdSuccess = function(directoryId) {
                callback();
            };
            idm.getDirectoryId(nextDirectoryName, currentDirectoryId, true /* shouldCreateDirectory */, onGetDirectoryIdSuccess);
        } else {
            // Something's wrong!
            console.log('Attempted to sync entry that is neither a file nor a directory.');
        }
    } else {
        nextDirectoryName = pathRemainder.substring(0, slashIndex);
        onGetDirectoryIdSuccess = function(directoryId) {
            syncAtPath(entry, directoryId, pathRemainder.substring(slashIndex + 1), callback);
        };
        idm.getDirectoryId(nextDirectoryName, currentDirectoryId, false /* shouldCreateDirectory */, onGetDirectoryIdSuccess);
    }
}

// This function uploads a file to Drive.
// TODO(maxw): Implement exponential backoff on 503 (and perhaps other?) responses.
function uploadFile(fileEntry, parentDirectoryId, callback) {
    var fileIdInfo;
    idm.getFileId(fileEntry.name, parentDirectoryId)
    .then(
        function(fileIdInfoLocal) {
            fileIdInfo = fileIdInfoLocal;
            var query = 'title = "' + fileEntry.name + '" and "' + parentDirectoryId + '" in parents and trashed = false';
            return idm.getDriveFileId(query);
        }
    ).then(
        function(driveIdInfo) {
            if (driveIdInfo && driveIdInfo.id == fileIdInfo.driveId) {
                console.log("File not uploaded because it's already there: ");
                console.log(fileIdInfo);
            } else {
                var onFileSuccess = function(file) {
                    // Read the file and send its contents.
                    var fileReader = new FileReader();
                    fileReader.onload = function(evt) {
                        // This is used to note whether a file was created or updated.
                        var fileAction;

                        // Create the data to send.
                        var metadata = { title: fileEntry.name,
                                         parents: [{ id: parentDirectoryId }] };
                        var boundary = '2718281828459045';
                        var body = [];
                        body.push('--' + boundary);
                        body.push('Content-Type: application/json');
                        body.push('');
                        body.push(JSON.stringify(metadata));
                        body.push('');
                        body.push('--' + boundary);
                        // TODO(maxw): Use the correct content type.
                        body.push('Content-Type: text/plain');
                        body.push('');
                        body.push(fileReader.result);
                        body.push('');
                        body.push('--' + boundary + '--');
                        var bodyString = body.join('\r\n');

                        // If there's a file id, update the file.  Otherwise, upload it anew.
                        var method = '';
                        var url = '';
                        if (fileIdInfo) {
                            fileAction = C.SYNC_ACTION_UPDATED;
                            method = 'PUT';
                            url = 'https://www.googleapis.com/upload/drive/v2/files/' + fileIdInfo[driveId] + '?uploadType=multipart';
                        } else {
                            fileAction = C.SYNC_ACTION_ADDED;
                            method = 'POST';
                            url = 'https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart';
                        }

                        // Send a request to upload the file.
                        xhr.request(
                            method, 
                            url,
                            'multipart/related; boundary=' + boundary,
                            bodyString
                        ).then(
                            function(fileAction) {
                                if(fileAction)
                                    console.log('File synced!');
                                else
                                    console.log('File not synced - offline');
                                callback(fileAction);
                            },
                            function(xhr) {
                                console.log('File failed to sync with status ' + xhr.status + '.');
                            }
                        )
                        .catch(function(e) {
                            console.log(e.stack);
                            errorCallback(e); 
                        });

                    };
                    fileReader.readAsBinaryString(file);
                };

                // Get the file.
                fileEntry.file(onFileSuccess);
            }
        },
        function(e) {
            console.log("getDriveFileId error: "+e);
        }    
    ).catch(
        function(e) {
            console.log(e.stack);
            errorCallback(e); 
        }
    );
}

// This function removes a file or directory from Drive.
function remove(entry, callback) {
    var onGetIdSuccess = function(fileIdInfo) {
        if (fileIdInfo.syncStatus == C.FILE_STATUS_SYNCED) {
            var fileId = fileIdInfo.driveId;
            var url = 'https://www.googleapis.com/drive/v2/files/' + fileId;
            xhr.delete(url).then(callback);
        }
    };

    // Get the file id and pass it on.
    var appIdIndex = entry.fullPath.indexOf(chrome.runtime.id);

    // If the app id isn't in the path, we can't remove it.
    if (appIdIndex < 0) {
        console.log("Entry cannot be removed because it is not a descendant of the app directory.");
        return;
    }

    var relativePath = entry.fullPath.substring(appIdIndex + chrome.runtime.id.length + 1);
    if (entry.isFile) {
        idm.getFileId(relativePath, _syncableAppDirectoryId, onGetIdSuccess);
    } else {
        idm.getDirectoryId(relativePath, _syncableAppDirectoryId, false /* shouldCreateDirectory */, onGetIdSuccess);
    }
}

// This function creates the app's syncable directory on Drive.
function createDirectory(directoryName, parentDirectoryId, callback) {
    // Create the data to send.
    var data = { title: directoryName,
                 mimeType: 'application/vnd.google-apps.folder' };
    if (parentDirectoryId) {
        data.parents = [{ id: parentDirectoryId }];
    }

    xhr.postJSON('https://www.googleapis.com/drive/v2/files', JSON.stringify(data)).then(
        function(responseText) {
            callback(responseText.id);
        },
        function(xhr) {
            console.log('Failed to create directory with status ' + xhr.status + '.');
        }
    ).catch(
        function(e) {
            console.log(e.stack);
            errorCallback(e); 
        }
    );
}

//--------------------
// Syncing from Drive
//--------------------

// This function checks for changes since the most recent change id.
// successCallback: function(numChanges)
// errorCallback: function()
function getDriveChanges(successCallback, errorCallback) {
    var NEXT_CHANGE_ID_KEY = C.SYNC_FILE_SYSTEM_PREFIX + '-' + chrome.runtime.id + '-next_change_id';

    new Promise(
        function(resolve, reject) { 
            chrome.storage.internal.get(NEXT_CHANGE_ID_KEY, resolve); 
        }
    ).then(
        function(items) {

            var nextChangeId = 1;
            if (items[NEXT_CHANGE_ID_KEY])
                nextChangeId = items[NEXT_CHANGE_ID_KEY];

            // Send a request to retrieve the changes.
            xhr.getJSON('https://www.googleapis.com/drive/v2/changes?startChangeId=' 
                + nextChangeId 
                + '&includeDeleted=true&includeSubscribed=true&maxResults=1000')
            .then(
                function(responseJson) {
                    if (!responseJson) {
                        if (typeof successCallback === 'function')
                            successCallback(null);
                            //successCallback(numRelevantChanges);
                            return;
                    }
                    var numChanges = responseJson.items.length;
                    console.log('Successfully retrieved ' + numChanges + ' changes.');

                    // Record the new change id, incrementing it to avoid retrieving a duplicate change later.
                    var nextChangeId = parseInt(responseJson.largestChangeId, 10) + 1;
                    var nextChangeIdObject = { };
                    nextChangeIdObject[NEXT_CHANGE_ID_KEY] = nextChangeId;
                    chrome.storage.internal.set(nextChangeIdObject);

                    // Track the number of relevant changes, to be sent to the callback.
                    var numRelevantChanges = 0;

                    // For each change received, check whether it's on a file in the syncable app folder.  If so, sync the change locally.
                    for (var i = 0; i < numChanges; i++) {
                        var change = responseJson.items[i];
                        if (change.deleted || change.file.explicitlyTrashed) {
                            var onGetFileNameForFileIdSuccess = function(fileIdInfo) {
                                if (fileIdInfo) {
                                    // TODO(maxw): Deal with the fact that this is incremented asynchronously (ie. too late) and so isn't mattering.
                                    numRelevantChanges++;
                                    console.log('Deleting ' + fileIdInfo.fileName + '.');
                                    deleteFile(fileIdInfo).then(function(fileEntry) {
                                        // Inform the listeners.
                                        var fileInfo = { fileEntry: fileEntry, status: C.FILE_STATUS_SYNCED, action: C.SYNC_ACTION_DELETED, direction: C.SYNC_DIRECTION_REMOTE_TO_LOCAL };
                                        for (var i = 0; i < fileStatusListeners.length; i++) {
                                            fileStatusListeners[i](fileInfo);
                                        }

                                        // Remove the file id from the cache.
                                        idm.removeDriveIdFromCache(fileIdInfo.fileName, null);
                                    });
                                }
                            };
                            idm.getFileIdInfoForFileId(change.fileId, onGetFileNameForFileIdSuccess);
                        } else {
                            var changedFile = change.file;
                            var numParents = changedFile.parents.length;
                            for (var j = 0; j < numParents; j++) {
                                if (changedFile.parents[j].id === _syncableAppDirectoryId) {
                                    // TODO(maxw): Determine if the file has actually been changed, rather than, for example, moved.
                                    numRelevantChanges++;
                                    var onGetFileIdSuccess = function(fileIdInfo) {
                                        if (fileIdInfo && fileIdInfo.modifiedDate == changedFile.modifiedDate) {
                                            console.log("modfied date unchanged so do nothing: " + changedFile.title);
                                        } else {
                                            console.log('Downloading ' + changedFile.title + '.');
                                            var onDownloadFileSuccess = function(fileEntry) {
                                                // TODO(maxw): Determine if the synced file has been created rather than updated.
                                                // Inform the listeners.
                                                var fileInfo = { fileEntry: fileEntry, status: C.FILE_STATUS_SYNCED, action: C.SYNC_ACTION_UPDATED, direction: C.SYNC_DIRECTION_REMOTE_TO_LOCAL };
                                                for (var i = 0; i < fileStatusListeners.length; i++) {
                                                    fileStatusListeners[i](fileInfo);
                                                }
                                                idm.cacheDriveId(fileEntry.name, change.fileId, change.modificationDate, C.FILE_STATUS_SYNCED, null);
                                            };
                                            downloadFile(changedFile, onDownloadFileSuccess);
                                        }
                                    }
                                    idm.getFileId(changedFile.title, _syncableAppDirectoryId, onGetFileIdSuccess);
                                }
                            }
                        }
                    }
                    if (typeof successCallback === 'function')
                        successCallback(numRelevantChanges);
                },
                errorCallback
            );
        },
        errorCallback
    ).catch(
        function(e) {
            console.log(e.stack);
            if (typeof errorCallback === 'function')
                errorCallback(e); 
        }
    );
}

// This function deletes a file locally.
function deleteFile(fileIdInfo) {
    return new Promise(function(fileIdInfo, callback) {
        var getFileFlags = { create: true, exclusive: false };
        DirectoryEntry.prototype.getFile.call(
            localDirectoryEntry, 
            fileIdInfo.fileName, 
            getFileFlags, 
            function(fileIdInfo, fileEntry) {
                fileEntry.remove(
                    function(fileIdInfo) {
                        console.log('Successfully removed file ' + fileIdInfo.fileName + '.');
                        callback(fileEntry);
                    }.bind(null, fileIdInfo),
                    function(fileIdInfo, e) {
                        console.log('Failed to remove file ' + fileIdInfo.fileName + '.');
                    }.bind(null, fileIdInfo)
                );
            }.bind(null, fileIdInfo),
            function(e) {
                console.log('Failed to get file: ' + fileIdInfo.fileName);
            }.bind(null, fileIdInfo)
        );

        //localDirectoryEntry.getFile(fileIdinfo.fileName, getFileFlags, onGetFileSuccess, onGetFileError);
    }.bind(null, fileIdInfo));
}

// This function downloads the given Drive file.
function downloadFile(file, callback) {
    // Send a request to retrieve the changes.
    xhr.get(file.downloadUrl).then(
        function(fileEntry) {
            console.log('Download of ' + file.title + ' complete!');
            return saveData(file.title, fileEntry);
        },
        function(e) {
            console.log('Get download failed with status ' + e + '.');
        }
    )
    .then(
        function(fileEntry) {
            console.log('Saved: ' + file.title + ' complete!');
            callback(fileEntry);
        },
        function(e) {
            console.log('Save failed with: ' + e + '.');
        }
    ).catch(
        function(e) {
            console.log(e.stack);
            errorCallback(e); 
        }
    );
}

// This function saves the supplied data to a file at the given file name.
function saveData(fileName, data, callback) {
    var saveDataPromise = function(callback) {
        var onGetFileSuccess = function(fileEntry) {
            var onCreateWriterSuccess = function(fileWriter) {
                // TODO: need to truncate first
                fileWriter.write(data);
                callback(fileEntry);
            };
            var onCreateWriterError = function(e) {
                console.log('Failed to create writer.');
            };
            fileEntry.createWriter(onCreateWriterSuccess, onCreateWriterError);
        };
        var onGetFileError = function(e) {
            console.log('Failed to get file: ' + fileName);
            var msg = '';
            switch ( e.code ) {
                case FileError.ENCODING_ERR:
                    msg = 'ENCODING_ERR';
                    break;
                case FileError.INVALID_MODIFICATION_ERR:
                    msg = 'INVALID_MODIFICATION_ERR';
                    break;
                case FileError.INVALID_STATE_ERR:
                    msg = 'INVALID_STATE_ERR';
                    break;
                case FileError.NO_MODIFICATION_ALLOWED_ERR:
                    msg = 'NO_MODIFICATION_ALLOWED_ERR';
                    break;
                case FileError.NOT_FOUND_ERR:
                    msg = 'NOT_FOUND_ERR';
                    break;
                case FileError.NOT_READABLE_ERR:
                    msg = 'NOT_READABLE_ERR';
                    break;
                case FileError.PATH_EXISTS_ERR:
                    msg = 'PATH_EXISTS_ERR';
                    break;
                case FileError.QUOTA_EXCEEDED_ERR:
                    msg = 'QUOTA_EXCEEDED_ERR';
                    break;
                case FileError.SECURITY_ERR:
                    msg = 'SECURITY_ERR';
                    break;
                case FileError.TYPE_MISMATCH_ERR:
                    msg = 'TYPE_MISMATCH_ERR';
                    break;
                default:
                    msg = 'Unknown Error';
                    break;
            };
            console.log( 'Error: ' + msg );
        };

        var getFileFlags = { create: true, exclusive: false };
        localDirectoryEntry.getFile(fileName, getFileFlags, onGetFileSuccess, onGetFileError);
    }
    if (!callback) {
        return new Promise(saveDataPromise);
    } else {
        saveDataPromise(callback);
    }

}

function watchNetwork(detail) {
    if (lastNetworkState == 'temporary_unavailable' && detail.state == 'running') {
        console.log("Network back online; reset getDriveChanges timer");
        getDriveChanges();
        // I think we want to call sync on any getFileId's that are in 'pending'. need to get the FileEntry
        chrome.storage.internal.get(
            function(db) {
                console.log(db);

                var keys = Object.keys(db);
                var filtered = keys.filter(function(value) {
                    return db[value].syncStatus == 'pending';
                });
                console.log(filtered);
            }
        )
    }
    lastNetworkState = detail.state;
}

//=======================
// chrome.syncFileSystem
//=======================

exports.requestFileSystem = function(callback) {
    var manifest = chrome.runtime.getManifest();
    if (!manifest) {
        throw new Error("Manifest does not exist and was not set.");
    }

    if (manifest.incoming_sync_delay && manifest.incoming_sync_delay.initial && manifest.incoming_sync_delay.maximum) {
        C.INITIAL_REMOTE_TO_LOCAL_SYNC_DELAY = manifest.incoming_sync_delay.initial;
        C.MAXIMUM_REMOTE_TO_LOCAL_SYNC_DELAY = manifest.incoming_sync_delay.maximum;
    } else {
        console.log("Initial and maximum incoming sync delay not specified in manifest; using defaults.");
    }
    var onRequestFileSystemSuccess = function(entry) {
        var fileSystem = entry.filesystem;
        
        // Set the default conflict resolution policy.
        conflictResolutionPolicy = C.CONFLICT_RESOLUTION_POLICY_LAST_WRITE_WIN;

        // Create or get the subdirectory for this app.
        var getDirectoryFlags = { create: true, exclusive: false };
        var onCreateAppDirectoryOnDriveSuccess = function(directoryEntry) {
            // Set the root of the file system to the app subdirectory.
            fileSystem.root = directoryEntry;

            // Set up regular remote-to-local checks.
            var remoteToLocalSyncDelay = C.INITIAL_REMOTE_TO_LOCAL_SYNC_DELAY;
            var onGetDriveChangesError = function() {
                // Use the same timeout.
                pollTimer = window.setTimeout(getDriveChanges, remoteToLocalSyncDelay, onGetDriveChangesSuccess, onGetDriveChangesError);
            };
            var onGetDriveChangesSuccess = function(numChanges) {
                console.log('Relevant changes: ' + numChanges + '.');
                if (numChanges === 0) {
                    if (remoteToLocalSyncDelay < C.MAXIMUM_REMOTE_TO_LOCAL_SYNC_DELAY) {
                        if (remoteToLocalSyncDelay * 2 <= MAXIMUM_REMOTE_TO_LOCAL_SYNC_DELAY) {
                          remoteToLocalSyncDelay *= 2;
                          console.log('  Remote-to-local sync delay doubled.');
                        } else {
                          remoteToLocalSyncDelay = C.MAXIMUM_REMOTE_TO_LOCAL_SYNC_DELAY;
                          console.log('  Remote-to-local sync increased to and capped at ' + remoteToLocalSyncDelay + 'ms.');
                        }
                    } else {
                        console.log('  Remote-to-local sync delay capped at ' + remoteToLocalSyncDelay + 'ms.');
                    }
                } else if (!numChanges) {
                    remoteToLocalSyncDelay = C.INITIAL_REMOTE_TO_LOCAL_SYNC_OFFLINE_DELAY;
                    console.log('  Remote-to-local sync delay set for offline.');
                } else {
                    remoteToLocalSyncDelay = C.INITIAL_REMOTE_TO_LOCAL_SYNC_DELAY;
                    console.log('  Remote-to-local sync delay reset.');
                }
                pollTimer = window.setTimeout(getDriveChanges, remoteToLocalSyncDelay, onGetDriveChangesSuccess, onGetDriveChangesError);
            };
            pollTimer = window.setTimeout(getDriveChanges, remoteToLocalSyncDelay, onGetDriveChangesSuccess, onGetDriveChangesError);

            exports.onServiceStatusChanged.addListener(exports.getServiceStatus.bind(null, watchNetwork));

            // Pass on the file system!
            if (typeof callback === 'function') {
                callback(fileSystem);
            }
        };
        var onGetDirectorySuccess = function(directoryEntry) {
            localDirectoryEntry = directoryEntry;
            // We have to make some changes to this directory entry to enable syncability.
            // If a file is ever retrieved or created in this directory entry, we want to enable its syncability before passing it to a callback.
            enableSyncabilityForDirectoryEntry(directoryEntry);
            createAppDirectoryOnDrive(directoryEntry, onCreateAppDirectoryOnDriveSuccess, callback);
        };
        var onGetDirectoryFailure = function(e) {
            console.log('Failed to get directory.');
            chrome.runtime.lastError = { message: "Sync: Failed to get local filesystem for app" };
            if (typeof callback === 'function') {
                callback();
            }
        };

        // TODO(maxw): Make the directory name app-specific.
        fileSystem.root.getDirectory(chrome.runtime.id, getDirectoryFlags, onGetDirectorySuccess, onGetDirectoryFailure);
    };
    var onRequestFileSystemFailure = function(e) {
        console.log("Failed to get file system.");
        chrome.runtime.lastError = { message: "Sync: Failed to get local filesystem" };
        if (typeof callback === 'function') {
            callback();
        }
    };

    // Request the file system.
    exec(function(url) {
      window.resolveLocalFileSystemURL(url, onRequestFileSystemSuccess, onRequestFileSystemFailure);
    }, onRequestFileSystemFailure, "SyncFileSystem", "getRootURL", []);
};

exports.setConflictResolutionPolicy = function(policy, callback) {
    conflictResolutionPolicy = policy;
    if (callback) {
        callback();
    }
};

exports.getConflictResolutionPolicy = function(callback) {
    if (callback) {
        callback(conflictResolutionPolicy);
    }
};

exports.getUsageAndQuota = function(fileSystem, callback) {
    // TODO(maxw): Implement this!
    console.log('getUsageAndQuota');
    callback();
};

exports.getFileStatus = function(fileEntry, callback) {
    if (callback) {
        idm.getFileSyncStatus(fileEntry.name, callback)
    }
};

exports.getFileStatuses = function(fileEntries, callback) {
    // TODO(maxw): Implement this!
    console.log('getFileStatuses');

    var statuses = [];
    for (var entry in fileEntries) {
        statues.push({Entry: entry, FileStatus: null});
    }
    if (callback) {
        callback(statuses);
    }
};

exports.getServiceStatus = function(callback) {
    var detail = {};
    /*
        from chrome's syncFileSystem:
            "initializing"
            "running"
            "authentication_required"
            "temporary_unavailable"
            "disabled"
     */

    switch (navigator.connection.type) {
        case Connection.UNKNOWN:
            detail.state = 'temporary_unavailable';
            detail.description = 'Unknown connection';
            break;
        case Connection.ETHERNET:
            detail.state = 'running';
            detail.description = 'Ethernet connection';
            break;
        case Connection.WIFI:
            detail.state = 'running';
            detail.description = 'WiFi connection';
            break;
        case Connection.CELL_2G:
            detail.state = 'running';
            detail.description = 'Cell 2G connection';
            break;
        case Connection.CELL_3G:
            detail.state = 'running';
            detail.description = 'Cell 3G connection';
            break;
        case Connection.CELL_4G:
            detail.state = 'running';
            detail.description = 'Cell 4G connection';
            break;
        case Connection.CELL:
            detail.state = 'running';
            detail.description = 'Cell generic connection';
            break;
        case Connection.NONE:
            detail.state = 'temporary_unavailable';
            detail.description = 'No network connection';
            break;
        default:
            detail.state = 'temporary_unavailable';
            detail.description = 'Undefined connection state';
            break;
    }

    console.log(detail);
    callback(detail);
};

exports.onServiceStatusChanged = { };
exports.onServiceStatusChanged.addListener = function(listener) {
    if (typeof listener === 'function') {
        extendedListener = function(callback) {
            exports.getServiceStatus(listener);
        };
        document.addEventListener('offline', extendedListener, false);
        document.addEventListener('online', extendedListener, false);
    } else {
        console.log('onServiceStatusChanged: Attempted to add a non-function listener: ' + listener);
        console.log(listener);
    }
};

exports.onFileStatusChanged = { };
exports.onFileStatusChanged.addListener = function(listener) {
    if (typeof listener === 'function') {
        fileStatusListeners.push(listener);
    } else {
        console.log('onFileStatusChanged: Attempted to add a non-function listener: ' + listener);
    }
};

exports.resetSyncFileSystem = function (callback) {
  // Cancel any outstanding drive poll timeouts
  window.clearTimeout(pollTimer);
  // Remove the cached files
  if (localDirectoryEntry) {
    localDirectoryEntry.removeRecursively(function() {
      // Reset the "next change" counter
      reset = {};
      reset[C.SYNC_FILE_SYSTEM_PREFIX + '-' + chrome.runtime.id + '-next_change_id'] = 1;
      chrome.storage.internal.set(reset, function() {
        // Restart the sync process
        exports.requestFileSystem(callback);
      });
    });
  }
};
