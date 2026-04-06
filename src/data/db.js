'use strict';
/**
 * db.js — Prisma client singleton
 *
 * A single PrismaClient instance is shared across the entire process.
 * Creating multiple instances wastes connection-pool slots.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.DEBUG === 'true'
    ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
    : [{ emit: 'stdout', level: 'error' }],
});

module.exports = prisma;
