import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const TEE_ORIGIN = "https://tee.magicblock.app";

/**
 * Server-side TEE RPC proxy.
 * Accepts JSON-RPC body + token in X-Tee-Token header.
 * Makes the request server-side to bypass CORS entirely.
 */
export async function POST(request: NextRequest) {
  // Accept token from header OR query param (fallback)
  const url = new URL(request.url);
  const token =
    request.headers.get("x-tee-token") ||
    url.searchParams.get("teetoken") ||
    "";
  const body = await request.text();

  console.log("[tee-rpc] token length:", token.length, "token preview:", token.substring(0, 20) + "...");

  const targetUrl = token ? `${TEE_ORIGIN}?token=${token}` : TEE_ORIGIN;

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
    return NextResponse.json(
      { error: "TEE proxy error", details: String(err) },
      { status: 502 }
    );
  }
}
