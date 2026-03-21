import { NextRequest, NextResponse } from "next/server";

const TEE_ORIGIN = "https://tee.magicblock.app";

/**
 * Proxy all requests to tee.magicblock.app to bypass CORS.
 * Routes: /api/tee/auth/challenge, /api/tee/auth/token, /api/tee/quote, etc.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join("/");
  const url = new URL(request.url);
  const targetUrl = `${TEE_ORIGIN}/${path}${url.search}`;

  try {
    const resp = await fetch(targetUrl, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await resp.text();
    return new NextResponse(data, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join("/");
  const url = new URL(request.url);
  const targetUrl = `${TEE_ORIGIN}/${path}${url.search}`;
  const body = await request.text();

  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });
    const data = await resp.text();
    return new NextResponse(data, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
