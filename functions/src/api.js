/**
 * HTTP handlers extracted for /engine routes (resolve-store uses resolveStore.js).
 */
const { resolveStore } = require("./resolveStore");

async function engineResolveStore(req, res) {
  try {
    const routes = req.body.routes || [];

    const results = [];

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];

      const resolved = await resolveStore(route);

      results.push({
        ...route,
        ...resolved,
        _routeId: route._routeId ?? route.id ?? i ?? null
      });
    }

    return res.status(200).json(results);

  } catch (err) {
    console.error("🔥 ENGINE ERROR:", err);
    return res.status(500).json({ error: "resolver_failed" });
  }
}

module.exports = { engineResolveStore };
