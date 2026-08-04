// The starter reminder set, seeded once for every Silver and Gold client.
//
// These mirror Chapter 6 of the Playbook ("Implementation: The Recurring
// Schedule") — the book's whole argument is that systems fail because nobody
// scheduled them, so the schedule ships pre-built rather than left as homework.
//
// Everything here is a DEFAULT. The client edits recipient, day and time from
// the reminders page; the seed only runs when they have no reminders at all, so
// their edits are never overwritten.
//
// `agenda`, `goal` and `docs` are carried into the email body by
// reminder-dispatch.mjs, so a reminder arrives knowing what the meeting is for
// and which documents to open.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MeridianReminderTemplates = api;
})(typeof self !== "undefined" ? self : this, function () {

  var RES = "/resources.html";

  var CADENCE = [
    {
      key: "daily-huddle",
      title: "Daily huddle — implant funnel",
      category: "goals_kpi",
      frequency: "daily",
      byweekday: [1, 2, 3, 4, 5],          // clinical days only
      time_local: "07:45",
      goal: "Keep the three funnel numbers visible to the whole team, every day.",
      agenda: [
        "Log yesterday's numbers: conversations opened, consults booked, cases accepted.",
        "Name today's opportunities — who on the schedule has a missing tooth, a failing tooth, or a partial?",
        "Assign who raises it, in which chair."
      ],
      docs: [{ label: "Daily Huddle Scorecard", href: RES + "#daily-huddle-scorecard" }]
    },
    {
      key: "weekly-alignment",
      title: "Weekly alignment — wins and blockers",
      category: "goals_kpi",
      frequency: "weekly",
      byweekday: [1],
      time_local: "08:00",
      goal: "Catch a stalling system in the same week it stalls, not at the end of the quarter.",
      agenda: [
        "Log the week's biggest win and biggest blocker.",
        "Check the funnel: which of the three stages moved, which didn't?",
        "If consults are booking but not converting, the gap is in the consult room. If conversations aren't producing consults, the gap is the handoff.",
        "Agree one action for the coming week, with a name against it."
      ],
      docs: [{ label: "Weekly Alignment Log", href: RES + "#weekly-alignment-log" }]
    },
    {
      key: "monthly-review",
      title: "Monthly review — where is the bottleneck?",
      category: "goals_kpi",
      frequency: "monthly",
      day_of_month: 1,
      time_local: "08:00",
      goal: "Find this month's bottleneck stage and coach it specifically.",
      agenda: [
        "Update the KPI tracker with the month's totals.",
        "Compare against baseline — what has actually moved since you started?",
        "Identify the single weakest stage of the funnel and choose the coaching that fits it.",
        "Review case acceptance rate and average case value."
      ],
      docs: [{ label: "Monthly Review Sheet", href: RES + "#monthly-review-sheet" }]
    },
    {
      key: "quarterly-tracker",
      title: "Quarterly reset — score the key results",
      category: "goals_kpi",
      frequency: "quarterly",
      day_of_month: 1,
      time_local: "08:00",
      goal: "Score last quarter honestly, then set two to four objectives for the next one.",
      agenda: [
        "Score every key result from last quarter: hit, missed, or abandoned.",
        "Update Baseline / Target / Where we are now on the tracker.",
        "Set 2–4 objectives for the coming quarter — no more.",
        "Remember the rule: if it isn't on the tracker, it doesn't get a bonus."
      ],
      docs: [{ label: "Quarterly Clinical Milestone Tracker", href: RES + "#quarterly-clinical-milestone-tracker" }]
    },
    {
      key: "yearly-vision",
      title: "Annual vision & offer review",
      category: "goals_kpi",
      frequency: "yearly",
      month_of_year: 1,
      day_of_month: 8,
      time_local: "08:00",
      goal: "Reset the year's vision, and check the offer still matches what the practice actually does.",
      agenda: [
        "Revisit the one-year vision — is it still the right one?",
        "Re-run the Offer Worksheet: technology, fee ranges, financing. Fees drift; the script shouldn't.",
        "Compare the full year against the baselines captured at the start.",
        "Set the year's headline objective before the first quarterly reset."
      ],
      docs: [
        { label: "Shared Purpose & Vision Alignment Worksheet", href: RES + "#shared-purpose-vision-alignment-worksheet" },
        { label: "Your Offer Worksheet", href: RES + "#your-offer-worksheet" }
      ]
    }
  ];

  // The reactivation letters. Staggered a month apart so the practice runs one
  // campaign at a time and can attribute the response to a specific letter —
  // mailing all four at once tells you nothing about which worked.
  var LETTERS = [
    { key: "letter-1", n: 1, month: 2,  title: "Mail Letter 1 — recent extraction patients",
      goal: "Reach patients who lost a tooth recently, while the site is still restorable." },
    { key: "letter-2", n: 2, month: 5,  title: "Mail Letter 2 — patients living with missing teeth",
      goal: "The fishing letter: reach the largest group in your database — people who have simply lived with the gap." },
    { key: "letter-3", n: 3, month: 8,  title: "Mail Letter 3 — partial and denture patients",
      goal: "Reach the patients losing bone fastest, who usually don't know it." },
    { key: "letter-4", n: 4, month: 11, title: "Mail Letter 4 — complimentary consultation offer",
      goal: "A low-friction offer to the existing base, for anyone the first three letters didn't move." }
  ].map(function (l) {
    return {
      key: l.key,
      title: l.title,
      category: "marketing",
      frequency: "yearly",
      month_of_year: l.month,
      day_of_month: 5,
      time_local: "08:00",
      goal: l.goal,
      agenda: [
        "Pull the patient list this letter targets from your practice management software.",
        "Personalize the letterhead and the opening line.",
        "Keep the P.S. — in direct mail it is the second-most-read line on the page.",
        "Log the send date so responses can be attributed to this letter."
      ],
      docs: [{ label: "Letter Template " + l.n, href: RES + "#letter-template-" + l.n }]
    };
  });

  var ALL = CADENCE.concat(LETTERS);

  // Shape a template into a row for public.reminders.
  function toRow(t, userId, email) {
    return {
      user_id: userId,
      title: t.title,
      category: t.category,
      channel: "email",
      frequency: t.frequency,
      byweekday: t.byweekday || null,
      day_of_month: t.day_of_month || null,
      month_of_year: t.month_of_year || null,
      time_local: t.time_local,
      timezone: "America/New_York",
      target_email: email || null,
      template_key: t.key,
      goal: t.goal,
      agenda: t.agenda,
      docs: t.docs,
      active: true
    };
  }

  return { ALL: ALL, CADENCE: CADENCE, LETTERS: LETTERS, toRow: toRow };
});
