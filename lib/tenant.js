/**
 * Which company a request is working in — for the rows auth itself owns
 * (roles today).
 *
 * The auth service runs on its own and does not know an app's tenant levels,
 * so the app tells it with AUTH_TENANT_HEADER: the header that carries the
 * company id (BI: x-company-id), or 'none' for a single-tenant app.
 *
 *   '*'        a generic row: every company sees it (system roles, APIs, the
 *              seeded roles)
 *   companyId  a company's own row: only that company sees it
 */

var GENERIC = '*';

/** 'none' → null (single-tenant); otherwise the header name, lower-cased as Node stores headers. */
function tenantHeader(env) {
  var v = String((env || process.env).AUTH_TENANT_HEADER || '').trim();
  if (!v) throw new Error('AUTH_TENANT_HEADER is not set — the header naming the company (e.g. x-company-id), or none for a single-tenant app');
  return v.toLowerCase() === 'none' ? null : v.toLowerCase();
}

/**
 * The request's company.
 * @returns { multiTenant: boolean, companyId: string|null }
 */
function tenantOf(req, env) {
  var header = tenantHeader(env);
  if (!header) return { multiTenant: false, companyId: null };
  var raw = req && req.headers ? req.headers[header] : null;
  var id = raw ? String(raw).trim() : '';
  return { multiTenant: true, companyId: id || null };
}

/** Which mtId1 values a request may see: its company and the generic rows. */
function visibleTenants(t) {
  if (!t.multiTenant) return null;            // single-tenant: no filter
  return t.companyId ? [t.companyId, GENERIC] : [GENERIC];
}

module.exports = { GENERIC: GENERIC, tenantHeader: tenantHeader, tenantOf: tenantOf, visibleTenants: visibleTenants };
