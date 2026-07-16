// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearerToken(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function isAppleUser(user: any) {
  const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return providers.includes("apple") || identities.some((identity: any) => identity?.provider === "apple");
}

function base64Url(input: string | ArrayBuffer) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem: string) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function normalizePrivateKey(raw: string) {
  const value = raw.trim().replace(/\\n/g, "\n");
  if (value.includes("BEGIN PRIVATE KEY")) return value;
  return `-----BEGIN PRIVATE KEY-----\n${value}\n-----END PRIVATE KEY-----`;
}

async function createAppleClientSecret() {
  const teamId = Deno.env.get("APPLE_SIGN_IN_TEAM_ID")?.trim();
  const keyId = Deno.env.get("APPLE_SIGN_IN_KEY_ID")?.trim();
  const clientId = Deno.env.get("APPLE_SIGN_IN_CLIENT_ID")?.trim();
  const privateKey = Deno.env.get("APPLE_SIGN_IN_PRIVATE_KEY")?.trim();
  const privateKeyBase64 = Deno.env.get("APPLE_SIGN_IN_PRIVATE_KEY_BASE64")?.trim();
  const rawPrivateKey = privateKey || (privateKeyBase64 ? atob(privateKeyBase64) : "");

  if (!teamId || !keyId || !clientId || !rawPrivateKey) {
    return { ok: false as const, error: "Apple revocation is not configured." };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 60 * 20,
    aud: "https://appleid.apple.com",
    sub: clientId,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(normalizePrivateKey(rawPrivateKey)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return {
    ok: true as const,
    clientId,
    clientSecret: `${signingInput}.${base64Url(signature)}`,
  };
}

async function revokeAppleAuthorizationCode(code: string) {
  const client = await createAppleClientSecret();
  if (!client.ok) return { ok: false as const, status: "not_configured", message: client.error };

  const tokenBody = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  const tokenJson = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok) {
    return { ok: false as const, status: "failed", message: "Apple authorization could not be verified." };
  }

  const token = tokenJson?.refresh_token || tokenJson?.access_token;
  const tokenTypeHint = tokenJson?.refresh_token ? "refresh_token" : "access_token";
  if (!token) {
    return { ok: false as const, status: "failed", message: "Apple did not return a revocable token." };
  }

  const revokeBody = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    token,
    token_type_hint: tokenTypeHint,
  });
  const revokeRes = await fetch(APPLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: revokeBody,
  });
  if (!revokeRes.ok) {
    return { ok: false as const, status: "failed", message: "Apple token revocation failed." };
  }
  return { ok: true as const, status: "revoked" };
}

async function deleteMatching(supabase: any, table: string, column: string, userId: string) {
  const { error } = await supabase.from(table).delete().eq(column, userId);
  if (error) throw new Error(`cleanup failed: ${table}`);
}

async function deleteAvatarObjects(supabase: any, userId: string) {
  const paths: string[] = [];
  const { data, error } = await supabase.storage.from("avatars").list(userId, { limit: 1000 });
  if (error) throw new Error("avatar cleanup failed");
  for (const item of data ?? []) {
    if (item?.name) paths.push(`${userId}/${item.name}`);
  }
  if (!paths.length) return;
  for (let i = 0; i < paths.length; i += 100) {
    const { error: removeErr } = await supabase.storage.from("avatars").remove(paths.slice(i, i + 100));
    if (removeErr) throw new Error("avatar cleanup failed");
  }
}

async function cleanupAccountData(supabase: any, userId: string) {
  await deleteAvatarObjects(supabase, userId);

  await deleteMatching(supabase, "listen_list", "user_id", userId);
  await deleteMatching(supabase, "upcoming_releases", "user_id", userId);
  await deleteMatching(supabase, "followed_artists", "user_id", userId);

  await deleteMatching(supabase, "connection_invites", "inviter_id", userId);
  const { error: inviteAcceptedErr } = await supabase
    .from("connection_invites")
    .update({ accepted_by: null })
    .eq("accepted_by", userId);
  if (inviteAcceptedErr) throw new Error("cleanup failed: connection_invites");

  const { error: friendErr } = await supabase
    .from("friend_requests")
    .delete()
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`);
  if (friendErr) throw new Error("cleanup failed: friend_requests");

  await deleteMatching(supabase, "profiles", "id", userId);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Server is not configured." }, 500);
  }

  try {
    const token = bearerToken(req);
    if (!token) return json({ ok: false, error: "Authentication required." }, 401);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (body?.userId || body?.user_id) {
      return json({ ok: false, error: "User selection is not allowed." }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller?.id) return json({ ok: false, error: "Authentication required." }, 401);

    const { data: adminUserData, error: adminUserErr } = await supabase.auth.admin.getUserById(caller.id);
    const authUser = adminUserData?.user ?? caller;
    if (adminUserErr || !authUser?.id) return json({ ok: false, error: "Account not found." }, 404);

    let appleRevocation = { status: "not_applicable" };
    if (isAppleUser(authUser)) {
      const appleCode = typeof body?.appleAuthorizationCode === "string" ? body.appleAuthorizationCode.trim() : "";
      if (!appleCode) {
        return json({
          ok: false,
          code: "apple_reauthorization_required",
          error: "Apple reauthorization is required before deleting this account.",
        }, 400);
      }

      const revocation = await revokeAppleAuthorizationCode(appleCode);
      if (!revocation.ok) {
        return json({
          ok: false,
          code: revocation.status === "not_configured" ? "apple_revocation_not_configured" : "apple_revocation_failed",
          error: revocation.message,
          appleRevocation: { status: revocation.status },
        }, revocation.status === "not_configured" ? 501 : 400);
      }
      appleRevocation = { status: "revoked" };
    }

    await cleanupAccountData(supabase, caller.id);

    const { error: deleteErr } = await supabase.auth.admin.deleteUser(caller.id);
    if (deleteErr) return json({ ok: false, error: "Could not delete account." }, 500);

    return json({ ok: true, appleRevocation });
  } catch (e) {
    console.error("[delete-account] failed", { message: (e as Error)?.message });
    return json({ ok: false, error: "Could not delete account." }, 500);
  }
});
