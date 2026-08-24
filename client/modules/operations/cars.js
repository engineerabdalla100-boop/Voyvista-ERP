/**
 * cars.js — client/modules/operations/ (السيارات وحركاتها)
 * -----------------------------------------------------------------------
 * Two related stores:
 *   vv_cars           — [{ id, type, driverName, createdAt }]
 *   vv_car_movements  — [{ id, carId, from, to, date, net, selling,
 *                          profit, createdAt }]
 *     profit is ALWAYS derived (selling - net), computed live in the
 *     form and recomputed again at save time — never trusted from a
 *     stale input value, so it can never drift from the two numbers it
 *     actually depends on.
 *
 * Deleting a car with existing movement history is blocked — matches
 * the same "no deleting anything with real history" principle used
 * throughout the rest of this project, applied here even though this
 * file has no relationship to the Accounting module's financial
 * mutation machinery (this is operational tracking, not a ledger).
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  function readCars() {
    try {
      const raw = localStorage.getItem("vv_cars");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("cars.js: vv_cars was corrupted — starting from an empty list instead of crashing.", e);
      return [];
    }
  }
  function writeCars(rows) {
    try { localStorage.setItem("vv_cars", JSON.stringify(rows)); return true; }
    catch (e) { console.error("cars.js: failed to write vv_cars.", e); alert("تعذّر الحفظ — مساحة التخزين ممتلئة على الأرجح."); return false; }
  }

  function readMovements() {
    try {
      const raw = localStorage.getItem("vv_car_movements");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("cars.js: vv_car_movements was corrupted — starting from an empty list instead of crashing.", e);
      return [];
    }
  }
  function writeMovements(rows) {
    try { localStorage.setItem("vv_car_movements", JSON.stringify(rows)); return true; }
    catch (e) { console.error("cars.js: failed to write vv_car_movements.", e); alert("تعذّر الحفظ — مساحة التخزين ممتلئة على الأرجح."); return false; }
  }

  function generateId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function fmtMoney(n) { return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // =========================================================================
  // Car add/edit
  // =========================================================================

  function openAddCarModal() {
    document.getElementById("car-editing-id").value = "";
    document.getElementById("car-modal-title").textContent = "إضافة عربية جديدة";
    document.getElementById("car-type").value = "";
    document.getElementById("car-driver").value = "";
    document.getElementById("modal-car-form").classList.add("is-open");
  }

  function openEditCarModal(id) {
    const car = readCars().find((c) => c.id === id);
    if (!car) { alert("العربية لم تعد موجودة."); return; }
    document.getElementById("car-editing-id").value = car.id;
    document.getElementById("car-modal-title").textContent = `تعديل: ${car.type}`;
    document.getElementById("car-type").value = car.type;
    document.getElementById("car-driver").value = car.driverName;
    document.getElementById("modal-car-form").classList.add("is-open");
  }

  function saveCar() {
    const type = document.getElementById("car-type").value.trim();
    const driverName = document.getElementById("car-driver").value.trim();
    const editingId = document.getElementById("car-editing-id").value;

    if (!type) { alert("نوع العربية مطلوب."); return; }
    if (!driverName) { alert("اسم السواق مطلوب."); return; }

    const rows = readCars();
    if (editingId) {
      const idx = rows.findIndex((c) => c.id === editingId);
      if (idx === -1) { alert("العربية لم تعد موجودة."); return; }
      rows[idx] = { ...rows[idx], type, driverName };
    } else {
      rows.push({ id: generateId("car"), type, driverName, createdAt: todayISO() });
    }

    if (writeCars(rows)) {
      document.getElementById("modal-car-form").classList.remove("is-open");
      renderCarsTable();
    }
  }

  function deleteCar(id) {
    const cars = readCars();
    const car = cars.find((c) => c.id === id);
    if (!car) { alert("العربية لم تعد موجودة."); return; }

    const hasMovements = readMovements().some((m) => m.carId === id);
    if (hasMovements) { alert(`لا يمكن حذف "${car.type}" — يوجد حركات مسجّلة على هذه العربية. سجل الحركات جزء من التاريخ المحاسبي ولازم يفضل محفوظًا.`); return; }

    if (!confirm(`حذف "${car.type}" نهائيًا؟`)) return;
    writeCars(cars.filter((c) => c.id !== id));
    renderCarsTable();
  }

  // =========================================================================
  // Movements
  // =========================================================================

  function recalcProfitPreview() {
    const net = Number(document.getElementById("mv-net").value) || 0;
    const selling = Number(document.getElementById("mv-selling").value) || 0;
    document.getElementById("mv-profit").value = (selling - net).toFixed(2);
  }

  function openMovementsModal(carId) {
    const car = readCars().find((c) => c.id === carId);
    if (!car) { alert("العربية لم تعد موجودة."); return; }

    document.getElementById("movement-car-id").value = carId;
    document.getElementById("movements-modal-title").textContent = `حركات: ${car.type} — ${car.driverName}`;
    document.getElementById("mv-from").value = "";
    document.getElementById("mv-to").value = "";
    document.getElementById("mv-date").value = todayISO();
    document.getElementById("mv-net").value = "0";
    document.getElementById("mv-selling").value = "0";
    document.getElementById("mv-profit").value = "0.00";

    renderMovementsTable(carId);
    document.getElementById("modal-car-movements").classList.add("is-open");
  }

  function saveMovement() {
    const carId = document.getElementById("movement-car-id").value;
    const from = document.getElementById("mv-from").value.trim();
    const to = document.getElementById("mv-to").value.trim();
    const date = document.getElementById("mv-date").value;
    const net = Number(document.getElementById("mv-net").value);
    const selling = Number(document.getElementById("mv-selling").value);

    if (!from) { alert("نقطة الانطلاق (من) مطلوبة."); return; }
    if (!to) { alert("الوجهة (إلى) مطلوبة."); return; }
    if (!date) { alert("التاريخ مطلوب."); return; }
    if (!Number.isFinite(net) || net < 0) { alert("قيمة Net غير صالحة."); return; }
    if (!Number.isFinite(selling) || selling < 0) { alert("قيمة Selling غير صالحة."); return; }

    const profit = Math.round((selling - net) * 100) / 100; // always recomputed here, never trusted from the readonly field

    const rows = readMovements();
    rows.push({ id: generateId("mv"), carId, from, to, date, net, selling, profit, createdAt: todayISO() });

    if (writeMovements(rows)) {
      document.getElementById("mv-from").value = "";
      document.getElementById("mv-to").value = "";
      document.getElementById("mv-net").value = "0";
      document.getElementById("mv-selling").value = "0";
      document.getElementById("mv-profit").value = "0.00";
      renderMovementsTable(carId);
      renderCarsTable(); // totals column on the main table needs refreshing too
    }
  }

  function deleteMovement(id) {
    const rows = readMovements();
    const mv = rows.find((m) => m.id === id);
    if (!mv) return;
    if (!confirm(`حذف حركة "${mv.from} ← ${mv.to}" نهائيًا؟`)) return;
    writeMovements(rows.filter((m) => m.id !== id));
    renderMovementsTable(mv.carId);
    renderCarsTable();
  }

  function renderMovementsTable(carId) {
    const rows = readMovements().filter((m) => m.carId === carId).sort((a, b) => (b.id > a.id ? 1 : -1));
    const tbody = document.getElementById("movements-table-body");
    const empty = document.getElementById("movements-empty-state");

    if (rows.length === 0) { tbody.innerHTML = ""; empty.style.display = "block"; return; }
    empty.style.display = "none";

    tbody.innerHTML = rows.map((m) => `
      <tr>
        <td>${m.date}</td>
        <td>${m.from}</td>
        <td>${m.to}</td>
        <td class="num">${fmtMoney(m.net)}</td>
        <td class="num">${fmtMoney(m.selling)}</td>
        <td class="num ${m.profit >= 0 ? "profit-positive" : "profit-negative"}">${fmtMoney(m.profit)}</td>
        <td><button class="row-action-btn is-danger" data-delete-movement="${m.id}" title="حذف"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button></td>
      </tr>
    `).join("");

    tbody.querySelectorAll("[data-delete-movement]").forEach((b) => b.addEventListener("click", () => deleteMovement(b.dataset.deleteMovement)));
  }

  // =========================================================================
  // Main cars table
  // =========================================================================

  function renderCarsTable() {
    const query = (document.getElementById("cars-search").value || "").trim().toLowerCase();
    let cars = readCars();
    if (query) cars = cars.filter((c) => c.type.toLowerCase().includes(query) || c.driverName.toLowerCase().includes(query));
    cars = [...cars].sort((a, b) => (b.id > a.id ? 1 : -1));

    const allMovements = readMovements();
    const tbody = document.getElementById("cars-table-body");
    const table = document.getElementById("cars-table");
    const empty = document.getElementById("cars-empty-state");

    if (cars.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = cars.map((c) => {
      const movements = allMovements.filter((m) => m.carId === c.id);
      const totalProfit = movements.reduce((sum, m) => sum + m.profit, 0);
      return `
      <tr>
        <td><strong>${c.type}</strong></td>
        <td>${c.driverName}</td>
        <td>${movements.length}</td>
        <td class="num ${totalProfit >= 0 ? "profit-positive" : "profit-negative"}">${fmtMoney(totalProfit)}</td>
        <td>${c.createdAt}</td>
        <td>
          <button class="btn-movement" data-open-movements="${c.id}">حركة السيارة</button>
          <button class="row-action-btn" data-edit-car="${c.id}" title="تعديل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          <button class="row-action-btn is-danger" data-delete-car="${c.id}" title="حذف"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button>
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-open-movements]").forEach((b) => b.addEventListener("click", () => openMovementsModal(b.dataset.openMovements)));
    tbody.querySelectorAll("[data-edit-car]").forEach((b) => b.addEventListener("click", () => openEditCarModal(b.dataset.editCar)));
    tbody.querySelectorAll("[data-delete-car]").forEach((b) => b.addEventListener("click", () => deleteCar(b.dataset.deleteCar)));
  }

  // =========================================================================
  // Export
  // =========================================================================

  function csvEscape(value) {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function downloadCsv(filename, lines) {
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportCarsToCsv() {
    const cars = readCars();
    if (cars.length === 0) { alert("لا توجد عربيات لتصديرها."); return; }
    const allMovements = readMovements();
    const lines = [["نوع العربية", "اسم السواق", "عدد الحركات", "إجمالي الأرباح", "تاريخ الإضافة"].map(csvEscape).join(",")];
    cars.forEach((c) => {
      const movements = allMovements.filter((m) => m.carId === c.id);
      const totalProfit = movements.reduce((sum, m) => sum + m.profit, 0);
      lines.push([c.type, c.driverName, movements.length, totalProfit.toFixed(2), c.createdAt].map(csvEscape).join(","));
    });
    downloadCsv(`Voyvista-Cars-${todayISO()}.csv`, lines);
  }

  function exportMovementsToCsv() {
    const movements = readMovements();
    if (movements.length === 0) { alert("لا توجد حركات لتصديرها."); return; }
    const cars = readCars();
    const carLabel = (id) => { const c = cars.find((x) => x.id === id); return c ? `${c.type} — ${c.driverName}` : "عربية محذوفة"; };
    const lines = [["العربية", "التاريخ", "من", "إلى", "Net", "Selling", "Profit"].map(csvEscape).join(",")];
    [...movements].sort((a, b) => (a.date > b.date ? 1 : -1)).forEach((m) => {
      lines.push([carLabel(m.carId), m.date, m.from, m.to, m.net.toFixed(2), m.selling.toFixed(2), m.profit.toFixed(2)].map(csvEscape).join(","));
    });
    downloadCsv(`Voyvista-CarMovements-${todayISO()}.csv`, lines);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => document.getElementById(btn.dataset.closeModal)?.classList.remove("is-open")));
    document.querySelectorAll(".vv-modal-overlay").forEach((overlay) => overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach((o) => o.classList.remove("is-open")); });

    document.getElementById("btn-open-add-car").addEventListener("click", openAddCarModal);
    document.getElementById("btn-save-car").addEventListener("click", saveCar);
    document.getElementById("cars-search").addEventListener("input", renderCarsTable);
    document.getElementById("btn-export-cars-excel").addEventListener("click", exportCarsToCsv);
    document.getElementById("btn-export-movements-excel").addEventListener("click", exportMovementsToCsv);
    document.getElementById("btn-save-movement").addEventListener("click", saveMovement);
    document.getElementById("mv-net").addEventListener("input", recalcProfitPreview);
    document.getElementById("mv-selling").addEventListener("input", recalcProfitPreview);

    renderCarsTable();
  });
})();