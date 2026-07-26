// Unit tests for the revocation logic. Run:  node js/access-logic.test.js
// Zero dependencies — uses Node's built-in assert.
var assert = require("assert");
var hasAccess = require("./access-logic.js").hasAccess;

var admin = { role: "admin", is_active: true };
var client = { role: "client", is_active: true };
var inactive = { role: "client", is_active: false };

var tests = [
  ["admin always has access even with a deny row", function () {
    assert.strictEqual(hasAccess(admin, [{ scope: "all", granted: false, revoked_at: "2026-01-01" }], "gp"), true);
  }],
  ["client with no entitlements is allowed (default allow)", function () {
    assert.strictEqual(hasAccess(client, [], "gp"), true);
    assert.strictEqual(hasAccess(client, null, "specialist"), true);
  }],
  ["revoking a scope blocks only that scope", function () {
    var ents = [{ scope: "gp", granted: false, revoked_at: "2026-07-24" }];
    assert.strictEqual(hasAccess(client, ents, "gp"), false);
    assert.strictEqual(hasAccess(client, ents, "specialist"), true);
    assert.strictEqual(hasAccess(client, ents, "general"), true);
  }],
  ["a global 'all' deny blocks every scope", function () {
    var ents = [{ scope: "all", granted: false, revoked_at: "2026-07-24" }];
    assert.strictEqual(hasAccess(client, ents, "gp"), false);
    assert.strictEqual(hasAccess(client, ents, "specialist"), false);
    assert.strictEqual(hasAccess(client, ents, "general"), false);
  }],
  ["an inactive account has no access regardless of entitlements", function () {
    assert.strictEqual(hasAccess(inactive, [], "general"), false);
  }],
  ["a granted=true row does NOT block (only granted=false denies)", function () {
    var ents = [{ scope: "gp", granted: true, revoked_at: null }];
    assert.strictEqual(hasAccess(client, ents, "gp"), true);
  }],
  ["a granted=false row without revoked_at does NOT block (incomplete deny)", function () {
    var ents = [{ scope: "gp", granted: false, revoked_at: null }];
    assert.strictEqual(hasAccess(client, ents, "gp"), true);
  }],
  ["restoring access (deny row removed) allows again", function () {
    assert.strictEqual(hasAccess(client, [], "gp"), true);
  }],
  ["null profile denies", function () {
    assert.strictEqual(hasAccess(null, [], "gp"), false);
  }]
];

var passed = 0;
tests.forEach(function (t) {
  try { t[1](); passed++; console.log("  ✓ " + t[0]); }
  catch (e) { console.error("  ✗ " + t[0] + "\n    " + e.message); process.exitCode = 1; }
});
console.log("\n" + passed + "/" + tests.length + " passed");
