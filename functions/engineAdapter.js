const XLSX = require("xlsx");

// load engine modules
const { runLogbookEngine } = require("./engine/logbookEngine");
const dateRangeModule = require("./engine/dateRange");

// prepare globals expected by the engine
global.XLSX = XLSX;

if (dateRangeModule && dateRangeModule.isWorkDay) {
  global.isWorkDay = dateRangeModule.isWorkDay;
}

async function generateLogbook(input) {
  const body = input && typeof input === "object" ? input : {};
  console.log("🚨 ENTER FUNCTION:", "generateLogbook");
  console.log("🚨 ADAPTER INPUT ROUTES:", JSON.stringify(body.routes, null, 2));
  const adapterRoutesSnapshot = JSON.stringify(body.routes);
  return runLogbookEngine(body, adapterRoutesSnapshot);
}

exports.generateLogbook = async (req, res) => {
  try {
    const input = req.body;
    console.log("🚨 ENTER FUNCTION:", "generateLogbookEndpoint");
    console.log("🚨 ADAPTER INPUT ROUTES:", JSON.stringify(input.routes, null, 2));
    const adapterRoutesSnapshot = JSON.stringify(input.routes);
    const result = await runLogbookEngine(input, adapterRoutesSnapshot);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
};

module.exports = {
  generateLogbook,
  generateLogbookEndpoint: exports.generateLogbook
};
