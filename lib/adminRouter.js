var express = require('express');
var { generateId } = require('./authHelper');
var { clearUserAccess, clearAccessRules } = require('./accessService');
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
var Tenant = require('../models/Tenant');
var UserTenantsMapping = require('../models/UserTenantsMapping');

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

  // ─── Users with their roles ───
  router.get('/users', async function(req, res) {
    try {
      var users = await User.query()
        .select('id', 'email', 'name', 'isActive', 'isActivated')
        .withGraphFetched('[roles, tenants]');
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Roles ───
  router.get('/roles', async function(req, res) {
    try {
      var roles = await Role.query().select('id', 'name');
      res.json(roles);
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Access items (apis, pages, elements, menus) with role mappings ───
  router.get('/access-items', async function(req, res) {
    try {
      var [apis, pages, elements, menus] = await Promise.all([
        Api.query().select('id', 'name', 'apiGroup', 'isPublic').withGraphFetched('roles'),
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

      var groupValue = moduleName + ':' + action;
      var createdBy = req.user ? req.user.id : null;

      var types = [
        { Model: Api, MappingModel: ApisRolesMapping, fk: 'apiId', groupField: 'apiGroup' },
        { Model: UiPage, MappingModel: UiPagesRolesMapping, fk: 'uiPageId', groupField: 'uiPagesGroup' },
        { Model: UiElement, MappingModel: UiElementsRolesMapping, fk: 'uiElementId', groupField: 'uiElementsGroup' },
        { Model: Menu, MappingModel: MenuRolesMapping, fk: 'menuId', groupField: 'menuGroup' }
      ];

      var promises = types.map(async function(cfg) {
        var where = {};
        where[cfg.groupField] = groupValue;
        var items = await cfg.Model.query().select('id').where(where);

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
        }
      });

      await Promise.all(promises);
      await clearAccessRules();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Master CRUD: Roles ───
  router.get('/master/roles', async function(req, res) {
    try {
      var items = await Role.query().select('id', 'name');
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.post('/master/roles', async function(req, res) {
    try {
      var { id, name } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });

      if (id) {
        await Role.query().findById(id).patch({ name: name });
        res.json({ id: id });
      } else {
        var newId = generateId();
        await Role.query().insert({ id: newId, name: name });
        res.json({ id: newId });
      }
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.post('/master/roles/delete', async function(req, res) {
    try {
      var { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id is required' });
      await Role.query().deleteById(id);
      await clearAccessRules();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // ─── Master CRUD factory for APIs, Pages, Elements, Menus ───
  var masterTypes = {
    apis:     { Model: Api, fields: ['name', 'apiGroup', 'isPublic'] },
    pages:    { Model: UiPage, fields: ['name', 'uiPagesGroup', 'isPublic'] },
    elements: { Model: UiElement, fields: ['name', 'uiElementsGroup'] },
    menus:    { Model: Menu, fields: ['name', 'menuGroup', 'isPublic'] }
  };

  Object.keys(masterTypes).forEach(function(typeKey) {
    var cfg = masterTypes[typeKey];

    router.get('/master/' + typeKey, async function(req, res) {
      try {
        var selectFields = ['id'].concat(cfg.fields);
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

        if (id) {
          await cfg.Model.query().findById(id).patch(data);
          res.json({ id: id });
        } else {
          var newId = generateId();
          data.id = newId;
          await cfg.Model.query().insert(data);
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
        await cfg.Model.query().deleteById(id);
        await clearAccessRules();
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: 'Something went wrong' });
      }
    });
  });

  // ─── Tenants (Super Admin only) ───

  function requireSuperAdmin(req, res, next) {
    if (!req.user || !req.user.roles || req.user.roles.indexOf('Super Admin') === -1) {
      return res.status(403).json({ error: 'Super Admin access required' });
    }
    next();
  }

  router.get('/tenants', requireSuperAdmin, async function(req, res) {
    try {
      var level = req.query.level ? parseInt(req.query.level) : null;
      var query = Tenant.query().select('id', 'name', 'code', 'level', 'parentId', 'description');
      if (level) query = query.where('level', level);
      var tenants = await query;
      res.json(tenants);
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.post('/tenants', requireSuperAdmin, async function(req, res) {
    try {
      var { id, name, code, level, parentId, description } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });

      var data = { name: name };
      if (code !== undefined) data.code = code;
      if (level !== undefined) data.level = level;
      if (parentId !== undefined) data.parentId = parentId;
      if (description !== undefined) data.description = description;

      if (id) {
        await Tenant.query().findById(id).patch(data);
        res.json({ id: id });
      } else {
        var newId = generateId();
        data.id = newId;
        await Tenant.query().insert(data);
        res.json({ id: newId });
      }
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.post('/tenants/delete', requireSuperAdmin, async function(req, res) {
    try {
      var { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id is required' });
      await Tenant.query().findById(id).patch({ isActive: false });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // Assign/unassign tenant to a user (via mapping table)
  // Access controlled via Access Matrix (tenants:edit group), not hardcoded to Super Admin
  router.post('/tenants/assign-user', async function(req, res) {
    try {
      var { userId, tenantId, assign } = req.body;
      if (!userId || !tenantId) return res.status(400).json({ error: 'userId and tenantId are required' });

      if (assign === false) {
        await UserTenantsMapping.query().delete().where({ userId: userId, tenantId: tenantId });
      } else {
        var existing = await UserTenantsMapping.query().findOne({ userId: userId, tenantId: tenantId });
        if (!existing) {
          await UserTenantsMapping.query().insert({
            id: generateId(),
            userId: userId,
            tenantId: tenantId,
            recordCreatedBy: req.user ? req.user.id : null
          });
        }
      }

      await clearUserAccess(userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  return router;
}

module.exports = createAdminRouter;
