const { createClient } = require('redis');

let redisClient;

// Initialize Redis client
async function initRedis() {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    await redisClient.connect();
    console.log('Redis client connected');
    return redisClient;
  } catch (error) {
    console.error('Redis connection failed:', error);
    // Continue without Redis if connection fails
    return null;
  }
}

// Get data from cache
async function getCache(key) {
  if (!redisClient) return null;
  
  try {
    const cachedData = await redisClient.get(key);
    return cachedData ? JSON.parse(cachedData) : null;
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
}

// Set data in cache with expiration
async function setCache(key, data, expireSeconds = 3600) {
  if (!redisClient) return false;
  
  try {
    await redisClient.set(key, JSON.stringify(data), {
      EX: expireSeconds
    });
    return true;
  } catch (error) {
    console.error('Redis set error:', error);
    return false;
  }
}

// Delete cache by key
async function deleteCache(key) {
  if (!redisClient) return false;
  
  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    console.error('Redis delete error:', error);
    return false;
  }
}

// Delete cache by pattern
async function deleteCachePattern(pattern) {
  if (!redisClient) return false;
  
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    return true;
  } catch (error) {
    console.error('Redis delete pattern error:', error);
    return false;
  }
}

module.exports = {
  initRedis,
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern
};