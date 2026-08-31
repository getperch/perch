import type { ConnectorId } from "./connector.js";
import type { ProcedureStep } from "./procedure.js";

/**
 * Pre-authored local-setup routines: an ordinary list of `ProcedureStep`s the desktop app replays
 * through the Playwright sidecar to configure a connector's credentials. Nothing here is special —
 * it's the same step format a recorded routine uses, so a broken step can be fixed here (or, later,
 * re-recorded) without touching code paths. The `humanCheckpoint` steps are where the person does
 * something in their own browser (sign in, a wizard) and the routine waits for the result.
 *
 * The Google Workspace routine ends with an `extract` step that scrapes the created OAuth client's
 * id and secret from the page; the caller stores them via the connectors config API.
 */
export type ConnectorSetupRoutine = {
  startUrl: string;
  /** SSM-style keys the routine's `extract` steps produce; the caller maps these to config fields */
  produces: string[];
  steps: ProcedureStep[];
};

const GOOGLE_WORKSPACE: ConnectorSetupRoutine = {
  startUrl: "https://console.cloud.google.com/projectcreate",
  produces: ["clientId", "clientSecret"],
  steps: [
    {
      id: "project",
      kind: "humanCheckpoint",
      selectors: [],
      url: "console.cloud.google.com",
      label:
        'Sign in if asked, then create a project named "perch-workspace" (or select an existing one). Continue once a project is selected.',
    },
    {
      id: "enable-gmail",
      kind: "goto",
      selectors: [],
      url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
      label: "Open the Gmail API page",
    },
    { id: "enable-gmail-click", kind: "click", selectors: ['button:has-text("Enable")', 'role=button[name="Enable"]'], label: "Enable the Gmail API", optional: true },
    {
      id: "enable-calendar",
      kind: "goto",
      selectors: [],
      url: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
      label: "Open the Google Calendar API page",
    },
    { id: "enable-calendar-click", kind: "click", selectors: ['button:has-text("Enable")', 'role=button[name="Enable"]'], label: "Enable the Google Calendar API", optional: true },
    {
      id: "consent",
      kind: "goto",
      selectors: [],
      url: "https://console.cloud.google.com/apis/credentials/consent",
      label: "Open the OAuth consent screen",
    },
    {
      id: "consent-human",
      kind: "humanCheckpoint",
      selectors: ['button:has-text("Create credentials")', 'role=button[name="Create credentials"]'],
      label:
        'Configure the OAuth consent screen: User type = External, App name = "Perch", your own email for support + developer contact, add your Google account under Test users, then Save. Then open the Credentials page. I continue once it loads.',
    },
    {
      id: "create-client",
      kind: "humanCheckpoint",
      selectors: ["text=/GOCSPX-/"],
      url: "console.cloud.google.com/apis/credentials/oauthclient",
      label:
        'Create an OAuth client: Create credentials → OAuth client ID → Application type = "Desktop app", name "Perch Desktop" → Create.',
    },
    { id: "client-id", kind: "extract", selectors: ["body"], extractKey: "clientId", pattern: "[A-Za-z0-9-]+\\.apps\\.googleusercontent\\.com" },
    { id: "client-secret", kind: "extract", selectors: ["body"], extractKey: "clientSecret", pattern: "GOCSPX-[A-Za-z0-9_-]{10,}" },
  ],
};

export const CONNECTOR_SETUP_ROUTINES: Partial<Record<ConnectorId, ConnectorSetupRoutine>> = {
  "google-workspace": GOOGLE_WORKSPACE,
};
