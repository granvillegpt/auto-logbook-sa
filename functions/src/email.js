const sgMail = require("@sendgrid/mail");
const { defineSecret } = require("firebase-functions/params");

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const RAW_EMAIL_TEST_MODE = false;

async function sendGridEmail({ to, templateId, dynamicTemplateData }) {
  sgMail.setApiKey(SENDGRID_API_KEY.value());
  if (RAW_EMAIL_TEST_MODE) {
    console.log("SENDGRID RAW TEST PAYLOAD:", { to });
    const [rawResponse] = await sgMail.send({
      to,
      from: {
        email: "hello@autologbooksa.co.za",
        name: "Auto Logbook SA",
      },
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

  console.log("SENDGRID PAYLOAD:", {
    to,
    templateId,
    dynamicTemplateData,
  });
  try {
    const [response] = await sgMail.send({
      to,
      from: {
        email: "hello@autologbooksa.co.za",
        name: "Auto Logbook SA",
      },
      templateId,
      dynamicTemplateData,
    });
    console.log("SENDGRID RESULT:", {
      statusCode: response?.statusCode,
      headers: response?.headers,
      mode: "template",
    });
  } catch (error) {
    console.error("SENDGRID TEMPLATE ERROR BODY:", error?.response?.body || error);
    throw error;
  }
}

module.exports = { sendGridEmail, SENDGRID_API_KEY };
