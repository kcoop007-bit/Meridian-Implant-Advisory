// Shared reminder-scheduling logic: when is a reminder due, and a human
// description of its cadence. Pure + timezone-aware (defaults to America/
// New_York so 7:00 fires at 7 AM ET year-round, DST handled by Intl).
// Used by the account UI (browser) and mirrored by the Netlify dispatcher.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MeridianReminders = api;
})(typeof self !== "undefined" ? self : this, function () {
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function partsInTZ(date, tz) {
    var f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", year: "numeric",
      month: "numeric", day: "numeric", hour: "numeric", hour12: false
    });
    var o = {};
    f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    var wmap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { year: +o.year, month: +o.month, day: +o.day, weekday: wmap[o.weekday], hour: (+o.hour) % 24 };
  }

  // Is this reminder due at `date` (the dispatcher runs hourly on the hour)?
  function isDue(r, date) {
    if (!r || r.active === false) return false;
    var tz = r.timezone || "America/New_York";
    var p = partsInTZ(date, tz);
    var hour = parseInt((r.time_local || "07:00").split(":")[0], 10);
    if (p.hour !== hour) return false;
    var dom = r.day_of_month || 1;
    var wds = r.byweekday && r.byweekday.length ? r.byweekday : null;
    switch (r.frequency) {
      case "daily":     return wds ? wds.indexOf(p.weekday) !== -1 : true;
      case "weekly":    return (wds ? wds[0] : 1) === p.weekday;
      case "monthly":   return p.day === dom;
      case "quarterly": return [1, 4, 7, 10].indexOf(p.month) !== -1 && p.day === dom;
      case "biannual":  return (p.month === 1 || p.month === 7) && p.day === dom;
      case "custom":    return wds ? wds.indexOf(p.weekday) !== -1 : true;
      default:          return false;
    }
  }

  function fmtTime(t) {
    var hh = parseInt((t || "07:00").split(":")[0], 10);
    var mm = (t || "07:00").split(":")[1] || "00";
    var ap = hh >= 12 ? "PM" : "AM";
    var h12 = hh % 12 || 12;
    return h12 + ":" + mm + " " + ap + " ET";
  }

  function describe(r) {
    var t = fmtTime(r.time_local);
    var wds = r.byweekday && r.byweekday.length ? r.byweekday : null;
    var dom = r.day_of_month || 1;
    var ord = dom + (dom === 1 ? "st" : dom === 2 ? "nd" : dom === 3 ? "rd" : "th");
    switch (r.frequency) {
      case "daily":
        return wds
          ? "Weekly on " + wds.map(function (d) { return WD[d]; }).join(", ") + " at " + t
          : "Every day at " + t;
      case "weekly":
        return "Weekly on " + WD_LONG[wds ? wds[0] : 1] + " at " + t;
      case "monthly":
        return "Monthly on the " + ord + " at " + t;
      case "quarterly":
        return "Quarterly (Jan/Apr/Jul/Oct) on the " + ord + " at " + t;
      case "biannual":
        return "Twice a year (Jan 1 & Jul 1) at " + t;
      case "custom":
        return wds
          ? "On " + wds.map(function (d) { return WD[d]; }).join(", ") + " at " + t
          : "Every day at " + t;
      default:
        return "";
    }
  }

  return { isDue: isDue, describe: describe, partsInTZ: partsInTZ };
});
