// ---------------------------------------------------------------
// Gold session scheduling — shared, non-secret configuration.
// (Secrets — the Google key and the M365 feed URLs — live in Netlify
//  env vars, never here.)  Tune these numbers freely; the booking
// function re-validates against the SAME rules server-side.
// ---------------------------------------------------------------
window.MERIDIAN_SCHED = {
  // THE NINE SESSIONS, in order, with their length in minutes. This replaced the
  // six-session programme on 2026-08-04; the config was not updated with it, so
  // Gold booking was still offering six slots against a nine-session curriculum.
  //
  // THIS LIST IS DUPLICATED, DELIBERATELY, in netlify/functions/book-sessions.mjs
  // — the browser cannot be trusted with durations, so the function re-validates
  // against its own copy. Two copies means they can drift, and a drift here is
  // silent: the client books nine slots and the server rejects the payload.
  // `checks/check_sessions.py` fails if they stop matching. Edit both, run it.
  //
  // `remote` is carried for the three remote sessions (5, 8, 9) so a travel
  // buffer can skip them. Nothing consumes it yet; travelBufferMin is still 0.
  sessions: [
    // Durations INCLUDE a 30-minute Implementation check-in at the START of Sessions 2-9
  // (questions on prior sessions, implementation, issues) - ruled by Kevin 2026-11-11.
  // Content time = dur - 30 for sessions 2-9; Session 1 has no check-in.
  { n: 1, title: "Purpose, Offer & Your Numbers",            dur: 90,  remote: false },
    { n: 2, title: "The Biology, and How We Say It",            dur: 210, remote: false },
    { n: 3, title: "Finding the Patients You Already Have",     dur: 150, remote: false },
    { n: 4, title: "The Consult: Knowing & Presenting",         dur: 210, remote: false },
    { n: 5, title: "Money, Coding & Consent",                   dur: 120,  remote: true  },
    { n: 6, title: "Case Selection & Treatment Planning",       dur: 210, remote: false },
    { n: 7, title: "Surgery Day: Kit, Guide & Protocol",        dur: 120,  remote: false },
    { n: 8, title: "Digital Workflow & Restorative",            dur: 150, remote: true  },
    { n: 9, title: "Keeping It: Peri-Implantitis & Full-Arch",  dur: 180, remote: true  }
  ],
  // A 30-minute onboarding call sits one week ahead of Session 1 for Silver and
  // Gold. It is scheduled automatically from the Session 1 slot the client picks
  // rather than chosen separately — one fewer decision, and it cannot drift.
  // Booked FIRST, before Session 1 (Kevin, 2026-11-11): owner + office manager, by video.
  // Covers the implementation plan, the office manager's role and data entry, and the
  // portal/resources walkthrough. Stored as session_number 0. Gold only.
  onboardingCall: {
    title: "Onboarding & Portal Walkthrough",
    dur: 60,
    format: "video",
    leadDays: 2,             // no sooner than this many days out
    minDaysBeforeS1: 3,      // Session 1 sits 3–14 days after it
    maxDaysBeforeS1: 14,
    tiers: ["gold"]
  },

  gapMinDays: 14,          // earliest a session may sit after the previous one
  gapMaxDays: 21,          // latest ("2–3 weeks")
  firstLeadDays: 10,       // Session 1 no sooner than this many days out
  session1HorizonDays: 182, // how far ahead to offer Session 1 slots (~6 months; was 30, ruled too tight 2026-11-11)
  workStartHour: 9,        // Mon–Fri 9–5, Eastern
  workEndHour: 17,
  slotStepMin: 30,         // slot start granularity
  travelBufferMin: 0,      // set to e.g. 45 to keep a gap around each on-site session
  tz: "America/New_York"
};
