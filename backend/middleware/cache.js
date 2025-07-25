const { getCache, setCache } = require('../utils/cache');

/**
 * Middleware for caching API responses
 * @param {number} duration - Cache duration in seconds
 * @param {Function} keyGenerator - Function to generate cache key (optional)
 * @returns {Function} Express middleware
 */
const cacheMiddleware = (duration, keyGenerator) => {
  return async (req, res, next) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate cache key
    const key = keyGenerator ? 
      keyGenerator(req) : 
      `${req.originalUrl || req.url}:${req.userId || 'anonymous'}`;

    try {
      // Try to get from cache
      const cachedData = await getCache(key);
      
      if (cachedData) {
        return res.json(cachedData);
      }

      // Store original res.json method
      const originalJson = res.json;

      // Override res.json method to cache the response
      res.json = function(data) {
        // Cache the response data
        setCache(key, data, duration).catch(err => {
          console.error('Cache set error:', err);
        });

        // Call the original json method
        return originalJson.call(this, data);
      };

      next();
    } catch (err) {
      console.error('Cache middleware error:', err);
      next();
    }
  };
};

module.exports = cacheMiddleware;