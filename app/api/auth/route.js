import crypto from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const COOKIE_NAME = "customs-idp-auth";
const MAX_AGE_SECONDS = 60 * 60;
const DEFAULT_ORGANISATION_ID = "demo-organisation";

const LOCAL_TEST_USERS = {
  liam: { id: "local-liam", email: "liam@example.test", name: "Liam Wingrove", role: "manager" },
  muhammad: { id: "local-muhammad", email: "muhammad@example.test", name: "Muhammad Amer", role: "manager" },
  processor1: { id: "local-processor-1", email: "processor1@example.test", name: "Data Processor 1", role: "member" },
  processor2: { id: "local-processor-2", email: "processor2@example.test", name: "Data Processor 2", role: "member" }
};

function getSecret() {
  const configured = String(process.env.IDP_AUTH_SECRET || "").trim();
  if (!configured) throw new Error("IDP_AUTH_SECRET is required.");
  return configured;
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const i = part.indexOf("=");
        return i < 0 ? [part, ""] : [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
      })
  );
}

function getAuthContext(request) {
  const token = parseCookies(request.headers.get("cookie") || "")[COOKIE_NAME];
  if (!token) return null;

  const [encoded, signature] = String(token).split(".");
  if (!encoded || !signature) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const issuedAt = Number(payload?.iat);
  const age = Date.now() - issuedAt;
  if (!Number.isFinite(issuedAt) || age < 0 || age > MAX_AGE_SECONDS * 1000) return null;

  const expected = sign(encoded);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  return {
    authenticated: true,
    organisationId: String(payload.organisationId || DEFAULT_ORGANISATION_ID),
    userId: String(payload.userId || ""),
    email: String(payload.email || ""),
    name: String(payload.name || ""),
    role: String(payload.role || "member")
  };
}

function createCookie(context) {
  const payload = JSON.stringify({
    iat: Date.now(),
    organisationId: String(context.organisationId || DEFAULT_ORGANISATION_ID),
    userId: String(context.userId || ""),
    email: String(context.email || ""),
    name: String(context.name || ""),
    role: String(context.role || "member")
  });
  const encoded = Buffer.from(payload).toString("base64url");
  return {
    name: COOKIE_NAME,
    value: encoded + "." + sign(encoded),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS
  };
}

function clearCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  };
}

function isLocalTestRequest(request) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") return false;
  const host = String(request.headers.get("host") || "").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

async function getSupabaseUser(accessToken) {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "sb_publishable_i-IHnlw8Q8BJI-dtBC3WKw_dwVxsE-J"
  );
  if (!url || !key) throw new Error("Supabase URL and publishable key are required for authentication.");

  const response = await fetch(url + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + accessToken },
    cache: "no-store"
  });
  if (!response.ok) return null;
  return response.json();
}

async function getMembership(userId) {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!url || !key) throw new Error("Supabase service configuration is missing.");

  const response = await fetch(
    url + "/rest/v1/organisation_members?user_id=eq." + encodeURIComponent(userId) + "&select=organisation_id,role&limit=1",
    {
      headers: { apikey: key, Authorization: "Bearer " + key },
      cache: "no-store"
    }
  );
  if (!response.ok) throw new Error(await response.text());
  const rows = await response.json();
  return rows[0] || null;
}

export async function GET(request) {
  const url = new URL(request.url);

  if (url.searchParams.get("debug") === "1" && isLocalTestRequest(request)) {
    return NextResponse.json(
      {
        route: "app/api/auth/route",
        vercelEnv: process.env.VERCEL_ENV || null,
        nodeEnv: process.env.NODE_ENV || null,
        hasCookie: Boolean(request.headers.get("cookie")),
        hasIdpAuthSecret: Boolean(process.env.IDP_AUTH_SECRET),
        hasSupabaseUrl: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
        hasPublishableKey: Boolean(
          process.env.SUPABASE_PUBLISHABLE_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
          process.env.SUPABASE_ANON_KEY
        ),
        hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
      },
      { headers: { "X-Customs-IDP-Auth-Route": "app-api-v1" } }
    );
  }

  let context;
  try { context = getAuthContext(request); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 503 }); }
  if (!context) return NextResponse.json({ authenticated: false });

  return NextResponse.json({
    authenticated: true,
    requiresPasswordSetup: false,
    user: {
      id: context.userId,
      email: context.email,
      name: context.name,
      role: context.role
    },
    organisation: { id: context.organisationId }
  });
}

export async function POST(request) {
  const url = new URL(request.url);

  if (url.searchParams.get("mode") === "local-test") {
    if (!isLocalTestRequest(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const user = LOCAL_TEST_USERS[String(body?.userId || "liam")];
    if (!user) return NextResponse.json({ error: "Unknown local test user." }, { status: 400 });

    const context = { ...user, organisationId: DEFAULT_ORGANISATION_ID };
    const response = NextResponse.json({
      authenticated: true,
      user,
      organisation: { id: context.organisationId }
    });
    response.cookies.set(createCookie(context));
    return response;
  }

  try {
    const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Supabase access token is required." }, { status: 401 });

    const user = await getSupabaseUser(token);
    if (!user) return NextResponse.json({ error: "Supabase session is invalid or expired." }, { status: 401 });

    const membership = await getMembership(user.id);
    if (!membership) {
      return NextResponse.json(
        { error: "Your Supabase account is not assigned to a Customs IDP organisation." },
        { status: 403 }
      );
    }

    const context = {
      organisationId: membership.organisation_id,
      userId: user.id,
      email: user.email || "",
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || "",
      role: membership.role || "member"
    };

    const response = NextResponse.json({
      authenticated: true,
      user: {
        id: context.userId,
        email: context.email,
        name: context.name,
        role: context.role
      },
      organisation: { id: context.organisationId }
    });
    response.cookies.set(createCookie(context));
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Authentication service configuration is missing." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(clearCookie());
  return response;
}
