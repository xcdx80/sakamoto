// Node tests are trusted server entry points; Next still enforces server-only in application builds.
const path = require.resolve('server-only');
require.cache[path] = { id: path, filename: path, loaded: true, exports: {} };
