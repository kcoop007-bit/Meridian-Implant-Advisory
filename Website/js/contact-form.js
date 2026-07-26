// Handles the homepage contact form. Writes to a `leads` table in Supabase
// if configured; otherwise falls back to a mailto: link so the form is
// never a dead end even before Supabase is wired up.
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("contact-form");
    if (!form) return;
    var status = document.getElementById("cf-status");

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var data = {
        name: form.name.value.trim(),
        practice: form.practice.value.trim(),
        email: form.email.value.trim(),
        role: form.role.value,
        message: form.message.value.trim()
      };

      var client = window.getSupabaseClient && window.getSupabaseClient();

      if (!client) {
        // Not configured yet -- fall back to mailto so nothing is lost.
        var subject = encodeURIComponent("New inquiry from " + (data.name || "website"));
        var body = encodeURIComponent(
          "Name: " + data.name + "\nPractice: " + data.practice +
          "\nEmail: " + data.email + "\nRole: " + data.role +
          "\n\n" + data.message
        );
        window.location.href = "mailto:hello@meridianimplantadvisory.com?subject=" + subject + "&body=" + body;
        return;
      }

      status.textContent = "Sending...";
      var { error } = await client.from("leads").insert([data]);
      if (error) {
        status.textContent = "Something went wrong — please email hello@meridianimplantadvisory.com directly.";
        status.style.color = "#B4423C";
      } else {
        form.reset();
        status.textContent = "Thanks — I'll be in touch within a business day.";
        status.style.color = "#2E7D4F";
      }
    });
  });
})();
