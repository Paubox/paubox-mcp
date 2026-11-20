// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // The jest suites run this server in-process with outbound calls pointed at
  // dead or fake proxies; without this switch every simulated upstream failure
  // would be reported to the production project.
  enabled: process.env.PAUBOX_SENTRY_DISABLED !== "true",

  dsn: process.env.NODE_ENV === "production"
    ? "https://1425cc1eb06c68dda27190ef6182758a@oops.paubox.net/88" // production DSN
    : "https://d3726739469719b97e5cc0fbf24771c5@oops.paubox.net/87", // staging DSN

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
