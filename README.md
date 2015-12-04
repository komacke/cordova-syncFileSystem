# com.komacke.chromium.syncfilesystem Plugin

This is an implementation of chrome.syncFileSystem for cca. It started from a mostly complete
implementation at https://github.com/MobileChromeApps/mobile-chrome-apps.git@0.5.1 using
folder ./chrome-cordova/plugins/chrome.syncFileSystem/.

This plugin still advertises itself as chrome.syncFileSystem for compatibility with manifest.json for 
chrome apps. Perhaps it will find it's way back into MobileChromeApps.

## Status

Alpha on Android and iOS.  Use this plugin at your own risk! I'm debugging it on Android. A friend
promises me he'll try it soon on iOS. The OS dependency is quite limited so good chance it will work
as well on iOS.

## TODO LIST

* Only the manual resolution policy is supported. Add support for auto
* support getUsageAndQuota, getFileStatuses
* refactor to better separate sync'ing with drive and manipulating local files
* Failed sync uploads are not currently retried (until another change triggers another sync attempt).
* FileEntry.moveTo and FileEntry.copyTo do not trigger syncs.

# Example usage:

Example of using this is at https://github.com/komacke/HamLog. Before compiling your cca app, manually
add the plugin with: cca plugins add https://github.com/komacke/cordova-syncFileSystem.git

## Registering Your App

This plugin depends on the [chrome.identity plugin](http://plugins.cordova.io/#/package/org.chromium.identity), so 
the corresponding steps must be taken.

In addition, the Drive API must be enabled.  On the left sidebar, navigate to "APIs & auth" > "APIs" and turn 
on the Drive API.

## Updating Your Manifest

In addition to the manfest changes for `chrome.identity`, you will need to add the Google Drive 
scope `https://www.googleapis.com/auth/drive` to the "oauth2" item in your **manifest.json** file. 
You will also ned to set the "`key`" property of your manifest, in order to share data between 
instances of the application. See instructions [here](http://developer.chrome.com/apps/manifest/key) 
for information about how to get that key out of a packed packaged app.

## Reference

The API reference is [here](https://developer.chrome.com/apps/syncFileSystem.html).

# Release Notes

## 0.2.0 (Not yet released)
- implement onServiceStatusChanged
- implement getServiceStatus
- implement getFileStatus
- add tracking of meta data associated with files for better sync management
- fix loop of downloading, then uploading, then downloading, etc
- add support for delete (or fix it - maybe I'm the one who broke it) local and remote
- add support for pushing changes that were made while offline after reconnecting
- a bunch of refactoring for personal readability of code

## 0.1.5 (October 21, 2014)
- Documentation updates.

## 0.1.3 (August 20, 2014)
- Internal changes only (new PluginManager).

## 0.1.2 (May 8, 2014)
- Updated documentation.

## 0.1.1 (April 1, 2014)
- Updated documentation.
- Improved error checking and handling.
- Added some internal caching and a function to clear the cache.
- Made callback functions optional.
- Fixed some lint errors.

