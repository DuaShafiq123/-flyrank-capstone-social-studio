'use strict';

/**
 * Constraint profiles: the rule card for each platform.
 * validate.js enforces every field here. Nothing is "hoped for".
 */
const profiles = {
  x: {
    platform: 'x',
    label: 'X-style short post',
    maxLength: 280,
    minLength: 40,
    urlWeight: 23, // X counts every link as 23 characters
    maxHashtags: 2,
    minHashtags: 1,
    requireLink: true,
    tone: {
      name: 'punchy',
      maxExclamations: 1,
      maxEmojis: 2,
      maxShoutingWords: 1,
      bannedPhrases: ['click here', 'buy now', '100% guaranteed', 'you won\'t believe'],
    },
  },
  linkedin: {
    platform: 'linkedin',
    label: 'LinkedIn-style professional post',
    maxLength: 3000,
    minLength: 300,
    maxHashtags: 5,
    minHashtags: 3,
    requireLink: true,
    tone: {
      name: 'professional',
      maxExclamations: 1,
      maxEmojis: 0,
      maxShoutingWords: 0,
      bannedPhrases: ['lol', 'omg', 'gonna', 'wanna', 'bro', 'dude', 'insane', 'crazy'],
    },
  },
  telegram: {
    platform: 'telegram',
    label: 'Telegram channel post (friendly)',
    maxLength: 1024,
    minLength: 80,
    maxHashtags: 3,
    minHashtags: 0,
    requireLink: true,
    tone: {
      name: 'friendly',
      maxExclamations: 3,
      maxEmojis: 4,
      maxShoutingWords: 1,
      bannedPhrases: ['synergy', 'leverage', 'circle back', 'per my last'],
    },
  },
};

module.exports = { profiles };
