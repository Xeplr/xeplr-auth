var express = require('express');
var { generateId } = require('./authHelper');
var { clearUserAccess, clearAccessRules, clearAllAccess } = require('./accessService');
var { accessGate } = require('./accessMiddleware');
var { createMenuService } = require('./menuService');
var authMiddleware = require('./authMiddleware');
var hooks = require('./hooks');
var { isSuperAdmin, systemScopeGuard, SUPER_ADMIN_ROLE } = require('./systemScope');
var { tenantOf, visibleTenants, GENERIC } = require('./tenant');
var User = require('../models/User');
var Role = require('../models/Role');
var Api = require('../models/Api');
var UiPage = require('../models/UiPage');
var UiElement = require('../models/UiElement');
var Menu = require('../models/Menu');
var UserRolesMapping = require('../models/UserRolesMapping');
var ApisRolesMapping = require('../models/ApisRolesMapping');
var UiPagesRolesMapping = require('../models/UiPagesRolesMapping');
var UiElementsRolesMapping = require('../models/UiElementsRolesMapping');
var MenuRolesMapping = require('../models/MenuRolesMapping');

// Group field names per type
var GROUP_FIELDS = {
  apis: 'apiGroup',
  pages: 'uiPagesGroup',
  elements: 'uiElementsGroup',
  menus: 'menuGroup'
};

// Checks if a group value follows the module:action convention
function isModuleGroup(group) {
  if (!group) return false;
  var parts = group.split(':');
  return parts.length === 2 && parts[0] && parts[1];
}

function createAdminRouter() {
  var router = express.Router();

  // Every admin route requires a valid JWT — populates req.user (with roles).
  router.use(authMiddleware);

  // SUPER ADMIN ONLY, checked here on the server. Hiding a screen does not
  // stop anyone calling its route, so every route that changes roles carries
  // this guard. (The menu routes below use it too.)
  function requireSuperAdmin(action) {
    return function(req, res, next) {
      if (!isSuperAdmin(req.user)) {
        return res.status(403).json({ error: 'Only Super Admin can ' + action });
      }
      next();
    };
  }

  // SYSTEM APIs (apis.scope = 'system') are Super Admin only, read from the
  // catalog — so a route becomes a system action by adding its row, with no
  // change here. The explicit requireSuperAdmin on the role routes below
  // stays as a second line: those must hold even before migrations run.
  router.use(systemScopeGuard());

  // And every admin route is checked against the catalog like any other app's
  // routes: a Viewer cannot call user-role or access-role just by being signed
  // in. Which roles reach which admin route is data (role mappings), set by
  // migrations and changed from the Access Matrix.
  router.use(accessGate());

  // A system role is seen, edited and assigned by Super Admin only.
  async function refuseSystemRole(req, res, roleId) {
    if (isSuperAdmin(req.user)) return false;
    var role = await Role.query().select('scope').findById(roleId);
    if (role && role.scope === 'system') {
      res.status(403).json({ error: 'This is a system role: only Super Admin can assign or change it', code: 'SYSTEM_SCOPE' });
      return true;
    }
    return false;
  }

  // Roles visible to this request: the current company's and the generic
  // ('*') ones — and system roles only to Super Admin.
  function visibleRoles(req) {
    var q = Role.query().select('id', 'name', 'scope', 'mtId1');
    if (!isSuperAdmin(req.user)) q = q.where('scope', '<>', 'system');
    var tenants = visibleTenants(tenantOf(req));
    if (tenants) q = q.whereIn('mtId1', tenants);
    return q;
  }

  async function findVisibleRole(req, id) {
    return visibleRoles(req).findById(id);
  }

  // A role name is unique within the company it belongs to.
  async function nameTaken(mtId1, name, exceptId) {
    var q = Role.query().select('id').where('mtId1', mtId1).whereRaw('lower(name) = lower(?)', [name]);
    if (exceptId) q = q.where('id', '<>', exceptId);
    return !!(await q.first());
  }

  // ─── Users with their roles ───
  router.get('/users', async function(req, res) {
    try {
      var users = await User.query()
        .select('id', 'email', 'name', 'isActive', 'isActivated')
        .withGraphFetched('roles');
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Roles ───
  router.get('/roles', async function(req, res) {
    try {
      var roles = await visibleRoles(req);
      res.json(roles);
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Access items (apis, pages, elements, menus) with role mappings ───
  router.get('/access-items', async function(req, res) {
    try {
      var [apis, pages, elements, menus] = await Promise.all([
        // System APIs are not granted to roles, so they are not offered here.
        Api.query().select('id', 'name', 'apiGroup', 'isPublic').where('scope', '<>', 'system').withGraphFetched('roles'),
        UiPage.query().select('id', 'name', 'uiPagesGroup', 'isPublic').withGraphFetched('roles'),
        UiElement.query().select('id', 'name', 'uiElementsGroup').withGraphFetched('roles'),
        Menu.query().select('id', 'name', 'menuGroup', 'isPublic').withGraphFetched('roles')
      ]);
      res.json({ apis, pages, elements, menus });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Toggle user-role mapping ───
  router.post('/user-role', async function(req, res) {
    try {
      var { userId, roleId, assign } = req.body;

      if (!userId || !roleId) {
        return res.status(400).json({ error: 'userId and roleId are required' });
      }
      if (await refuseSystemRole(req, res, roleId)) return;

      if (assign) {
        var existing = await UserRolesMapping.query()
          .findOne({ userId: userId, roleId: roleId });
        if (!existing) {
          await UserRolesMapping.query().insert({
            id: generateId(),
            userId: userId,
            roleId: roleId,
            recordCreatedBy: req.user ? req.user.id : null
          });
        }
      } else {
        await UserRolesMapping.query()
          .delete()
          .where({ userId: userId, roleId: roleId });
      }

      await clearUserAccess(userId);
      await hooks.fire('userRolesMapping', assign ? 'create' : 'delete', userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Toggle access-role mapping (single item) ───
  router.post('/access-role', async function(req, res) {
    try {
      var { type, itemId, roleId, assign } = req.body;

      if (!type || !itemId || !roleId) {
        return res.status(400).json({ error: 'type, itemId, and roleId are required' });
      }

      var config = {
        apis: { Model: ApisRolesMapping, fk: 'apiId' },
        pages: { Model: UiPagesRolesMapping, fk: 'uiPageId' },
        elements: { Model: UiElementsRolesMapping, fk: 'uiElementId' },
        menus: { Model: MenuRolesMapping, fk: 'menuId' }
      };

      var mapping = config[type];
      if (!mapping) {
        return res.status(400).json({ error: 'Invalid type. Use: apis, pages, elements, menus' });
      }
      if (await refuseSystemRole(req, res, roleId)) return;
      if (type === 'apis') {
        var api = await Api.query().select('scope').findById(itemId);
        if (api && api.scope === 'system') {
          return res.status(400).json({ error: 'A system API is not granted to roles: only Super Admin can use it', code: 'SYSTEM_SCOPE' });
        }
      }

      var where = { roleId: roleId };
      where[mapping.fk] = itemId;

      if (assign) {
        var existing = await mapping.Model.query().findOne(where);
        if (!existing) {
          var row = {
            id: generateId(),
            roleId: roleId,
            recordCreatedBy: req.user ? req.user.id : null
          };
          row[mapping.fk] = itemId;
          await mapping.Model.query().insert(row);
        }
      } else {
        await mapping.Model.query().delete().where(where);
      }

      await clearAccessRules();
      await hooks.fire(type + 'RolesMapping', assign ? 'create' : 'delete', itemId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Toggle module:action for a role (bulk — toggles all items with that group across all types) ───
  router.post('/module-role', async function(req, res) {
    try {
      var { module: moduleName, action, roleId, assign } = req.body;

      if (!moduleName || !action || !roleId) {
        return res.status(400).json({ error: 'module, action, and roleId are required' });
      }
      if (await refuseSystemRole(req, res, roleId)) return;

      var groupValue = moduleName + ':' + action;
      var createdBy = req.user ? req.user.id : null;

      var types = [
        { type: 'apis', Model: Api, MappingModel: ApisRolesMapping, fk: 'apiId', groupField: 'apiGroup' },
        { type: 'pages', Model: UiPage, MappingModel: UiPagesRolesMapping, fk: 'uiPageId', groupField: 'uiPagesGroup' },
        { type: 'elements', Model: UiElement, MappingModel: UiElementsRolesMapping, fk: 'uiElementId', groupField: 'uiElementsGroup' },
        { type: 'menus', Model: Menu, MappingModel: MenuRolesMapping, fk: 'menuId', groupField: 'menuGroup' }
      ];

      var promises = types.map(async function(cfg) {
        var where = {};
        where[cfg.groupField] = groupValue;
        var q = cfg.Model.query().select('id').where(where);
        // A system API in the same group is still never granted.
        if (cfg.type === 'apis') q = q.where('scope', '<>', 'system');
        var items = await q;

        for (var i = 0; i < items.length; i++) {
          var itemWhere = { roleId: roleId };
          itemWhere[cfg.fk] = items[i].id;

          if (assign) {
            var existing = await cfg.MappingModel.query().findOne(itemWhere);
            if (!existing) {
              var row = { id: generateId(), roleId: roleId, recordCreatedBy: createdBy };
              row[cfg.fk] = items[i].id;
              await cfg.MappingModel.query().insert(row);
            }
          } else {
            await cfg.MappingModel.query().delete().where(itemWhere);
          }

          await hooks.fire(cfg.type + 'RolesMapping', assign ? 'create' : 'delete', items[i].id);
        }
      });

      await Promise.all(promises);
      await clearAccessRules();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Module states: DISABLED, per role ───
  // Enabled and Hidden are the role mapping (module-role above). Disabled is
  // the mapping row's `state`: the role still sees the item, greyed out, and
  // the API refuses it. Only roles for now; a workspace or user override is
  // not stored, and says so.
  var STATE_TYPES = [
    { Model: Api, MappingModel: ApisRolesMapping, fk: 'apiId', groupField: 'apiGroup', table: 'apis', mapping: 'apisRolesMapping' },
    { Model: UiPage, MappingModel: UiPagesRolesMapping, fk: 'uiPageId', groupField: 'uiPagesGroup', table: 'uiPages', mapping: 'uiPagesRolesMapping' },
    { Model: UiElement, MappingModel: UiElementsRolesMapping, fk: 'uiElementId', groupField: 'uiElementsGroup', table: 'uiElements', mapping: 'uiElementsRolesMapping' },
    { Model: Menu, MappingModel: MenuRolesMapping, fk: 'menuId', groupField: 'menuGroup', table: 'menus', mapping: 'menuRolesMapping' }
  ];

  function onlyRoleScope(req, res, scope) {
    if (scope === 'role') return false;
    res.status(400).json({ error: 'Only role states are stored so far', code: 'SCOPE_NOT_SUPPORTED' });
    return true;
  }

  // "configuration:access:view" → module "configuration:access", action "view".
  function splitGroup(group) {
    var i = String(group || '').lastIndexOf(':');
    return i <= 0 ? null : { module: group.slice(0, i), action: group.slice(i + 1) };
  }

  router.get('/module-states', async function(req, res) {
    try {
      if (onlyRoleScope(req, res, req.query.scope)) return;
      var roleIds = (await visibleRoles(req)).map(function(r) { return r.id; });
      var seen = {};
      var out = [];
      for (var i = 0; i < STATE_TYPES.length; i++) {
        var cfg = STATE_TYPES[i];
        var rows = await cfg.MappingModel.query()
          .select(cfg.mapping + '.roleId', cfg.table + '.' + cfg.groupField + ' as grp')
          .join(cfg.table, cfg.table + '.id', cfg.mapping + '.' + cfg.fk)
          .where(cfg.mapping + '.state', 'disabled')
          .whereIn(cfg.mapping + '.roleId', roleIds);
        rows.forEach(function(r) {
          var g = splitGroup(r.grp);
          var key = r.grp + '|' + r.roleId;
          if (!g || seen[key]) return;
          seen[key] = true;
          out.push({ module: g.module, action: g.action, roleId: r.roleId, state: 'disabled' });
        });
      }
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // { scope: 'role', roleId, module, action, state }. state 'disabled' greys
  // out every item of that module/action the role is mapped to; 'enabled',
  // 'inherit' or null clears it. Hidden is not a state to store: it is no
  // mapping, set through module-role.
  router.post('/module-state', async function(req, res) {
    try {
      var { scope, module: moduleName, action, roleId, state } = req.body || {};
      if (onlyRoleScope(req, res, scope)) return;
      if (!moduleName || !action || !roleId) {
        return res.status(400).json({ error: 'module, action, and roleId are required' });
      }
      var next = (state === 'disabled') ? 'disabled' : (state == null || state === 'enabled' || state === 'inherit') ? 'enabled' : null;
      if (!next) {
        return res.status(400).json({ error: 'state must be disabled, enabled or inherit; hidden is removing the mapping', code: 'BAD_STATE' });
      }
      if (await refuseSystemRole(req, res, roleId)) return;

      var groupValue = moduleName + ':' + action;
      var changed = 0;
      for (var i = 0; i < STATE_TYPES.length; i++) {
        var cfg = STATE_TYPES[i];
        var items = cfg.Model.query().select('id').where(cfg.groupField, groupValue);
        if (cfg.table === 'apis') items = items.where('scope', '<>', 'system');
        changed += await cfg.MappingModel.query()
          .patch({ state: next, recordModifiedBy: req.user ? req.user.id : null })
          .where('roleId', roleId)
          .whereIn(cfg.fk, items);
      }
      // Every cached answer: the API rules and each user's access object.
      await clearAllAccess();
      res.json({ ok: true, changed: changed });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Master CRUD: Roles ───
  router.get('/master/roles', async function(req, res) {
    try {
      var items = await visibleRoles(req);
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.post('/master/roles', requireSuperAdmin('create or rename roles'), async function(req, res) {
    try {
      var { id, name, scope } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });
      if (scope != null && scope !== 'system' && scope !== 'company') {
        return res.status(400).json({ error: "scope must be 'system' or 'company'" });
      }

      if (id) {
        var current = await findVisibleRole(req, id);
        if (!current) return res.status(404).json({ error: 'Role not found in this company' });
        if (await nameTaken(current.mtId1, name, id)) {
          return res.status(409).json({ error: 'A role called "' + name + '" already exists here' });
        }
        var patch = { name: name };
        if (scope) patch.scope = scope;
        await Role.query().findById(id).patch(patch);
        await hooks.fire('roles', 'update', id);
        res.json({ id: id });
      } else {
        // A system role belongs to the whole install. Any other role belongs
        // to the company it is created in — even when Super Admin creates it —
        // so creating one with no company selected is refused.
        var rowScope = scope || 'company';
        var t = tenantOf(req);
        var mtId1 = GENERIC;
        if (rowScope !== 'system' && t.multiTenant) {
          if (!t.companyId) {
            return res.status(400).json({ error: 'Choose a company first: a role belongs to the company it is created in', code: 'NO_COMPANY' });
          }
          mtId1 = t.companyId;
        }
        if (await nameTaken(mtId1, name)) {
          return res.status(409).json({ error: 'A role called "' + name + '" already exists here' });
        }
        var newId = generateId();
        await Role.query().insert({ id: newId, name: name, scope: rowScope, mtId1: mtId1 });
        await hooks.fire('roles', 'create', newId);
        res.json({ id: newId });
      }
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Copy roles to other companies (Super Admin) ───
  //
  // Five companies wanting the same roles get five independent copies: same
  // name, same grants (apis, pages, elements, menus), each then theirs to
  // change. A company that already has a role of that name keeps its own —
  // the copy is skipped and reported, never overwritten.
  var MAPPINGS = [
    { Model: ApisRolesMapping, fk: 'apiId' },
    { Model: UiPagesRolesMapping, fk: 'uiPageId' },
    { Model: UiElementsRolesMapping, fk: 'uiElementId' },
    { Model: MenuRolesMapping, fk: 'menuId' }
  ];

  router.post('/master/roles/copy', requireSuperAdmin('copy roles between companies'), async function(req, res) {
    try {
      var roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];
      var companyIds = Array.isArray(req.body.companyIds) ? req.body.companyIds : [];
      if (!roleIds.length || !companyIds.length) {
        return res.status(400).json({ error: 'roleIds and companyIds are required' });
      }
      var sources = await Role.query().select('id', 'name', 'scope').whereIn('id', roleIds);
      var copied = [], skipped = [];
      roleIds.forEach(function(rid) {
        if (!sources.some(function(r) { return r.id === rid; })) skipped.push({ roleId: rid, reason: 'not found' });
      });
      var by = req.user ? req.user.id : null;

      for (var i = 0; i < sources.length; i++) {
        var src = sources[i];
        if (src.scope === 'system') {
          skipped.push({ roleId: src.id, reason: 'a system role belongs to the whole install and is not copied' });
          continue;
        }
        var grants = [];
        for (var m = 0; m < MAPPINGS.length; m++) {
          var rows = await MAPPINGS[m].Model.query().select(MAPPINGS[m].fk).where('roleId', src.id);
          grants.push(rows.map(function(r) { return r[MAPPINGS[m].fk]; }));
        }
        for (var c = 0; c < companyIds.length; c++) {
          var companyId = String(companyIds[c] || '').trim();
          if (!companyId || companyId === GENERIC) {
            skipped.push({ roleId: src.id, companyId: companyId, reason: 'not a company id' });
            continue;
          }
          if (await nameTaken(companyId, src.name)) {
            skipped.push({ roleId: src.id, companyId: companyId, reason: 'a role called "' + src.name + '" already exists there' });
            continue;
          }
          var copyId = generateId();
          await Role.transaction(async function(trx) {
            await Role.query(trx).insert({ id: copyId, name: src.name, scope: 'company', mtId1: companyId, recordCreatedBy: by });
            for (var k = 0; k < MAPPINGS.length; k++) {
              for (var g = 0; g < grants[k].length; g++) {
                var row = { id: generateId(), roleId: copyId, isActive: true, recordCreatedBy: by };
                row[MAPPINGS[k].fk] = grants[k][g];
                await MAPPINGS[k].Model.query(trx).insert(row);
              }
            }
          });
          await hooks.fire('roles', 'create', copyId);
          copied.push({ roleId: src.id, companyId: companyId, newRoleId: copyId });
        }
      }
      if (copied.length) await clearAccessRules();
      res.json({ copied: copied, skipped: skipped });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.post('/master/roles/delete', requireSuperAdmin('delete roles'), async function(req, res) {
    try {
      var { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id is required' });
      // Deleting the role that holds system scope would leave nobody able to
      // manage the install. Refused, whoever asks.
      var target = await findVisibleRole(req, id);
      if (!target) return res.status(404).json({ error: 'Role not found in this company' });
      if (target.name === SUPER_ADMIN_ROLE) {
        return res.status(400).json({ error: 'The Super Admin role cannot be deleted' });
      }
      await Role.query().deleteById(id);
      await clearAccessRules();
      await hooks.fire('roles', 'delete', id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Menu items: key, label, order, visibility — Super Admin only ───
  //
  // The key (name) is what code matches on and never changes here; label,
  // sortOrder and isHidden are what the app's "Configure UI" screen edits.
  var menuItems = createMenuService({ Menu: Menu, MenuRolesMapping: MenuRolesMapping, clearAll: clearAllAccess });

  var superAdminOnly = requireSuperAdmin('change the menu');

  function menuRoute(fn) {
    return [superAdminOnly, async function(req, res) {
      try {
        res.json(await fn(req));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
      }
    }];
  }

  router.get('/menu-items', menuRoute(function() { return menuItems.list(); }));
  router.post('/menu-items', menuRoute(function(req) { return menuItems.update(req.body && req.body.items); }));
  router.post('/menu-items/add', menuRoute(function(req) { return menuItems.add(req.body); }));
  router.post('/menu-items/remove', menuRoute(function(req) { return menuItems.remove(req.body && req.body.name); }));

  // ─── Master CRUD factory for APIs, Pages, Elements, Menus ───
  var masterTypes = {
    apis:     { Model: Api, fields: ['name', 'apiGroup', 'isPublic'] },
    pages:    { Model: UiPage, fields: ['name', 'uiPagesGroup', 'isPublic'] },
    elements: { Model: UiElement, fields: ['name', 'uiElementsGroup'] },
    menus:    { Model: Menu, fields: ['name', 'menuGroup', 'isPublic'] }
  };

  // A system API row is managed by migrations only. Renaming or deleting it
  // here would leave the route it names unguarded, so both are refused.
  async function refuseSystemApiRow(typeKey, id, res) {
    if (typeKey !== 'apis' || !id) return false;
    var row = await Api.query().select('scope').findById(id);
    if (row && row.scope === 'system') {
      res.status(400).json({ error: 'A system API is managed by migrations and cannot be changed here', code: 'SYSTEM_SCOPE' });
      return true;
    }
    return false;
  }

  // ─── "Super Admin only": move an API in or out of system scope ───
  //
  // Super Admin's switch in Master Settings, so an API can become system
  // without code or SQL. Effective at once: the guard's cached list is
  // cleared. A locked row (pinned by a migration) cannot be switched off.
  // Role mappings are kept, so switching an API back restores who had it.
  router.post('/master/apis/scope', requireSuperAdmin('change which APIs are Super Admin only'), async function(req, res) {
    try {
      var { id, scope } = req.body;
      if (!id) return res.status(400).json({ error: 'id is required' });
      if (scope !== 'system' && scope !== 'company') {
        return res.status(400).json({ error: "scope must be 'system' or 'company'" });
      }
      var row = await Api.query().select('id', 'scope', 'scopeLocked').findById(id);
      if (!row) return res.status(404).json({ error: 'API not found' });
      if (row.scopeLocked) {
        return res.status(400).json({ error: 'This API is pinned as Super Admin only by a migration and cannot be changed here', code: 'SCOPE_LOCKED' });
      }
      if (row.scope !== scope) {
        await Api.query().findById(id).patch({ scope: scope });
        await clearAccessRules();
        await hooks.fire('apis', 'update', id);
      }
      res.json({ id: id, scope: scope });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  Object.keys(masterTypes).forEach(function(typeKey) {
    var cfg = masterTypes[typeKey];

    router.get('/master/' + typeKey, async function(req, res) {
      try {
        var selectFields = ['id'].concat(cfg.fields, typeKey === 'apis' ? ['scope', 'scopeLocked'] : []);
        var items = await cfg.Model.query().select(selectFields);
        res.json(items);
      } catch (err) {
        res.status(500).json({ error: 'Something went wrong' });
      }
    });

    router.post('/master/' + typeKey, async function(req, res) {
      try {
        var id = req.body.id;
        var data = {};
        cfg.fields.forEach(function(f) {
          if (req.body[f] !== undefined) data[f] = req.body[f];
        });

        if (!data.name) return res.status(400).json({ error: 'name is required' });
        if (await refuseSystemApiRow(typeKey, id, res)) return;

        if (id) {
          await cfg.Model.query().findById(id).patch(data);
          await hooks.fire(typeKey, 'update', id);
          res.json({ id: id });
        } else {
          var newId = generateId();
          data.id = newId;
          await cfg.Model.query().insert(data);
          await hooks.fire(typeKey, 'create', newId);
          res.json({ id: newId });
        }
      } catch (err) {
        res.status(500).json({ error: 'Something went wrong' });
      }
    });

    router.post('/master/' + typeKey + '/delete', async function(req, res) {
      try {
        var id = req.body.id;
        if (!id) return res.status(400).json({ error: 'id is required' });
        if (await refuseSystemApiRow(typeKey, id, res)) return;
        await cfg.Model.query().deleteById(id);
        await clearAccessRules();
        await hooks.fire(typeKey, 'delete', id);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: 'Something went wrong' });
      }
    });
  });

  return router;
}

module.exports = createAdminRouter;
