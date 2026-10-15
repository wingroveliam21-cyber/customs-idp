import assert from "node:assert/strict";
import test from "node:test";
import {
  hasPasswordSetupMarker,
  passwordRecoveryCallbackError,
  passwordRecoveryRedirect,
  shouldEnterPasswordSetup,
  shouldKeepPasswordSetup,
  shouldWaitForPasswordRecovery
} from "../src/auth/passwordRecovery.js";

const session = {
  access_token: "test-access-token",
  user: { user_metadata: {} }
};

test("builds a dedicated recovery redirect URL", () => {
  assert.equal(passwordRecoveryRedirect("http://localhost:3000/"), "http://localhost:3000/reset-password");
});

test("recognises recovery callbacks in paths, queries, and fragments", () => {
  assert.equal(hasPasswordSetupMarker({ pathname: "/reset-password" }), true);
  assert.equal(hasPasswordSetupMarker({ search: "?type=recovery" }), true);
  assert.equal(hasPasswordSetupMarker({ hash: "#access_token=test&type=invite" }), true);
  assert.equal(hasPasswordSetupMarker({ pathname: "/inbox" }), false);
});

test("enters password setup before organisation authentication", () => {
  assert.equal(shouldEnterPasswordSetup({ event: "PASSWORD_RECOVERY", session }), true);
  assert.equal(shouldEnterPasswordSetup({ session, locationLike: { pathname: "/reset-password" } }), true);
});

test("does not expose password setup without an authenticated Supabase session", () => {
  assert.equal(shouldEnterPasswordSetup({ event: "PASSWORD_RECOVERY", session: null }), false);
});

test("keeps the recovery route pending while Supabase exchanges the email token", () => {
  assert.equal(
    shouldWaitForPasswordRecovery({ session: null, locationLike: { pathname: "/reset-password" } }),
    true
  );
  assert.equal(
    shouldWaitForPasswordRecovery({ session: null, locationLike: { pathname: "/inbox" } }),
    false
  );
  assert.equal(
    shouldWaitForPasswordRecovery({ session, locationLike: { pathname: "/reset-password" } }),
    false
  );
});

test("reports malformed and expired recovery callbacks",()=>{
  assert.match(passwordRecoveryCallbackError({search:"?error=access_denied&error_description=Token+has+expired"}),/invalid or has expired/);
  assert.match(passwordRecoveryCallbackError({hash:"#error_code=otp_expired&error=access_denied"}),/invalid or has expired/);
  assert.equal(passwordRecoveryCallbackError({pathname:"/reset-password"}),"");
});

test("keeps password setup active after Supabase cleans the recovery URL", () => {
  assert.equal(
    shouldKeepPasswordSetup({
      active: true,
      event: "TOKEN_REFRESHED",
      session,
      locationLike: { pathname: "/inbox" }
    }),
    true
  );
});

test("requires invited users to set a password once", () => {
  const invited = { access_token: "test", user: { invited_at: "2026-10-10", user_metadata: {} } };
  assert.equal(shouldEnterPasswordSetup({ session: invited }), true);
  invited.user.user_metadata.customs_idp_password_set = true;
  assert.equal(shouldEnterPasswordSetup({ session: invited }), false);
});
