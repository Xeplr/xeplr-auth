var { generateId, hashPassword } = require('./authHelper');

/**
 * Ensure a Super Admin user exists and is mapped to the "Super Admin" role.
 *
 * Brand-neutral: the caller supplies WHO (email/password/name); this owns HOW
 * (hashing, columns, role mapping). Insert-if-absent, so it is idempotent and
 * safe to call from a migration on every run. Requires the base auth migrations
 * (roles + users + userRolesMapping) to have run first.
 *
 * @param {import('knex').Knex} knex
 * @param {{ email:string, password:string, name?:string }} admin
 * @returns {Promise<{ userId:string, created:boolean, roleAssigned:boolean }>}
 */
async function seedSuperAdmin(knex, admin) {
  if (!admin || !admin.email || !admin.password) {
    throw new Error('seedSuperAdmin: { email, password } are required');
  }

  var role = await knex('roles').where({ name: 'Super Admin' }).first();
  if (!role) {
    throw new Error('seedSuperAdmin: "Super Admin" role not found — run the base auth migrations first');
  }

  var now = new Date().toISOString();
  var normalized = admin.email.toLowerCase();
  var existing = await knex('users').where({ normalizedEmail: normalized }).first();

  var userId;
  var created = false;
  if (existing) {
    userId = existing.id;
  } else {
    userId = generateId();
    var creds = await hashPassword(admin.password);
    await knex('users').insert({
      id: userId,
      email: admin.email,
      normalizedEmail: normalized,
      name: admin.name || admin.email,
      pwd: creds.hash,
      pwdSalt: creds.salt,
      isActive: true,
      isActivated: true,
      activatedOn: now,
      activatedBy: userId,
      recordCreatedDate: now,
      recordModifiedDate: now,
      recordCreatedBy: userId,
      recordModifiedBy: userId
    });
    created = true;
  }

  var mapped = await knex('userRolesMapping').where({ userId: userId, roleId: role.id }).first();
  var roleAssigned = false;
  if (!mapped) {
    await knex('userRolesMapping').insert({
      id: generateId(),
      userId: userId,
      roleId: role.id,
      isActive: true,
      recordCreatedDate: now,
      recordModifiedDate: now,
      recordCreatedBy: userId,
      recordModifiedBy: userId
    });
    roleAssigned = true;
  }

  return { userId: userId, created: created, roleAssigned: roleAssigned };
}

module.exports = { seedSuperAdmin };
