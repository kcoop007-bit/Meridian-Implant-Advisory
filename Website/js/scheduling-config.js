// ---------------------------------------------------------------
// Gold session scheduling — shared, non-secret configuration.
// (Secrets — the Google key and the M365 feed URLs — live in Netlify
//  env vars, never here.)  Tune these numbers freely; the booking
// function re-validates against the SAME rules server-side.
// ---------------------------------------------------------------
window.MERIDIAN_SCHED = {
  // The six sessions, in order, with their length in minutes.
  sessions: [
    { n: 1, title: "Purpose & Offer",                         dur: 90  },
    { n: 2, title: "Biology & Language",                      dur: 90  },
    { n: 3, title: "Finding Patients",                        dur: 90  },
    { n: 4, title: "Knowing the Patient & Presenting",        dur: 120 },
    { n: 5, title: "Money & Paperwork",                       dur: 120 },
    { n: 6, title: "Clinical Track — Surgery Day & Maintenance", dur: 90 }
  ],
  gapMinDays: 14,          // earliest a session may sit after the previous one
  gapMaxDays: 21,          // latest ("2–3 weeks")
  firstLeadDays: 10,       // Session 1 no sooner than this many days out
  session1HorizonDays: 30, // how far ahead to offer Session 1 slots
  workStartHour: 9,        // Mon–Fri 9–5, Eastern
  workEndHour: 17,
  slotStepMin: 30,         // slot start granularity
  travelBufferMin: 0,      // set to e.g. 45 to keep a gap around each on-site session
  tz: "America/New_York"
};
