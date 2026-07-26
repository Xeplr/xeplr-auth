/**
 * ticketService — one-time-use tickets for out-of-band auth channels
 * (SSE, WebSocket) where the browser can't attach a normal Authorization
 * header.
 *
 * FLOW
 *   1. Client makes an AUTHENTICATED POST to /auth/api/sse-ticket
 *   2. issueTicket({ userId, scopes }) mints a random 24-byte token,
 *      stores it in Redis with a 30s TTL, returns { ticket, expiresIn }
 *   3. Client opens EventSource('/events?ticket=<tk>&topics=...')
 *   4. SSE handler calls consumeTicket(tk) which atomically GETDEL's
 *      the token. Returns { userId, scopes } on success, null on
 *      missing / expired / already-consumed.
 *   5. SSE handler enforces the requested topics are within `scopes`.
 *
 * SECURITY PROPERTIES
 *   · Single-use     — Redis GETDEL is atomic; two concurrent connects
 *                      with the same URL cannot both succeed
 *   · Short-lived    — default 30s; only needs to survive the roundtrip
 *                      from /sse-ticket → EventSource open
 *   · Bearer-free    — no long-lived token ever appears in a query string
 *   · Scope-bound    — the ticket carries the exact set of subscribe
 *                      scopes the user was authorized for at mint time;
 *                      the SSE handler enforces this per-topic
 *
 * STORAGE
 *   @xeplr/utils cache is Redis-backed via ioredis. We use client.getdel()
 *   directly (bypassing cache.set's error swallowing) so a Redis outage
 *   surfaces immediately at ticket mint time — the caller learns "auth
 *   backend unavailable" instead of "your ticket silently didn't stick
 *   and the connection is now inexplicably 401".
 */

const crypto = require('crypto');
const { cache } = require('@xeplr/utils');

const TICKET_PREFIX = 'ticket:sse:';
const DEFAULT_TTL   = 30;   // seconds

function newTicketId() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Issue a one-time ticket bound to a user + scope set.
 *
 * @param {object} payload      — { userId, scopes: string[], ... }
 * @param {object} [opts]
 * @param {number} [opts.ttl]   — seconds (default 30)
 * @returns {Promise<{ ticket: string, expiresIn: number }>}
 * @throws                       if Redis is unreachable (fail loud — this
 *                               is an auth surface, silent failure is a bug)
 */
async function issueTicket(payload, opts) {
  if (!payload || !payload.userId) {
    throw new Error('ticketService.issueTicket: payload.userId is required');
  }
  var ttl = (opts && opts.ttl) || DEFAULT_TTL;
  var ticket = newTicketId();

  var client = cache.getClient();
  await client.set(TICKET_PREFIX + ticket, JSON.stringify(payload), 'EX', ttl);
  return { ticket: ticket, expiresIn: ttl };
}

/**
 * Atomically consume a ticket. Returns the payload on success, null if
 * the ticket doesn't exist / expired / was already consumed.
 *
 * Guarantees single-use even under concurrent lookups (Redis GETDEL is
 * a single atomic op).
 *
 * @param {string} ticket
 * @returns {Promise<object|null>}
 */
async function consumeTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  var client = cache.getClient();
  var raw = await client.getdel(TICKET_PREFIX + ticket);
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (_) { return null; }
}

module.exports = {
  issueTicket:   issueTicket,
  consumeTicket: consumeTicket
};
