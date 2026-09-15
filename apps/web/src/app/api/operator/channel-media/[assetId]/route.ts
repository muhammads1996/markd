import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

const MAX_SIGNED_MEDIA_SECONDS = 300;

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/operator/channel-media/[assetId]">,
) {
  const { assetId } = await context.params;
  const requested = Number(
    request.nextUrl.searchParams.get("expiresIn") ?? MAX_SIGNED_MEDIA_SECONDS,
  );
  const expiresIn = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_SIGNED_MEDIA_SECONDS)
    : MAX_SIGNED_MEDIA_SECONDS;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { data: authorised, error: authorisationError } = await supabase.rpc(
    "authorize_channel_media_read",
    { requested_asset_id: assetId, requested_expires_in: expiresIn },
  );
  const asset = authorised?.[0];
  if (authorisationError || !asset) {
    return NextResponse.json(
      { error: "Media is unavailable" },
      { status: 403 },
    );
  }
  const { data: signed, error: signingError } = await supabase.storage
    .from(asset.bucket_id)
    .createSignedUrl(asset.object_path, expiresIn);
  if (signingError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "Media could not be signed" },
      { status: 502 },
    );
  }
  return NextResponse.redirect(signed.signedUrl);
}
