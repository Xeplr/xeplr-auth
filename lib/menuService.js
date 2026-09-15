// MENU ITEMS — key, label, order, visibility.
//
// A menu row's `name` is its KEY: what the app's code matches on
// (drawerItems: { key: 'Tasks' }) and what roles are mapped to. It never
// changes and is never shown. `label` is what people read — renamed from the
// app, no code or restart. Empty label shows the key.
//
// Everything here writes the catalog and then clears the access caches, so the
// next /auth/api/me — which the UI asks for straight after — carries the change.

var { generateId } = require('./authHelper');

var MAX_LABEL = 255;

/** { name, label, sortOrder } for the rows a user may see, hidden ones left out, in rail order. */
function visibleItems(menus) {
  var seen = new Map();
  (menus || []).forEach(function(m) {
    if (!m || !m.name || m.isHidden || seen.has(m.name)) return;
    seen.set(m.name, { name: m.name, label: m.label || m.name, sortOrder: m.sortOrder === undefined ? null : m.sortOrder });
  });
  return Array.from(seen.values()).sort(byOrder);
}

function byOrder(a, b) {
  var ao = a.sortOrder === null || a.sortOrder === undefined ? Infinity : a.sortOrder;
  var bo = b.sortOrder === null || b.sortOrder === undefined ? Infinity : b.sortOrder;
  if (ao !== bo) return ao - bo;
  return String(a.label).localeCompare(String(b.label));
}

function badRequest(message) {
  var e = new Error(message);
  e.status = 400;
  return e;
}

/**
 * @param deps.Menu              bound Menu model
 * @param deps.MenuRolesMapping  bound MenuRolesMapping model
 * @param deps.clearAll          async () → clears every cached access answer
 */
function createMenuService(deps) {
  var Menu = deps.Menu;
  var MenuRolesMapping = deps.MenuRolesMapping;

  /** Every menu row, for the admin screen — hidden ones included. */
  async function list() {
    var rows = await Menu.query().select('id', 'name', 'label', 'sortOrder', 'isHidden', 'isPublic', 'menuGroup');
    return rows.map(function(r) {
      return { id: r.id, name: r.name, label: r.label || null, shown: r.label || r.name, sortOrder: r.sortOrder === undefined ? null : r.sortOrder, isHidden: !!r.isHidden, isPublic: !!r.isPublic, menuGroup: r.menuGroup || '' };
    }).sort(function(a, b) { return byOrder({ sortOrder: a.sortOrder, label: a.shown }, { sortOrder: b.sortOrder, label: b.shown }); });
  }

  /**
   * Rename, reorder, hide — by key. Only label / sortOrder / isHidden change;
   * the key itself cannot, since code and role mappings refer to it.
   * @param items [{ name, label?, sortOrder?, isHidden? }]
   */
  async function update(items) {
    if (!Array.isArray(items) || !items.length) throw badRequest('items: [{ name, label, sortOrder, isHidden }]');
    var changed = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      if (!item.name) throw badRequest('items[' + i + '].name is required — it is the key');
      var patch = {};
      if (item.label !== undefined) {
        var label = item.label === null ? '' : String(item.label).trim();
        if (label.length > MAX_LABEL) throw badRequest('items[' + i + '].label is longer than ' + MAX_LABEL);
        patch.label = label || null;
      }
      if (item.sortOrder !== undefined) {
        if (item.sortOrder !== null && !Number.isInteger(item.sortOrder)) throw badRequest('items[' + i + '].sortOrder must be a whole number');
        patch.sortOrder = item.sortOrder;
      }
      if (item.isHidden !== undefined) patch.isHidden = !!item.isHidden;
      if (!Object.keys(patch).length) continue;
      changed += await Menu.query().patch(patch).where({ name: item.name });
    }
    await deps.clearAll();
    return { changed: changed };
  }

  /**
   * A new menu item — e.g. a form added to the menu from the app. Shown to
   * everyone signed in (isPublic) unless told otherwise; an existing key is
   * relabelled and shown again rather than duplicated.
   */
  async function add(item) {
    item = item || {};
    var name = String(item.name || '').trim();
    if (!name) throw badRequest('name is required — the key the app matches on, e.g. "form:crop"');
    if (name.length > MAX_LABEL) throw badRequest('name is longer than ' + MAX_LABEL);
    var label = item.label ? String(item.label).trim().slice(0, MAX_LABEL) : null;
    var existing = await Menu.query().findOne({ name: name });
    if (existing) {
      await Menu.query().patch({ label: label || existing.label || null, isHidden: false }).where({ name: name });
    } else {
      var top = await Menu.query().max('sortOrder as max').first();
      await Menu.query().insert({
        id: generateId(), name: name, label: label, menuGroup: item.menuGroup || '',
        isPublic: item.isPublic === false ? 0 : 1, isHidden: false, isActive: true, mtId1: '*',
        sortOrder: top && top.max !== null && top.max !== undefined ? Number(top.max) + 1 : null
      });
    }
    await deps.clearAll();
    return { name: name, created: !existing };
  }

  /** Remove an item the app added (and its role mappings). */
  async function remove(name) {
    if (!name) throw badRequest('name is required');
    var row = await Menu.query().findOne({ name: name });
    if (!row) return { removed: false };
    await MenuRolesMapping.query().delete().where({ menuId: row.id });
    await Menu.query().deleteById(row.id);
    await deps.clearAll();
    return { removed: true };
  }

  return { list: list, update: update, add: add, remove: remove };
}

module.exports = { createMenuService: createMenuService, visibleItems: visibleItems };
