const sgMail = require("@sendgrid/mail");
const { defineSecret } = require("firebase-functions/params");

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const RAW_EMAIL_TEST_MODE = false;

async function sendGridEmail({ to, templateId, dynamicTemplateData, subject, text, html }) {
  sgMail.setApiKey(SENDGRID_API_KEY.value());
  const from = {
    email: "hello@autologbooksa.co.za",
    name: "Auto Logbook SA",
  };
  if (RAW_EMAIL_TEST_MODE) {
    console.log("SENDGRID RAW TEST PAYLOAD:", { to });
    const [rawResponse] = await sgMail.send({
      to,
      from,
      subject: "TEST EMAIL",
      html: "<strong>TEST EMAIL WORKING</strong>",
    });
    console.log("SENDGRID RESULT:", {
      statusCode: rawResponse?.statusCode,
      headers: rawResponse?.headers,
      mode: "raw-test",
    });
    return;
  }

  if (templateId) {
    console.log("SENDGRID PAYLOAD:", {
      to,
      templateId,
      dynamicTemplateData,
    });
    try {
      const [response] = await sgMail.send({
        to,
        from,
        templateId,
        dynamicTemplateData,
      });
      console.log("SENDGRID RESULT:", {
        statusCode: response?.statusCode,
        headers: response?.headers,
        mode: "template",
      });
    } catch (error) {
      console.error("❌ SENDGRID FULL ERROR:", {
        message: error.message,
        code: error.code,
        response: error.response?.body,
        stack: error.stack,
      });
      throw error;
    }
    return;
  }

  if (subject && (text || html)) {
    console.log("SENDGRID PAYLOAD:", { to, subject, mode: "transactional" });
    try {
      const [response] = await sgMail.send({
        to,
        from,
        subject,
        text: text || undefined,
        html: html || undefined,
      });
      console.log("SENDGRID RESULT:", {
        statusCode: response?.statusCode,
        headers: response?.headers,
        mode: "transactional",
      });
    } catch (error) {
      console.error("SENDGRID TRANSACTIONAL ERROR BODY:", error?.response?.body || error);
      throw error;
    }
    return;
  }

  throw new Error("sendGridEmail: provide templateId or subject with text/html");
}

module.exports = { sendGridEmail, SENDGRID_API_KEY };
