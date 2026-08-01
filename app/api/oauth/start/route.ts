import { NextRequest, NextResponse } from "next/server";
import { buildLoginUrl } from "@/lib/instagram";

export async function GET(req: NextRequest) {
  const redirectUri = `${process.env.APP_URL}/api/oauth/callback`;
  return NextResponse.redirect(buildLoginUrl(redirectUri));
}
