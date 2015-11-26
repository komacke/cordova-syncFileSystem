// Copyright (c) 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var exec = cordova.require('cordova/exec');
var identity = cordova.require('com.komacke.chromium.syncfilesystem.Identity');
var idm = cordova.require('com.komacke.chromium.syncfilesystem.IdManagement');
var C = cordova.require('com.komacke.chromium.syncfilesystem.Constants');

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
        Entry.prototype.remove.call(entry, augmentedSuccessCallback, errorCallback);
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
    identity.getTokenStringPromise().then(
        function() {
        // Get the Drive "Chrome Syncable FileSystem" directory id.
            idm.getDirectoryId('Chrome Syncable FileSystem', null /* parentDirectoryId */, true /* shouldCreateDirectory */, onGetSyncableRootDirectoryIdSuccess);
        },
        errorCallback
    );
}

// This function syncs an entry to Drive, creating it if necessary.
function sync(entry, callback) {
    identity.getTokenString().then(
//    identity.getTokenStringPromise().then(
        function() {
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
                if (entry.isFile) {
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
    );
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
    var onGetTokenStringSuccess = function() {
        var onGetFileIdSuccess = function(fileIdInfo) {
            var query = 'title = "' + fileEntry.name + '" and "' + parentDirectoryId + '" in parents and trashed = false';
            var onGetDriveFileIdSuccess = function(driveIdInfo) {
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

                            // Send a request to upload the file.
                            var xhr = new XMLHttpRequest();
                            xhr.onreadystatechange = function() {
                                if (xhr.readyState === 4) {
                                    if (xhr.status === 200) {
                                        console.log('File synced!');
                                        callback(fileAction);
                                    } else {
                                        console.log('File failed to sync with status ' + xhr.status + '.');
                                    }
                                }
                            };

                            // If there's a file id, update the file.  Otherwise, upload it anew.
                            if (fileIdInfo) {
                                fileAction = C.SYNC_ACTION_UPDATED;
                                xhr.open('PUT', 'https://www.googleapis.com/upload/drive/v2/files/' + fileIdInfo[driveId] + '?uploadType=multipart');
                            } else {
                                fileAction = C.SYNC_ACTION_ADDED;
                                xhr.open('POST', 'https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart');
                            }
                            xhr.setRequestHeader('Content-Type', 'multipart/related; boundary=' + boundary);
                            //xhr.setRequestHeader('Content-Length', bodyString.length);
                            xhr.setRequestHeader('Authorization', 'Bearer ' + identity.tokenString);
                            xhr.send(bodyString);
                        };
                        fileReader.readAsBinaryString(file);
                    };

                    // Get the file.
                    fileEntry.file(onFileSuccess);
                }
            };
            idm.getDriveFileId(query, onGetDriveFileIdSuccess, function(e) {console.log("getDriveFileId error: "+e);});
        };
        // Get the file id and pass it on.
        idm.getFileId(fileEntry.name, parentDirectoryId, onGetFileIdSuccess);
    };

    identity.getTokenString(onGetTokenStringSuccess);
}

// This function removes a file or directory from Drive.
function remove(entry, callback) {
    var onGetIdSuccess = function(fileIdInfo) {
        var fileId = fileIdInfo[driveId];

        // Delete the entry.
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200 || xhr.status === 204) {
                    console.log('File removed!');
                    callback();
                } else {
                    console.log('Failed to remove entry with status ' + xhr.status + '.');
                }
            }
        };

        xhr.open('DELETE', 'https://www.googleapis.com/drive/v2/files/' + fileId);
        xhr.setRequestHeader('Authorization', 'Bearer ' + identity.tokenString);
        xhr.send();
    };
    var onGetTokenStringSuccess = function() {
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
    };

    identity.getTokenString(onGetTokenStringSuccess);
}

// This function creates the app's syncable directory on Drive.
function createDirectory(directoryName, parentDirectoryId, callback) {
    var onGetTokenStringSuccess = function() {
        // Create the data to send.
        var data = { title: directoryName,
                     mimeType: 'application/vnd.google-apps.folder' };
        if (parentDirectoryId) {
            data.parents = [{ id: parentDirectoryId }];
        }

        // Send a request to upload the file.
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    console.log('Directory created!');
                    callback(JSON.parse(xhr.responseText).id);
                } else {
                    console.log('Failed to create directory with status ' + xhr.status + '.');
                }
            }
        };

        xhr.open('POST', 'https://www.googleapis.com/drive/v2/files');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + identity.tokenString);
        xhr.send(JSON.stringify(data));
    };

    identity.getTokenString(onGetTokenStringSuccess);
}

//--------------------
// Syncing from Drive
//--------------------

// This function checks for changes since the most recent change id.
// successCallback: function(numChanges)
// errorCallback: function()
function getDriveChanges(successCallback, errorCallback) {
    var NEXT_CHANGE_ID_KEY = C.SYNC_FILE_SYSTEM_PREFIX + '-' + chrome.runtime.id + '-next_change_id';
    var onGetTokenStringSuccess = function() {
        // Send a request to retrieve the changes.
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    var responseJson = JSON.parse(xhr.responseText);
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
                            var onGetFileNameForFileIdSuccess = function(fileName) {
                                if (fileName) {
                                    // TODO(maxw): Deal with the fact that this is incremented asynchronously (ie. too late) and so isn't mattering.
                                    numRelevantChanges++;
                                    console.log('Deleting ' + fileName + '.');
                                    var onDeleteFileSuccess = function(fileEntry) {
                                        // Inform the listeners.
                                        var fileInfo = { fileEntry: fileEntry, status: C.FILE_STATUS_SYNCED, action: C.SYNC_ACTION_DELETED, direction: C.SYNC_DIRECTION_REMOTE_TO_LOCAL };
                                        for (var i = 0; i < fileStatusListeners.length; i++) {
                                            fileStatusListeners[i](fileInfo);
                                        }

                                        // Remove the file id from the cache.
                                        idm.removeDriveIdFromCache(fileName, null);
                                    };
                                    deleteFile(fileName, onDeleteFileSuccess);
                                }
                            };
                            idm.getFileNameForFileId(change.fileId, onGetFileNameForFileIdSuccess);
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
                    successCallback(numRelevantChanges);
                } else {
                    console.log('Change search failed with status ' + xhr.status + '.');
                    errorCallback();
                }
            }
        };

        // Retrieve the next change id to use as a starting point.
        var getCallback = function(items) {
            var nextChangeId = 1;
            if (items[NEXT_CHANGE_ID_KEY]) {
                nextChangeId = items[NEXT_CHANGE_ID_KEY];
            }

            // TODO(maxw): Use `nextLink` to get multiple pages of change results.
            xhr.open('GET', 'https://www.googleapis.com/drive/v2/changes?startChangeId=' + nextChangeId + '&includeDeleted=true&includeSubscribed=true&maxResults=1000');
            xhr.setRequestHeader('Authorization', 'Bearer ' + identity.tokenString);
            xhr.send();
        };
        chrome.storage.internal.get(NEXT_CHANGE_ID_KEY, getCallback);
    };

    identity.getTokenString(onGetTokenStringSuccess, errorCallback);
}

// This function deletes a file locally.
function deleteFile(fileName, callback) {
    var onGetFileSuccess = function(fileEntry) {
        var onRemoveSuccess = function() {
            console.log('Successfully removed file ' + fileName + '.');
            callback(fileEntry);
        };
        var onRemoveError = function(e) {
            console.log('Failed to remove file ' + fileName + '.');
        };
        fileEntry.remove(onRemoveSuccess, onRemoveError);
    };
    var onGetFileError = function(e) {
        console.log('Failed to get file.');
    };

    var getFileFlags = { create: true, exclusive: false };
    localDirectoryEntry.getFile(fileName, getFileFlags, onGetFileSuccess, onGetFileError);
    //DirectoryEntry.prototype.getFile.call(localDirectoryEntry, fileName, getFileFlags, onGetFileSuccess, onGetFileError);
}

// This function downloads the given Drive file.
function downloadFile(file, callback) {
    // Send a request to retrieve the changes.
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                var onSaveDataSuccess = function(fileEntry) {
                    console.log('Download of ' + file.title + ' complete!');
                    callback(fileEntry);
                }
                saveData(file.title, xhr.responseText, onSaveDataSuccess);
            } else {
                console.log('Download failed with status ' + xhr.status + '.');
            }
        }
    };

    xhr.open('GET', file.downloadUrl);
    xhr.setRequestHeader('Authorization', 'Bearer ' + identity.tokenString);
    xhr.send();
}

// This function saves the supplied data to a file at the given file name.
function saveData(fileName, data, callback) {
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

//=======================
// chrome.syncFileSystem
//=======================

exports.requestFileSystem = function(callback) {
    var manifest = chrome.runtime.getManifest();
    if (!manifest) {
        throw new Error("Manifest does not exist and was not set.");
    }
    // Numerical constants.
    var INITIAL_REMOTE_TO_LOCAL_SYNC_DELAY = 2000;
    var MAXIMUM_REMOTE_TO_LOCAL_SYNC_DELAY = 64000;

    if (manifest.incoming_sync_delay && manifest.incoming_sync_delay.initial && manifest.incoming_sync_delay.maximum) {
        INITIAL_REMOTE_TO_LOCAL_SYNC_DELAY = manifest.incoming_sync_delay.initial;
        MAXIMUM_REMOTE_TO_LOCAL_SYNC_DELAY = manifest.incoming_sync_delay.maximum;
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
            var remoteToLocalSyncDelay = INITIAL_REMOTE_TO_LOCAL_SYNC_DELAY;
            var onGetDriveChangesError = function() {
                // Use the same timeout.
                pollTimer = window.setTimeout(getDriveChanges, remoteToLocalSyncDelay, onGetDriveChangesSuccess, onGetDriveChangesError);
            };
            var onGetDriveChangesSuccess = function(numChanges) {
                console.log('Relevant changes: ' + numChanges + '.');
                if (numChanges === 0) {
                    if (remoteToLocalSyncDelay < MAXIMUM_REMOTE_TO_LOCAL_SYNC_DELAY) {
                        if (remoteToLocalSyncDelay * 2 <= MAXIMUM_REMOTE_TO_LOCAL_SYNC_DELAY) {
                          remoteToLocalSyncDelay *= 2;
                          console.log('  Remote-to-local sync delay doubled.');
                        } else {
                          remoteToLocalSyncDelay = MAXIMUM_REMOTE_TO_LOCAL_SYNC_DELAY;
                          console.log('  Remote-to-local sync increased to and capped at ' + remoteToLocalSyncDelay + 'ms.');
                        }
                    } else {
                        console.log('  Remote-to-local sync delay capped at ' + remoteToLocalSyncDelay + 'ms.');
                    }
                } else {
                    remoteToLocalSyncDelay = INITIAL_REMOTE_TO_LOCAL_SYNC_DELAY;
                    console.log('  Remote-to-local sync delay reset.');
                }
                pollTimer = window.setTimeout(getDriveChanges, remoteToLocalSyncDelay, onGetDriveChangesSuccess, onGetDriveChangesError);
            };
            pollTimer = window.setTimeout(getDriveChanges, remoteToLocalSyncDelay, onGetDriveChangesSuccess, onGetDriveChangesError);

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
    if (typeof(listener) == 'function') {
        extendedListener = function(callback) {
            exports.getServiceStatus(listener);
        };
        document.addEventListener('offline', extendedListener, false);
        document.addEventListener('online', extendedListener, false);
    } else {
        console.log('onServiceStatusChanged: Attempted to add a non-function listener.');
    }
};

exports.onFileStatusChanged = { };
exports.onFileStatusChanged.addListener = function(listener) {
    if (typeof(listener) == 'function') {
        fileStatusListeners.push(listener);
    } else {
        console.log('onFileStatusChanged: Attempted to add a non-function listener.');
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
