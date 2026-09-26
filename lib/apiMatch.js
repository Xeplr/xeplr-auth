/**
 * Which `apis` row a request is. Pure, so it can be tested without a request.
 *
 * A row's name is "METHOD path" (that method only) or a bare path (every
 * method), and a path may hold `:params` — "GET /widget-templates/:id"
 * covers GET /widget-templates/abc. When several rows fit, the most exact
 * wins:
 *
 *   1. more literal segments   /dashboards/:id/group beats /dashboards/:id/:x
 *   2. a method over none      "POST /x" beats "/x"
 *
 * @param names   every API name in the catalog
 * @param method  'GET', 'POST', …
 * @param path    the request path, no query string
 * @returns the matching name, or null (not registered)
 */
function clean(path) {
  return String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
}

function parse(name) {
  var m = /^([A-Z]+)\s+(\S+)$/.exec(String(name || '').trim());
  return m ? { method: m[1], path: clean(m[2]) } : { method: null, path: clean(name) };
}

/** Literal segments matched, or -1 when the pattern does not fit. */
function fit(pattern, path) {
  var a = pattern.split('/');
  var b = path.split('/');
  if (a.length !== b.length) return -1;
  var literal = 0;
  for (var i = 0; i < a.length; i++) {
    if (a[i].charAt(0) === ':' && b[i] !== '') continue;
    if (a[i] !== b[i]) return -1;
    literal++;
  }
  return literal;
}

function matchApi(names, method, path) {
  var verb = String(method || '').toUpperCase();
  var target = clean(path);
  var best = null;
  var bestScore = -1;
  (names || []).forEach(function(name) {
    var row = parse(name);
    if (row.method && row.method !== verb) return;
    var literal = fit(row.path, target);
    if (literal < 0) return;
    var score = literal * 2 + (row.method ? 1 : 0);
    if (score > bestScore) { best = name; bestScore = score; }
  });
  return best;
}

module.exports = { matchApi: matchApi };
