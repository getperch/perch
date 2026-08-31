/**
 * Minimal server-rendered forms for OpenAuth's PasswordProvider, replacing its default PasswordUI.
 * Every link/form action here is a relative path (no leading slash) — that's what makes mounting
 * this whole issuer under /auth on the main API (see infra/api.ts) work correctly, since the
 * browser resolves them relative to wherever the page was actually served from.
 */

/** The Perch mark — one bird, one colour, beak knocked out via evenodd (see `Perch Identity.dc.html`),
 *  inlined so these server-rendered pages stay self-contained. */
const mark = `<svg width="34" height="38" viewBox="0 0 118 131" fill="none" aria-hidden="true">
  <path fill="#7D35EB" fill-rule="evenodd" transform="matrix(0.180982 0 0 0.18144 -26.6044 -29.2119)" d="M473.211 402.973C502.36 359.895 531.853 317.051 561.686 274.444L588.514 235.604C594.775 226.438 606.216 208.893 614.117 201.461C628.303 188.163 645.918 179.088 664.981 175.255C691.558 170.308 719.012 176.111 741.314 191.391C763.084 206.428 778.919 230.7 783.899 256.756C785.679 266.072 785.186 282.155 785.195 292.169L785.39 339.804L785.468 458.283C785.457 481.513 786.519 517.109 782.663 538.805C778.053 565.186 767.711 590.234 752.367 612.182C724.739 651.843 682.389 678.798 634.761 687.035C618.684 689.799 606.506 689.551 590.302 689.577L552.684 689.601L506.167 689.561C495.861 689.534 483.755 689.651 473.528 688.997L470.623 690.17L252.159 815.674C220.213 833.928 185.932 854.938 153.533 871.748L223.34 769.797C229.108 761.486 234.798 753.12 240.408 744.702C242.345 741.802 248.216 732.748 250.184 730.594C251.528 728.182 253.104 725.894 254.606 723.578C264.278 708.665 274.478 694.107 284.454 679.4L354.821 576.494L439.189 452.15C450.466 435.673 461.395 419.063 473.211 402.973Z M620.455 268.173C638.491 267.757 657.105 268.066 675.213 268.051C697.41 267.907 719.608 267.942 741.805 268.159C730.207 284.626 718.412 300.954 706.425 317.139C698.111 328.703 689.706 340.201 681.212 351.633C673.63 342.776 665.819 330.93 658.773 321.18L620.455 268.173Z" />
</svg>`;

function page(title: string, body: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Perch</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Geist:wght@400;500&display=swap" rel="stylesheet" />
<style>
  body { font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #F7F5FA; color: #413D4E; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; letter-spacing: -0.006em; -webkit-font-smoothing: antialiased; }
  .brand { display: flex; align-items: center; gap: 11px; margin-bottom: 20px; }
  .brand span { font-family: "Space Grotesk", sans-serif; font-weight: 600; font-size: 30px; letter-spacing: -0.05em; color: #413D4E; }
  form { width: 320px; background: #fff; border: 1px solid #E4E1EC; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; }
  h1 { font-family: "Space Grotesk", sans-serif; font-size: 18px; font-weight: 500; letter-spacing: -0.02em; margin: 0 0 4px; }
  p.hint { font-size: 13px; color: #77778A; margin: -8px 0 4px; line-height: 1.5; }
  input { height: 38px; border: 1px solid #E4E1EC; border-radius: 11px; padding: 0 12px; font-size: 14px; font-family: inherit; outline: none; box-sizing: border-box; width: 100%; color: #413D4E; }
  input:focus { border-color: #7D35EB; }
  button { height: 38px; background: #7D35EB; color: #fff; border: none; border-radius: 11px; font-family: inherit; font-weight: 500; cursor: pointer; font-size: 14px; }
  button:hover { background: #5C27BE; }
  .error { font-size: 12px; color: #8A4340; }
  a { font-size: 12px; color: #6A31CC; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body><div class="brand">${mark}<span>perch</span></div>${body}</body>
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
        <h1>Sign in</h1>
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
        <h1>Create your account</h1>
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
