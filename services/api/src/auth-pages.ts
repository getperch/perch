/**
 * Minimal server-rendered forms for OpenAuth's PasswordProvider, replacing its default PasswordUI.
 * Every link/form action here is a relative path (no leading slash) — that's what makes mounting
 * this whole issuer under /auth on the main API (see infra/api.ts) work correctly, since the
 * browser resolves them relative to wherever the page was actually served from.
 */

function page(title: string, body: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Fizz</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f1f1f1; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  form { width: 320px; background: #fff; border: 1px solid #00000014; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 4px; }
  p.hint { font-size: 13px; color: #666; margin: -8px 0 4px; }
  input { height: 36px; border: 1px solid #d4d4d4; border-radius: 12px; padding: 0 12px; font-size: 14px; outline: none; box-sizing: border-box; width: 100%; }
  button { height: 36px; background: #262626; color: #fff; border: none; border-radius: 12px; font-weight: 600; cursor: pointer; font-size: 14px; }
  .error { font-size: 12px; color: #7a1414; }
  a { font-size: 12px; color: #666; text-decoration: none; }
</style>
</head>
<body>${body}</body>
</html>`;
}

function html(body: string) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

const loginErrorText: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  invalid_password: "Incorrect email or password.",
};

export async function loginPage(error?: { type: string }): Promise<Response> {
  return html(
    page(
      "Sign in",
      `<form method="post" action="authorize">
        <h1>Sign in to Fizz</h1>
        <input type="email" name="email" placeholder="you@company.com" required />
        <input type="password" name="password" placeholder="Password" required />
        ${error ? `<div class="error">${loginErrorText[error.type] ?? "Something went wrong."}</div>` : ""}
        <button type="submit">Sign in</button>
        <a href="register">New here? Create an account</a>
      </form>`,
    ),
  );
}

const registerErrorText: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  invalid_password: "Enter a password.",
  password_mismatch: "Passwords don't match.",
  email_taken: "An account with this email already exists.",
  invalid_code: "That code isn't right — try again.",
  validation_error: "That password doesn't meet the requirements.",
};

export async function registerPage(state: { type: string; email?: string }, error?: { type: string }): Promise<Response> {
  const errorHtml = error ? `<div class="error">${registerErrorText[error.type] ?? "Something went wrong."}</div>` : "";

  if (state.type === "code") {
    return html(
      page(
        "Verify your email",
        `<form method="post" action="register">
          <h1>Check your email</h1>
          <p class="hint">Enter the 6-digit code sent to ${state.email}.</p>
          <input type="hidden" name="action" value="verify" />
          <input type="text" name="code" placeholder="123456" inputmode="numeric" required />
          ${errorHtml}
          <button type="submit">Verify</button>
        </form>`,
      ),
    );
  }

  return html(
    page(
      "Create your account",
      `<form method="post" action="register">
        <h1>Create your Fizz account</h1>
        <p class="hint">Only works for emails an admin already added as a member.</p>
        <input type="hidden" name="action" value="register" />
        <input type="email" name="email" placeholder="you@company.com" required />
        <input type="password" name="password" placeholder="Password" required />
        <input type="password" name="repeat" placeholder="Repeat password" required />
        ${errorHtml}
        <button type="submit">Create account</button>
        <a href="authorize">Already have an account? Sign in</a>
      </form>`,
    ),
  );
}

const changeErrorText: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  invalid_code: "That code isn't right — try again.",
  invalid_password: "Enter a password.",
  password_mismatch: "Passwords don't match.",
  validation_error: "That password doesn't meet the requirements.",
};

export async function changePage(state: { type: string; email?: string }, error?: { type: string }): Promise<Response> {
  const errorHtml = error ? `<div class="error">${changeErrorText[error.type] ?? "Something went wrong."}</div>` : "";

  if (state.type === "code") {
    return html(
      page(
        "Verify your email",
        `<form method="post" action="change">
          <h1>Check your email</h1>
          <p class="hint">Enter the 6-digit code sent to ${state.email}.</p>
          <input type="hidden" name="action" value="verify" />
          <input type="text" name="code" placeholder="123456" inputmode="numeric" required />
          ${errorHtml}
          <button type="submit">Verify</button>
        </form>`,
      ),
    );
  }

  if (state.type === "update") {
    return html(
      page(
        "Set a new password",
        `<form method="post" action="change">
          <h1>Set a new password</h1>
          <input type="hidden" name="action" value="update" />
          <input type="password" name="password" placeholder="New password" required />
          <input type="password" name="repeat" placeholder="Repeat password" required />
          ${errorHtml}
          <button type="submit">Update password</button>
        </form>`,
      ),
    );
  }

  return html(
    page(
      "Reset your password",
      `<form method="post" action="change">
        <h1>Reset your password</h1>
        <input type="hidden" name="action" value="code" />
        <input type="email" name="email" placeholder="you@company.com" required />
        ${errorHtml}
        <button type="submit">Send code</button>
      </form>`,
    ),
  );
}
