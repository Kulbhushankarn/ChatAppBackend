const compression = require('compression');

/**
 * Configure compression middleware with optimal settings
 * @returns {Function} Configured compression middleware
 */
const configureCompression = () => {
  return compression({
    // Filter function to determine which responses to compress
    filter: (req, res) => {
      // Don't compress if client doesn't accept it
      if (req.headers['x-no-compression']) {
        return false;
      }
      
      // Use compression for all text-based responses
      return (
        res.getHeader('Content-Type') && 
        (/text/.test(res.getHeader('Content-Type')) ||
         /json/.test(res.getHeader('Content-Type')) ||
         /javascript/.test(res.getHeader('Content-Type')) ||
         /css/.test(res.getHeader('Content-Type')))
      );
    },
    // Compression level (1-9, where 9 is maximum compression but slower)
    level: 6,
    // Minimum size threshold in bytes to compress response
    threshold: 1024 // Don't compress responses smaller than 1KB
  });
};

module.exports = configureCompression;