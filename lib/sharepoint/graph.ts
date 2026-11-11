import { getVercelOidcToken } from "@vercel/oidc";

export class GraphTokenError extends Error {
  constructor(public status: number, public codes: number[]) {
    super("Entra token exchange failed");
  }
}

export async function connectSharePoint(onExchange = () => {}) {
  const graph = "https://graph.microsoft.com/v1.0";
  const audience = "api://AzureADTokenExchange";

  const { AZURE_TENANT_ID: tenant, AZURE_CLIENT_ID: client } = process.env;
  if (!tenant || !client) throw new Error("Missing app configuration");
  const assertion = await getVercelOidcToken({ audience });
  onExchange();
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
    throw new GraphTokenError(tokenResponse.status, Array.isArray(token.error_codes) ? token.error_codes.filter(Number.isInteger) : []);
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
  const getDrive = async () => {
    const site = await (await read(`${graph}/sites/scmllcnet.sharepoint.com:/?$select=id`)).json();
    return `${graph}/sites/${encodeURIComponent(site.id)}/drive`;
  };
  return { read, getDrive };
}
