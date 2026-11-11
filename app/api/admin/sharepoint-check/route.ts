import { getVercelOidcToken } from "@vercel/oidc";
import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const graph = "https://graph.microsoft.com/v1.0";
const audience = "api://AzureADTokenExchange";

export const GET = withStaffAccess(async () => {
  let step = "Vercel OIDC";
  try {
    const { AZURE_TENANT_ID: tenant, AZURE_CLIENT_ID: client } = process.env;
    if (!tenant || !client) throw new Error("Missing app configuration");
    const assertion = await getVercelOidcToken({ audience });
    step = "Entra token exchange";
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      body: new URLSearchParams({
        client_id: client,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: assertion,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || typeof token.access_token !== "string") {
      return NextResponse.json({ ok: false, step, upstreamStatus: tokenResponse.status,
        entraCodes: Array.isArray(token.error_codes) ? token.error_codes.filter(Number.isInteger) : [] }, { status: 502 });
    }
    const read = async (url: string) => {
      if (!url.startsWith(graph + "/")) throw new Error("Unexpected Graph URL");
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Graph HTTP ${response.status}`);
      return response;
    };
    step = "Resolve SharePoint root site";
    const site = await (await read(`${graph}/sites/scmllcnet.sharepoint.com:/?$select=id`)).json();
    step = "List Sav Cotton Bols";
    const drive = `${graph}/sites/${encodeURIComponent(site.id)}/drive`;
    let page = `${drive}/root:/Sav%20Cotton%20Bols:/children?$select=id,name,file`;
    let pdf: { id: string } | undefined;
    while (page && !pdf) {
      const listing = await (await read(page)).json();
      pdf = listing.value.find((item: { file?: object; name: string }) =>
        item.file && item.name.toLowerCase().endsWith(".pdf"));
      page = listing["@odata.nextLink"];
    }
    if (!pdf) return NextResponse.json({ ok: false, step, reason: "No PDF found" }, { status: 404 });
    step = "Download and verify PDF";
    const bytes = Buffer.from(await (await read(`${drive}/items/${encodeURIComponent(pdf.id)}/content`)).arrayBuffer());
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("Invalid PDF");
    return NextResponse.json({ ok: true, folder: "Sav Cotton Bols", bytesVerified: bytes.length });
  } catch (error) {
    const upstreamStatus = error instanceof Error && /^Graph HTTP (\d{3})$/.exec(error.message);
    return NextResponse.json({ ok: false, step, ...(upstreamStatus && { upstreamStatus: Number(upstreamStatus[1]) }) }, { status: 502 });
  }
});
