// Unit tests for reminder scheduling.  Run: node js/reminder-schedule.test.js
var assert = require("assert");
var R = require("./reminder-schedule.js");

// Helper: a Date that is a given wall-clock hour in ET on a known date.
// 2026-07-06 is a Monday; 2026-07-01 is a Wednesday (quarter/half-year start).
// We pass explicit UTC and let the TZ logic convert. In summer ET = UTC-4.
// ET offset from UTC: 4h during EDT (~Mar–Oct), 5h during EST (winter).
function etDate(y, m, d, hourET) { var off = (m >= 3 && m <= 10) ? 4 : 5; return new Date(Date.UTC(y, m - 1, d, hourET + off, 0, 0)); }

var tests = [
  ["daily with no weekdays fires every day at its hour", function () {
    var r = { frequency: "daily", time_local: "07:00", active: true };
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 6, 7)), true);
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 6, 8)), false); // wrong hour
  }],
  ["daily restricted to weekdays only fires on those days", function () {
    var r = { frequency: "daily", time_local: "07:00", byweekday: [1, 3, 5], active: true }; // Mon/Wed/Fri
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 6, 7)), true);  // Mon
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 7, 7)), false); // Tue
  }],
  ["weekly fires on its chosen weekday", function () {
    var r = { frequency: "weekly", time_local: "07:00", byweekday: [1], active: true }; // Monday
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 6, 7)), true);  // Mon
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 8, 7)), false); // Wed
  }],
  ["monthly fires on the 1st", function () {
    var r = { frequency: "monthly", time_local: "07:00", day_of_month: 1, active: true };
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 1, 7)), true);
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 2, 7)), false);
  }],
  ["quarterly fires only on the 1st of Jan/Apr/Jul/Oct", function () {
    var r = { frequency: "quarterly", time_local: "07:00", day_of_month: 1, active: true };
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 1, 7)), true);  // Jul 1
    assert.strictEqual(R.isDue(r, etDate(2026, 8, 1, 7)), false); // Aug 1
  }],
  ["biannual fires on Jan 1 and Jul 1", function () {
    var r = { frequency: "biannual", time_local: "07:00", active: true };
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 1, 7)), true);  // Jul 1
    assert.strictEqual(R.isDue(r, etDate(2026, 1, 1, 7)), true);  // Jan 1 (winter, handled by TZ)
    assert.strictEqual(R.isDue(r, etDate(2026, 4, 1, 7)), false); // Apr 1
  }],
  ["inactive reminders never fire", function () {
    var r = { frequency: "daily", time_local: "07:00", active: false };
    assert.strictEqual(R.isDue(r, etDate(2026, 7, 6, 7)), false);
  }],
  ["describe produces readable cadence", function () {
    assert.ok(R.describe({ frequency: "biannual", time_local: "07:00" }).indexOf("Twice a year") !== -1);
    assert.ok(R.describe({ frequency: "monthly", time_local: "07:00", day_of_month: 1 }).indexOf("1st") !== -1);
    assert.ok(R.describe({ frequency: "weekly", time_local: "07:00", byweekday: [1] }).indexOf("Monday") !== -1);
  }]
];

var passed = 0;
tests.forEach(function (t) {
  try { t[1](); passed++; console.log("  ✓ " + t[0]); }
  catch (e) { console.error("  ✗ " + t[0] + "\n    " + e.message); process.exitCode = 1; }
});
console.log("\n" + passed + "/" + tests.length + " passed");
