import { NextRequest, NextResponse } from "next/server";

const TEE_ORIGIN = "https://tee.magicblock.app";

/**
 * Proxies TEE auth requests server-side.
 * GET: forward challenge request
 * POST: forward token request
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "auth/challenge";
  const pubkey = url.searchParams.get("pubkey") || "";

  const targetUrl = `${TEE_ORIGIN}/${path}?pubkey=${pubkey}`;

  try {
    const resp = await fetch(targetUrl);
    const data = await resp.text();
    return new NextResponse(data, {
      status: resp.status,
      headers: {
        "Content-Type": resp.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "auth/token";
  const body = await request.text();

  const targetUrl = `${TEE_ORIGIN}/${path}`;

  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await resp.text();
    return new NextResponse(data, {
      status: resp.status,
      headers: {
        "Content-Type": resp.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
