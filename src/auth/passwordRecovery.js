export const PASSWORD_RECOVERY_PATH = "/reset-password";

function locationParts(locationLike = {}) {
  return {
    pathname: String(locationLike.pathname || ""),
    search: String(locationLike.search || ""),
    hash: String(locationLike.hash || "")
  };
}

export function hasPasswordSetupMarker(locationLike) {
  const { pathname, search, hash } = locationParts(locationLike);
  if (pathname === PASSWORD_RECOVERY_PATH) return true;
  return /(?:^|[?&#])type=(?:invite|recovery)(?:[&#]|$)/.test(search + hash);
}

export function shouldEnterPasswordSetup({ event, session, locationLike }) {
  if (!session?.access_token) return false;
  if (event === "PASSWORD_RECOVERY") return true;
  if (hasPasswordSetupMarker(locationLike)) return true;
  return Boolean(
    session.user?.invited_at &&
    session.user?.user_metadata?.customs_idp_password_set !== true
  );
}

export function shouldKeepPasswordSetup({ active, event, session, locationLike }) {
  return Boolean(active) || shouldEnterPasswordSetup({ event, session, locationLike });
}

export function shouldWaitForPasswordRecovery({ session, locationLike }) {
  return !session?.access_token && hasPasswordSetupMarker(locationLike);
}

export function passwordRecoveryCallbackError(locationLike) {
  const { search, hash } = locationParts(locationLike);
  for (const value of [search.replace(/^\?/, ""), hash.replace(/^#/, "")]) {
    const params = new URLSearchParams(value);
    if (params.get("error") || params.get("error_description")) {
      return "This password recovery link is invalid or has expired. Request a new password reset email.";
    }
  }
  return "";
}

export function passwordRecoveryRedirect(origin) {
  const base = String(origin || "").replace(/\/+$/, "");
  if (!base) throw new Error("An application origin is required for password recovery.");
  return base + PASSWORD_RECOVERY_PATH;
}
