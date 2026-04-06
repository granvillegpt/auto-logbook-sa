const { resolveStoreAddresses } = require("../resolveStore");
const { getGoogleApiKey } = require("../googleApiKey");

async function generateRoutelist(data) {
  const routes = data && Array.isArray(data.routes) ? data.routes : [];
  console.log("[AUDIT CF INPUT]", JSON.stringify(routes.slice(0, 3), null, 2));
  console.log("[AUDIT CF ENV KEYS]", {
    hasGoogleKey: !!getGoogleApiKey()
  });

  const enriched = await resolveStoreAddresses(routes);
  console.log("[AUDIT CF OUTPUT]", JSON.stringify(enriched.slice(0, 3), null, 2));
  return enriched;
}

module.exports = { generateRoutelist };
