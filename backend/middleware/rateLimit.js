const rateLimit = require('express-rate-limit');

/**
 * Configure rate limiting middleware with different settings for various endpoints
 */
const rateLimiters = {
  /**
   * General API rate limiter - moderate limits for most API endpoints
   */
  general: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { message: 'Too many requests, please try again later.' }
  }),

  /**
   * Authentication rate limiter - stricter limits for login/register endpoints
   * to prevent brute force attacks
   */
  auth: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // limit each IP to 10 login/register attempts per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many login attempts, please try again later.' }
  }),

  /**
   * Message sending rate limiter - prevent spam
   */
  messages: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // limit each IP to 20 messages per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'You are sending messages too quickly, please slow down.' }
  }),

  /**
   * User profile update rate limiter
   */
  userUpdate: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 profile updates per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many profile update attempts, please try again later.' }
  })
};

module.exports = rateLimiters;