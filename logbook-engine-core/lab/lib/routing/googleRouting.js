/**
 * Google Routes API Routing Provider
 * 
 * Simple address-based routing with South Africa bias.
 * Uses Google Routes API (Routes API v2) to get distances.
 */

class GoogleRouting {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error("GOOGLE_MAPS_API_KEY missing");
    }
    this.apiKey = apiKey;
    this.baseUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  }

  normalizeAddress(address) {
    if (!address) throw new Error("Invalid address");

    const trimmed = address.toString().trim();

    // Ensure South Africa bias
    if (trimmed.toLowerCase().includes("south africa")) {
      return trimmed;
    }

    return `${trimmed}, South Africa`;
  }

  async getDistance(originAddress, destinationAddress) {
    const origin = this.normalizeAddress(originAddress);
    const destination = this.normalizeAddress(destinationAddress);

    // Defensive: same origin/destination should not call API
    if (
      typeof origin === "string" &&
      typeof destination === "string" &&
      origin.trim().toLowerCase() === destination.trim().toLowerCase()
    ) {
      return {
        km: 0,
        minutes: 0,
        source: "google"
      };
    }

    const response = await fetch(
      this.baseUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration"
        },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: destination },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          computeAlternativeRoutes: false,
          regionCode: "ZA",
          units: "METRIC",
          languageCode: "en-US"
        })
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Routes API error: ${text}`);
    }

    const data = await response.json();

    let meters = 0;

    if (
      data &&
      Array.isArray(data.routes) &&
      data.routes.length > 0 &&
      typeof data.routes[0].distanceMeters === "number"
    ) {
      meters = data.routes[0].distanceMeters;
    }

    if (typeof meters !== "number" || isNaN(meters)) {
      console.warn(
        `Routing fallback: invalid distance result for ${origin} → ${destination}`
      );
      return {
        km: 0,
        minutes: 0,
        source: "google"
      };
    }

    const km = meters / 1000;

    // Extract duration if available
    let minutes = 0;
    if (data?.routes?.[0]?.duration) {
      const duration = data.routes[0].duration;
      if (typeof duration === 'string') {
        minutes = parseInt(duration.replace('s', '')) / 60 || 0;
      } else if (typeof duration === 'object' && duration.seconds) {
        minutes = duration.seconds / 60 || 0;
      } else if (typeof duration === 'number') {
        minutes = duration / 60 || 0;
      }
    }

    return {
      km: km,
      minutes: minutes,
      source: "google"
    };
  }

  async getDistances(originAddress, destinationAddresses) {
    if (!destinationAddresses || destinationAddresses.length === 0) {
      return new Map();
    }

    const results = new Map();
    const origin = this.normalizeAddress(originAddress);

    // Routes API processes routes one at a time
    for (const destAddress of destinationAddresses) {
      try {
        const destination = this.normalizeAddress(destAddress);
        const result = await this.getDistance(originAddress, destAddress);
        results.set(destAddress, result);
      } catch (error) {
        console.warn(`Failed to get route for ${destAddress}:`, error.message);
        results.set(destAddress, {
          km: 0,
          minutes: 0,
          source: `error:${error.message}`
        });
      }
    }

    return results;
  }
}

export { GoogleRouting };
