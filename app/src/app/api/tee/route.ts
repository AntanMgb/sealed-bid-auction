import { NextRequest, NextResponse } from "next/server";

const TEE_ORIGIN = "https://tee.magicblock.app";

/**
 * Proxy root TEE RPC requests (JSON-RPC with ?token=...) to bypass CORS.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const targetUrl = `${TEE_ORIGIN}${url.search}`;
  const body = await request.text();

  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
