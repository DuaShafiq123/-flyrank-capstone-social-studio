---
title: Caching in Node.js: A Practical Guide
url: https://example.com/blog/caching-in-nodejs
tags: [nodejs, caching, redis, performance, backend]
---

# Caching in Node.js: A Practical Guide

Caching is the cheapest performance win most Node.js services never take. Instead of asking the database the same question a thousand times a minute, you keep the answer close and reuse it until it goes stale.

This guide walks through three layers of caching, from a simple in-memory map to a shared Redis cache, and explains when each one is the right tool. You will also see how to pick a sensible expiry time and how to avoid serving data that is out of date.

## Start with an in-memory cache

For a single process, a Map with a timestamp is often enough. It costs nothing to run and answers in microseconds, but every instance of your app keeps its own copy, and the memory is lost on restart.

```js
const cache = new Map();
function getCached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = load();
  cache.set(key, { value, at: Date.now() });
  return value;
}
```

## Move to Redis when you scale out

Once you run more than one instance, a shared cache keeps every instance consistent. Redis gives you expiry, atomic counters and eviction policies out of the box.

## Choose the right expiry time

A short TTL keeps data fresh but hits the database more often. A long TTL is fast but risks stale answers. Start with the question: how wrong can this data be, and for how long?

## Invalidate on write

The safest pattern is to delete the cached key whenever the underlying record changes, so the next read loads fresh data.

- Cache reads, not writes
- Always set an expiry
- Measure your hit rate before and after
