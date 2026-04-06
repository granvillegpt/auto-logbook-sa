const ADMIN_KEY = "your-secret-key";
const LOGBOOK_FUNCTIONS_BASE = "http://127.0.0.1:5007/autologbook-sa/us-central1";
console.log("🔥 UPLOAD ENDPOINT:", LOGBOOK_FUNCTIONS_BASE + "/api/admin/upload-stores");

function adminHeadersJson() {
  return {
    "Content-Type": "application/json",
    "x-admin-key": ADMIN_KEY
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseOptionalLatLng(raw) {
  function firstFiniteNumber(keys) {
    for (let i = 0; i < keys.length; i++) {
      var v = raw[keys[i]];
      if (v == null || v === "") continue;
      var n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return NaN;
  }
  var lat = firstFiniteNumber(["Lat", "lat"]);
  var lng = firstFiniteNumber(["Lng", "lng"]);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat: lat, lng: lng };
  }
  return null;
}

async function refreshPreview() {
  const previewBody = document.getElementById("previewTableBody");
  const previewStatus = document.getElementById("previewStatus");

  previewStatus.textContent = "Refreshing preview...";

  try {
    const res = await fetch("/api/admin/get-stores", {
      headers: adminHeadersJson()
    });

    const data = await res.json();
    const stores = data.stores;

    if (!Array.isArray(stores)) {
      previewStatus.textContent = "Preview failed";
      return;
    }

    previewBody.innerHTML = "";

    const recent = stores
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 15);

    recent.forEach(function (s) {
      var latDisp = s.lat != null && s.lat !== "" && Number.isFinite(Number(s.lat)) ? Number(s.lat) : "";
      var lngDisp = s.lng != null && s.lng !== "" && Number.isFinite(Number(s.lng)) ? Number(s.lng) : "";
      previewBody.innerHTML += `
        <tr>
          <td>${s.customer || ""}</td>
          <td>${s.address || ""}</td>
          <td>${s.city || ""}</td>
          <td>${latDisp}</td>
          <td>${lngDisp}</td>
        </tr>
      `;
    });

    previewStatus.textContent = `Showing ${recent.length} latest stores`;

  } catch (e) {
    console.error(e);
    previewStatus.textContent = "Preview error";
  }
}

async function fetchUploadStoresJson(url, options, logTag) {
  const res = await fetch(url, options);
  const text = await res.text();
  console.log(logTag + " raw (" + res.status + ") first 2000 chars:", text.slice(0, 2000));
  var data = null;
  try {
    data = text.length ? JSON.parse(text) : null;
  } catch (parseErr) {
    console.error(logTag + " JSON.parse failed:", parseErr);
    data = {
      success: false,
      error: "Response was not JSON",
      _rawPreview: text.slice(0, 500)
    };
  }
  return { res: res, data: data };
}

document.getElementById("autoFillBtn").addEventListener("click", async function () {
  const address = document.getElementById("manualAddress").value.trim();
  const suburb = document.getElementById("manualSuburb").value.trim();
  const city = document.getElementById("manualCity").value.trim();
  const province = document.getElementById("manualProvince").value.trim();
  const manualStatus = document.getElementById("manualStatus");

  manualStatus.textContent = "";

  if (!address) {
    alert("Enter address first");
    return;
  }

  const fullAddress = [address, suburb, city, province, "South Africa"]
    .filter(Boolean)
    .join(", ");

  try {
    manualStatus.textContent = "Getting coordinates...";

    const res = await fetch("/api/geocode-nominatim", {
      method: "POST",
      headers: adminHeadersJson(),
      body: JSON.stringify({ address: fullAddress })
    });

    const data = await res.json().catch(function () {
      return null;
    });

    if (!res.ok || !data || data.lat == null || data.lng == null) {
      manualStatus.textContent = "Could not get coordinates";
      return;
    }

    document.getElementById("manualLat").value = String(data.lat);
    document.getElementById("manualLng").value = String(data.lng);

    manualStatus.textContent = "Coordinates filled automatically";
  } catch (e) {
    console.error(e);
    manualStatus.textContent = String(e && e.message ? e.message : e);
  }
});

document.getElementById("saveManualBtn").addEventListener("click", async function () {
  const manualStatus = document.getElementById("manualStatus");
  const latStr = document.getElementById("manualLat").value.trim();
  const lngStr = document.getElementById("manualLng").value.trim();
  const row = {
    Customer: document.getElementById("manualCustomer").value.trim(),
    Address: document.getElementById("manualAddress").value.trim(),
    Suburb: document.getElementById("manualSuburb").value.trim(),
    Province: document.getElementById("manualProvince").value.trim(),
    City: document.getElementById("manualCity").value.trim()
  };
  if (!row.Customer || !row.Address) {
    alert("Store name and address are required (use Auto Fill or enter address manually).");
    return;
  }
  if (latStr === "" || lngStr === "") {
    alert("Click Auto Fill to generate latitude and longitude first.");
    return;
  }

  const latN = Number(latStr);
  const lngN = Number(lngStr);

  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    alert("Invalid coordinates.");
    return;
  }

  row.lat = latN;
  row.lng = lngN;
  try {
    const up = await fetchUploadStoresJson(
      LOGBOOK_FUNCTIONS_BASE + "/api/admin/upload-stores",
      {
        method: "POST",
        headers: adminHeadersJson(),
        body: JSON.stringify({ rows: [row] })
      },
      "[upload-stores manual]"
    );
    manualStatus.textContent = JSON.stringify(up.data, null, 2);
    if (up.res.ok) {
      alert("Save complete");
    } else {
      alert("Save failed: " + ((up.data && up.data.error) || up.res.status));
    }
  } catch (e) {
    console.error(e);
    manualStatus.textContent = String(e && e.message ? e.message : e);
    alert(manualStatus.textContent);
  }
});

document.getElementById("uploadBtn").addEventListener("click", async function () {
  const file = document.getElementById("fileInput").files[0];
  const status = document.getElementById("status");
  if (!file) {
    alert("Select a file");
    return;
  }
  status.textContent = "Reading…";
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const requiredColumns = ["Customer"];

    if (!rows.length) {
      throw new Error("Excel file is empty or could not be read");
    }

    const firstRow = rows[0];
    const missingColumns = requiredColumns.filter(col => !(col in firstRow));

    if (missingColumns.length > 0) {
      throw new Error("Missing required columns: " + missingColumns.join(", "));
    }

    const cleanedRows = rows.map(function (r) {
      var row = {
        Customer: String(r["Customer"] || "").trim(),
        Address: String(r["Address"] || "").trim(),
        Suburb: String(r["Suburb"] || "").trim(),
        Province: String(r["Province"] || "").trim(),
        City: String(r["City"] || "").trim()
      };
      var ll = parseOptionalLatLng(r);
      if (ll) {
        row.lat = ll.lat;
        row.lng = ll.lng;
      }
      return row;
    });

    const batchSize = 5;
    const batches = [];

    for (let i = 0; i < cleanedRows.length; i += batchSize) {
      batches.push(cleanedRows.slice(i, i + batchSize));
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      status.textContent = `Batch ${i + 1} of ${batches.length} (slow mode)...`;

      const res = await fetch(LOGBOOK_FUNCTIONS_BASE + "/api/admin/upload-stores", {
        method: "POST",
        headers: adminHeadersJson(),
        body: JSON.stringify({ rows: batch })
      });

      const text = await res.text();
      console.log(`Batch ${i + 1}:`, text);

      if (!res.ok) {
        throw new Error(`Batch ${i + 1} failed`);
      }

      await refreshPreview();

      if (i < batches.length - 1) {
        status.textContent = `Batch ${i + 1} complete. Waiting before next batch...`;
        await sleep(12000);
      }
    }

    status.textContent = "All batches completed successfully";
    alert("Upload complete");
  } catch (e) {
    console.error(e);
    status.textContent = String(e && e.message ? e.message : e);
    alert("Error: " + status.textContent);
  }
});

let STORES_CACHE = [];
let FILTERED_STORES = [];

function renderStoresTable(data) {
  const tbody = document.getElementById("storesTableBody");
  tbody.innerHTML = "";

  data.forEach(function (s) {
    var payload = {
      customer: s.customer || "",
      address: s.address || "",
      suburb: s.suburb || "",
      city: s.city || "",
      province: s.province || ""
    };

    var json = "";
    try {
      json = encodeURIComponent(JSON.stringify(payload));
    } catch (_e) {
      json = "";
    }

    var actionHtml = s.needsAdminReview === true
      ? '<button type="button" class="fix-store-btn" data-store="' + json + '">Fix</button>'
      : '<span style="color: green;">OK</span>';

    tbody.innerHTML += `
      <tr>
        <td>${s.customer || ""}</td>
        <td>${s.address || ""}</td>
        <td>${s.city || ""}</td>
        <td>${s.lat ?? ""}</td>
        <td>${s.lng ?? ""}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  });
}

document.getElementById("loadStoresBtn").addEventListener("click", async function () {
  const tbody = document.getElementById("storesTableBody");
  const storeCount = document.getElementById("storeCount");

  tbody.innerHTML = "<tr><td colspan='6'>Loading...</td></tr>";

  try {
    const res = await fetch("/api/admin/get-stores", {
      headers: adminHeadersJson()
    });

    const data = await res.json();
    const stores = data.stores;

    if (!Array.isArray(stores)) {
      tbody.innerHTML = "<tr><td colspan='6'>Error loading stores</td></tr>";
      return;
    }

    STORES_CACHE = stores;
    FILTERED_STORES = stores;

    storeCount.textContent = "Total stores: " + stores.length;

    renderStoresTable(FILTERED_STORES);

  } catch (e) {
    console.error(e);
    tbody.innerHTML = "<tr><td colspan='6'>Error loading stores</td></tr>";
  }
});

document.addEventListener("click", function (e) {
  var target = e.target;
  if (!target || !target.classList || !target.classList.contains("fix-store-btn")) return;
  var raw = target.getAttribute("data-store") || "%7B%7D";
  var data;
  try {
    data = JSON.parse(decodeURIComponent(raw));
  } catch (_e) {
    data = {};
  }

  var nameEl = document.getElementById("manualCustomer");
  var addrEl = document.getElementById("manualAddress");
  var subEl = document.getElementById("manualSuburb");
  var cityEl = document.getElementById("manualCity");
  var provEl = document.getElementById("manualProvince");

  if (nameEl) nameEl.value = data.customer || "";
  if (addrEl) addrEl.value = data.address || "";
  if (subEl) subEl.value = data.suburb || "";
  if (cityEl) cityEl.value = data.city || "";
  if (provEl) provEl.value = data.province || "";

  if (nameEl && typeof nameEl.scrollIntoView === "function") {
    nameEl.scrollIntoView({ behavior: "smooth" });
  }
});

document.getElementById("storeFilterInput").addEventListener("input", function (e) {
  const term = (e.target.value || "").toLowerCase();

  FILTERED_STORES = STORES_CACHE.filter(function (s) {
    return (
      (s.customer || "").toLowerCase().includes(term) ||
      (s.address || "").toLowerCase().includes(term) ||
      (s.city || "").toLowerCase().includes(term)
    );
  });

  renderStoresTable(FILTERED_STORES);
});

document.getElementById("downloadStoresBtn").addEventListener("click", function () {
  if (!STORES_CACHE.length) {
    alert("Load stores first");
    return;
  }

  const headers = ["Customer", "Address", "City", "Lat", "Lng"];

  const source = FILTERED_STORES.length ? FILTERED_STORES : STORES_CACHE;

  const rows = source.map(function (s) {
    return [
      s.customer || "",
      s.address || "",
      s.city || "",
      s.lat ?? "",
      s.lng ?? ""
    ];
  });

  const csv = [
    headers.join(","),
    ...rows.map(function (r) {
      return r.map(function (v) {
        return `"${v}"`;
      }).join(",");
    })
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "stores.csv";
  a.click();

  URL.revokeObjectURL(url);
});

function csvEscapeCell(v) {
  var s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

document.getElementById("downloadUnresolvedBtn").addEventListener("click", async function () {
  try {
    var res = await fetch("/api/admin/missing-coords", {
      headers: { "x-admin-key": ADMIN_KEY }
    });
    if (!res.ok) {
      alert("Failed to load unresolved stores: " + res.status);
      return;
    }
    var data = await res.json();
    if (!Array.isArray(data)) {
      alert("Unexpected response from server");
      return;
    }
    var headerLine = "Customer,Address,City,Lat,Lng";
    var lines = data.map(function (doc) {
      return [
        csvEscapeCell(doc.customer != null ? doc.customer : ""),
        csvEscapeCell(doc.address != null ? doc.address : ""),
        csvEscapeCell(doc.city != null ? doc.city : ""),
        csvEscapeCell(doc.lat != null ? doc.lat : ""),
        csvEscapeCell(doc.lng != null ? doc.lng : "")
      ].join(",");
    });
    var csv = [headerLine].concat(lines).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "unresolved-stores.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert(String(e && e.message ? e.message : e));
  }
});

document.getElementById("bulkRenameBtn").addEventListener("click", async function () {
  const find = (document.getElementById("bulkFind").value || "").toLowerCase();
  const replace = document.getElementById("bulkReplace").value || "";
  const reResolve = document.getElementById("bulkReresolveToggle").checked;

  if (!find || !replace) {
    alert("Enter both find and replace");
    return;
  }

  const matches = FILTERED_STORES.filter(function (s) {
    return (s.customer || "").toLowerCase().includes(find);
  });

  if (!matches.length) {
    alert("No matching stores found");
    return;
  }

  for (let i = 0; i < matches.length; i++) {
    const s = matches[i];

    let updated;

    if (reResolve) {
      updated = {
        Customer: (s.customer || "").replace(new RegExp(find, "i"), replace),
        Address: "",
        Suburb: "",
        Province: "",
        City: ""
      };
    } else {
      updated = {
        Customer: (s.customer || "").replace(new RegExp(find, "i"), replace),
        Address: s.address || "",
        Suburb: s.suburb || "",
        Province: s.province || "",
        City: s.city || "",
        lat: s.lat,
        lng: s.lng
      };
    }

    await fetch(LOGBOOK_FUNCTIONS_BASE + "/api/admin/upload-stores", {
      method: "POST",
      headers: adminHeadersJson(),
      body: JSON.stringify({ rows: [updated] })
    });
  }

  alert("Bulk rename complete");

  document.getElementById("loadStoresBtn").click();
});
