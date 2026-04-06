import { parseRouteListExcel } from "../engine-core/parseRouteListExcel.js";
import { runLogbookEngine } from "../engine-core/logbookEngine.js";
import { mockRoutingService } from "../engine-core/mockRouting.js";

const fileInput = document.getElementById("fileInput");
const button = document.getElementById("generateBtn");

let uploadedFile;

fileInput.addEventListener("change", (e) => {
    uploadedFile = e.target.files[0];
});

button.addEventListener("click", async () => {
    if (!uploadedFile) {
        alert("Upload file first");
        return;
    }

    try {
        const arrayBuffer = await uploadedFile.arrayBuffer();
        const routes = await parseRouteListExcel(arrayBuffer);

        console.log("Parsed Routes:", routes);

        const startDate = "2025-03-01";
        const endDate = "2026-02-28";
        const logbook = await runLogbookEngine({
            routes,
            startDate,
            endDate,
            homeAddress: "Home Base, Cape Town, Western Cape, South Africa",
            openingKm: 50000,
            currentWeek: 1,
            routingService: mockRoutingService
        });

        console.log("Generated Logbook:", logbook);
    } catch (err) {
        console.error(err);
        alert(err.message || "Error: " + String(err));
    }
});
