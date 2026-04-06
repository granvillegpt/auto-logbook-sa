/**
 * Legacy endpoint: PayFast ITN for ads is handled only by payfastNotify (functions/index.js).
 * This handler does not activate ads or logbooks.
 */
const crypto = require("crypto");

function generateSignature(data, passphrase = "") {
  const sorted = Object.keys(data)
    .filter((key) => key !== "signature")
    .sort()
    .map(
      (key) =>
        `${key}=${encodeURIComponent(String(data[key] ?? "")).replace(/%20/g, "+")}`
    )
    .join("&");

  const string = passphrase
    ? `${sorted}&passphrase=${encodeURIComponent(passphrase)}`
    : sorted;

  return crypto.createHash("md5").update(string).digest("hex");
}

exports.handlePaymentWebhook = async (req, res) => {
  console.log("FUNCTION TRIGGERED: handlePaymentWebhook");
  try {
    const data = req.body;

    if (!data || typeof data !== "object") {
      return res.status(400).send("Invalid payload");
    }

    const contentType = (req.get("content-type") || "").toLowerCase();
    const looksJsonAdmin =
      contentType.includes("application/json") &&
      data.custom_str1 &&
      !Object.prototype.hasOwnProperty.call(data, "payment_status");

    if (looksJsonAdmin) {
      return res.status(403).send("Ad activation uses PayFast ITN (payfastNotify) only");
    }

    if (data.payment_status !== "COMPLETE") {
      return res.status(400).send("Payment not complete");
    }

    const passphrase = process.env.PAYFAST_PASSPHRASE || "";
    const generated = generateSignature(data, passphrase);
    const received = data.signature;

    if (
      !received ||
      String(generated).toLowerCase() !== String(received).toLowerCase()
    ) {
      return res.status(400).send("Invalid signature");
    }

    const productType = String(data.custom_str2 || "").trim().toLowerCase();
    if (productType === "ad") {
      console.warn("handlePaymentWebhook: ignored ad ITN; use payfastNotify");
      return res.status(200).send("OK");
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .send(err && err.message ? err.message : "Webhook failed");
  }
};
