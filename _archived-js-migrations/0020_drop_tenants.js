// Removes the first-class "tenants" entity entirely — the `tenants` table and
// the tenants:*-tagged access rows seeded by 0019 (their apis/uiPages/uiElements/
// menus rows + role mappings). `userTenantsMapping` stays as-is: a bare
// {userId, tenantId, roleId} assignment with no FK to any tenants table — the
// app, not auth, decides what `tenantId` means (e.g. a company id).
var GROUPED_TABLES = [
  { table: 'apis', group: 'apiGroup', map: 'apisRolesMapping', fk: 'apiId' },
  { table: 'uiPages', group: 'uiPagesGroup', map: 'uiPagesRolesMapping', fk: 'uiPageId' },
  { table: 'uiElements', group: 'uiElementsGroup', map: 'uiElementsRolesMapping', fk: 'uiElementId' },
  { table: 'menus', group: 'menuGroup', map: 'menuRolesMapping', fk: 'menuId' }
];

exports.up = async function (knex) {
  for (var i = 0; i < GROUPED_TABLES.length; i++) {
    var T = GROUPED_TABLES[i];
    var items = await knex(T.table).where(T.group, 'like', 'tenants:%').select('id');
    var ids = items.map(function (r) { return r.id; });
    if (ids.length) {
      await knex(T.map).whereIn(T.fk, ids).del();
      await knex(T.table).whereIn('id', ids).del();
    }
  }

  // A pre-existing FK (predates userTenantsMapping.tenantId becoming a bare,
  // app-interpreted string) still points at tenants on some databases — drop
  // it if present so the table can go; the tenantId COLUMN itself stays.
  var hasTenants = await knex.schema.hasTable('tenants');
  if (hasTenants) {
    var fk = await knex('pg_constraint').where('conname', 'usertenantsmapping_tenantid_foreign').first();
    if (fk) {
      await knex.schema.alterTable('userTenantsMapping', function (table) {
        table.dropForeign('tenantId');
      });
    }
  }

  await knex.schema.dropTableIfExists('tenants');
};

exports.down = async function (knex) {
  // Irreversible on purpose — re-seeding the exact prior rows isn't meaningful
  // once the Tenant model/routes are gone. Re-run 0016's up() manually if ever needed.
};
