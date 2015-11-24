//-----------
// Constants
//-----------

exports.SYNC_ACTION_ADDED = 'added';
exports.SYNC_ACTION_DELETED = 'deleted';
exports.SYNC_ACTION_UPDATED = 'updated';

exports.FILE_STATUS_CONFLICTING = 'conflicting';
exports.FILE_STATUS_PENDING = 'pending';
exports.FILE_STATUS_SYNCED = 'synced';
exports.FILE_STATUS_NA = null;

exports.SYNC_DIRECTION_LOCAL_TO_REMOTE = 'local_to_remote';
exports.SYNC_DIRECTION_REMOTE_TO_LOCAL = 'remote_to_local';

exports.CONFLICT_RESOLUTION_POLICY_LAST_WRITE_WIN = 'last_write_win';
exports.CONFLICT_RESOLUTION_POLICY_MANUAL = 'manual';

exports.SYNC_FILE_SYSTEM_PREFIX = 'sfs';

// Error codes.
exports.FILE_NOT_FOUND_ERROR = 1;
exports.MULTIPLE_FILES_FOUND_ERROR = 2;
exports.REQUEST_FAILED_ERROR = 3;
