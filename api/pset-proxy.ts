export const config = { runtime: "edge" };

export default async function handler(request: Request) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl || !targetUrl.includes(".connect.trimble.com")) {
    return new Response(
      JSON.stringify({ error: "Invalid or missing url — must target *.connect.trimble.com" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  const auth = request.headers.get("Authorization");
  if (!auth) {
    return new Response(
      JSON.stringify({ error: "Missing Authorization header" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: { Authorization: auth, Accept: "application/json" },
    });

    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        "Content-Type": resp.headers.get("Content-Type") || "application/json",
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Proxy fetch failed", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
}
