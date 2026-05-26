import { db } from './firebase.js';
import {
    collection, getDocs, deleteDoc, doc, runTransaction,
    query, orderBy, where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- THEME ---
const themeToggleBtn = document.getElementById('theme-toggle');
const rootElement = document.documentElement;
let isDarkMode = localStorage.getItem('theme') === 'dark';
function updateTheme() {
    if (isDarkMode) { rootElement.setAttribute('data-theme', 'dark'); themeToggleBtn.innerText = '☀️ Light Mode'; localStorage.setItem('theme', 'dark'); }
    else { rootElement.removeAttribute('data-theme'); themeToggleBtn.innerText = '🌙 Dark Mode'; localStorage.setItem('theme', 'light'); }
}
updateTheme();
themeToggleBtn.addEventListener('click', () => { isDarkMode = !isDarkMode; updateTheme(); });

// --- TOAST ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => { toast.classList.remove('toast-visible'); toast.addEventListener('transitionend', () => toast.remove()); }, 3500);
}

// --- STATE ---
let allSales = [];
let activePeriod = 'today';

// --- DATE HELPERS ---
function startOf(period) {
    const now = new Date();
    if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week') {
        const day = now.getDay();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + (day === 0 ? -6 : 1));
    }
    if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
}

function formatDateTime(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateForInput(date) { return date.toISOString().split('T')[0]; }

// --- CLEANUP ---
async function cleanupOldRecords() {
    const cleanupBanner  = document.getElementById('cleanup-banner');
    const cleanupMessage = document.getElementById('cleanup-message');
    cleanupBanner.classList.remove('hidden');
    cleanupMessage.textContent = '🔍 Checking for old records...';
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const oldQuery  = query(collection(db, 'sales'), where('timestamp', '<', Timestamp.fromDate(cutoff)));
        const snapshot  = await getDocs(oldQuery);
        if (snapshot.empty) {
            cleanupMessage.textContent = '✅ All records are up to date. No old data to remove.';
        } else {
            await Promise.all(snapshot.docs.map(d => deleteDoc(doc(db, 'sales', d.id))));
            cleanupMessage.textContent = `🗑️ ${snapshot.size} record(s) older than 90 days were automatically removed.`;
        }
        setTimeout(() => {
            cleanupBanner.style.transition = 'opacity 0.5s';
            cleanupBanner.style.opacity = '0';
            setTimeout(() => cleanupBanner.classList.add('hidden'), 500);
        }, 5000);
    } catch (err) {
        console.error('Cleanup failed:', err);
        cleanupMessage.textContent = '⚠️ Could not check for old records.';
    }
}

// --- LOAD SALES ---
async function loadSales() {
    try {
        const q = query(collection(db, 'sales'), orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);
        allSales = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        updateSummary();
        applyFilters();
    } catch (err) {
        console.error(err);
        document.getElementById('sales-body').innerHTML = '<tr><td colspan="6" class="table-empty">Error loading records.</td></tr>';
        showToast('❌ Failed to load sales data.', 'error');
    }
}

// --- STRUCTURE HELPERS (supports old flat + new items-array records) ---
function getItems(sale) {
    if (sale.items && Array.isArray(sale.items)) return sale.items;
    return [{
        productId:     sale.productId,
        productName:   sale.productName   || '—',
        variationName: sale.variationName || '—',
        varIndex:      sale.varIndex      ?? null,
        quantity:      sale.quantity      || 0,
        unitPrice:     sale.unitPrice     || 0,
        lineTotal:     sale.totalPaid     || 0
    }];
}

function getGrandTotal(sale) {
    return sale.grandTotal !== undefined ? sale.grandTotal : (sale.totalPaid || 0);
}

// --- DELETE TRANSACTION + PARTIAL STOCK REVERT ---
async function handleDeleteTransaction(sale) {
    if (!confirm(`Delete this transaction (${formatDateTime(sale.timestamp)})?\n\nStock will be restored for any items still in the catalogue.`)) return;

    const items = getItems(sale);

    try {
        // 1. Delete the sale record first
        await deleteDoc(doc(db, 'sales', sale.id));

        // 2. Attempt stock revert for each line item individually (partial revert)
        await Promise.allSettled(items.map(async (item) => {
            // Skip if we don't have enough info to identify the catalogue entry
            if (!item.productId || item.varIndex == null) return;

            try {
                const productRef = doc(db, 'catalogue', item.productId);
                await runTransaction(db, async (transaction) => {
                    const productDoc = await transaction.get(productRef);
                    // Product no longer exists — silently skip
                    if (!productDoc.exists()) return;

                    const variations = [...productDoc.data().variations];
                    if (!variations[item.varIndex]) return; // Variation index gone — skip

                    variations[item.varIndex].stock += item.quantity;
                    transaction.update(productRef, { variations });
                });
            } catch {
                // Silently skip any individual item revert failure
            }
        }));

        // 3. Remove from local state and re-render
        allSales = allSales.filter(s => s.id !== sale.id);
        updateSummary();
        applyFilters();
        showToast('🗑️ Transaction deleted and stock reverted where applicable.');

    } catch (err) {
        console.error('Delete failed:', err);
        showToast('❌ Failed to delete transaction. Please try again.', 'error');
    }
}

// --- SUMMARY ---
function updateSummary() {
    const start = startOf(activePeriod);
    const periodSales = allSales.filter(sale => {
        if (!sale.timestamp) return false;
        const d = sale.timestamp.toDate ? sale.timestamp.toDate() : new Date(sale.timestamp);
        return d >= start;
    });

    const revenue = periodSales.reduce((sum, s) => sum + getGrandTotal(s), 0);
    const units   = periodSales.reduce((sum, s) => sum + getItems(s).reduce((a, i) => a + i.quantity, 0), 0);

    document.getElementById('stat-revenue').textContent     = `RM ${revenue.toFixed(2)}`;
    document.getElementById('stat-transactions').textContent = periodSales.length;
    document.getElementById('stat-units').textContent        = units;

    const methodTotals = {};
    periodSales.forEach(s => {
        const m = s.paymentMethod || 'Unknown';
        methodTotals[m] = (methodTotals[m] || 0) + getGrandTotal(s);
    });
    const topMethod = Object.entries(methodTotals).sort((a, b) => b[1] - a[1])[0];
    document.getElementById('stat-top-payment').textContent = topMethod ? topMethod[0] : '—';

    const breakdown = document.getElementById('payment-breakdown');
    breakdown.innerHTML = '';
    Object.entries(methodTotals).sort((a, b) => b[1] - a[1]).forEach(([method, total]) => {
        const pill = document.createElement('div');
        pill.className = 'payment-pill';
        pill.innerHTML = `<span class="payment-pill-label">${method}</span><span class="payment-pill-value">RM ${total.toFixed(2)}</span>`;
        breakdown.appendChild(pill);
    });
    if (!Object.keys(methodTotals).length) {
        breakdown.innerHTML = '<span style="font-size:0.85rem;color:var(--muted-text);">No sales in this period.</span>';
    }
}

document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activePeriod = btn.dataset.period;
        updateSummary();
    });
});

// --- FILTERS ---
const filterFrom    = document.getElementById('filter-from');
const filterTo      = document.getElementById('filter-to');
const filterPayment = document.getElementById('filter-payment');
const filterProduct = document.getElementById('filter-product');
const salesBody     = document.getElementById('sales-body');
const resultsCount  = document.getElementById('results-count');

const today = new Date();
const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(today.getDate() - 30);
filterFrom.value = formatDateForInput(thirtyDaysAgo);
filterTo.value   = formatDateForInput(today);

function applyFilters() {
    const fromDate   = filterFrom.value  ? new Date(filterFrom.value) : null;
    const toDate     = filterTo.value    ? new Date(filterTo.value + 'T23:59:59') : null;
    const payFilter  = filterPayment.value;
    const prodFilter = filterProduct.value.toLowerCase().trim();

    const filtered = allSales.filter(sale => {
        const saleDate = sale.timestamp ? (sale.timestamp.toDate ? sale.timestamp.toDate() : new Date(sale.timestamp)) : null;
        if (fromDate && saleDate && saleDate < fromDate) return false;
        if (toDate   && saleDate && saleDate > toDate)   return false;
        if (payFilter && sale.paymentMethod !== payFilter) return false;
        if (prodFilter) {
            const match = getItems(sale).some(i => i.productName?.toLowerCase().includes(prodFilter));
            if (!match) return false;
        }
        return true;
    });

    renderTable(filtered);
    resultsCount.textContent = `Showing ${filtered.length} of ${allSales.length} transaction(s)`;
}

// --- TABLE RENDER ---
function renderTable(sales) {
    salesBody.innerHTML = '';
    if (!sales.length) {
        salesBody.innerHTML = '<tr><td colspan="6" class="table-empty">No records match your filters.</td></tr>';
        return;
    }

    sales.forEach((sale, idx) => {
        const items      = getItems(sale);
        const grandTotal = getGrandTotal(sale);
        const itemSummary = items.length === 1
            ? `${items[0].productName} — ${items[0].variationName} × ${items[0].quantity}`
            : `${items.length} items`;

        const rowId = `tx-${idx}`;

        // --- Main transaction row ---
        const mainRow = document.createElement('tr');
        mainRow.className = 'tx-row';
        mainRow.innerHTML = `
            <td class="expand-cell no-print">
                <button class="expand-btn" data-target="${rowId}" title="Show items">▶</button>
            </td>
            <td>${formatDateTime(sale.timestamp)}</td>
            <td class="items-summary">${itemSummary}</td>
            <td><span class="payment-badge">${sale.paymentMethod || '—'}</span></td>
            <td class="total-cell">RM ${grandTotal.toFixed(2)}</td>
            <td class="no-print">
                <button class="btn-delete-tx" title="Delete transaction">🗑️ Delete</button>
            </td>
        `;

        // Expand toggle
        mainRow.querySelector('.expand-btn').addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const isExpanded = !detailRow.classList.contains('hidden');
            detailRow.classList.toggle('hidden', isExpanded);
            btn.textContent = isExpanded ? '▶' : '▼';
            btn.classList.toggle('expanded', !isExpanded);
        });

        // Delete button
        mainRow.querySelector('.btn-delete-tx').addEventListener('click', () => handleDeleteTransaction(sale));

        // --- Expandable line items row ---
        const detailRow = document.createElement('tr');
        detailRow.className = 'tx-detail-row hidden';
        detailRow.id = rowId;
        detailRow.innerHTML = `
            <td colspan="6" class="tx-detail-cell">
                <table class="line-items-table">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Variation</th>
                            <th>Qty</th>
                            <th>Unit Price</th>
                            <th>Line Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(i => `
                            <tr>
                                <td>${i.productName || '—'}</td>
                                <td>${i.variationName || '—'}</td>
                                <td>${i.quantity}</td>
                                <td>RM ${(i.unitPrice || 0).toFixed(2)}</td>
                                <td>RM ${(i.lineTotal ?? (i.unitPrice * i.quantity) ?? 0).toFixed(2)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </td>
        `;

        salesBody.appendChild(mainRow);
        salesBody.appendChild(detailRow);
    });
}

filterFrom.addEventListener('change', applyFilters);
filterTo.addEventListener('change', applyFilters);
filterPayment.addEventListener('change', applyFilters);
filterProduct.addEventListener('input', applyFilters);

document.getElementById('clear-filters-btn').addEventListener('click', () => {
    filterFrom.value    = formatDateForInput(thirtyDaysAgo);
    filterTo.value      = formatDateForInput(today);
    filterPayment.value = '';
    filterProduct.value = '';
    applyFilters();
});

// --- EXPORT TO EXCEL ---
document.getElementById('export-btn').addEventListener('click', async () => {
    const exportBtn  = document.getElementById('export-btn');
    const fromDate   = filterFrom.value  ? new Date(filterFrom.value) : null;
    const toDate     = filterTo.value    ? new Date(filterTo.value + 'T23:59:59') : null;
    const payFilter  = filterPayment.value;
    const prodFilter = filterProduct.value.toLowerCase().trim();

    const filtered = allSales.filter(sale => {
        const saleDate = sale.timestamp ? (sale.timestamp.toDate ? sale.timestamp.toDate() : new Date(sale.timestamp)) : null;
        if (fromDate && saleDate && saleDate < fromDate) return false;
        if (toDate   && saleDate && saleDate > toDate)   return false;
        if (payFilter && sale.paymentMethod !== payFilter) return false;
        if (prodFilter && !getItems(sale).some(i => i.productName?.toLowerCase().includes(prodFilter))) return false;
        return true;
    });

    if (!filtered.length) { showToast('No records to export.', 'error'); return; }

    exportBtn.disabled = true; exportBtn.textContent = 'Exporting...';
    try {
        const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs');
        const rows = [];
        filtered.forEach(sale => {
            getItems(sale).forEach((item, idx) => {
                rows.push({
                    'Date & Time':      idx === 0 ? formatDateTime(sale.timestamp) : '',
                    'Payment Method':   idx === 0 ? (sale.paymentMethod || '—') : '',
                    'Grand Total (RM)': idx === 0 ? getGrandTotal(sale).toFixed(2) : '',
                    'Product':          item.productName   || '—',
                    'Variation':        item.variationName || '—',
                    'Qty':              item.quantity,
                    'Unit Price (RM)':  (item.unitPrice || 0).toFixed(2),
                    'Line Total (RM)':  (item.lineTotal ?? (item.unitPrice * item.quantity) ?? 0).toFixed(2)
                });
            });
        });

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook  = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sales');
        const colWidths = Object.keys(rows[0]).map(key => ({ wch: Math.max(key.length, ...rows.map(r => String(r[key]).length)) + 2 }));
        worksheet['!cols'] = colWidths;
        const fileName = `ROCS_Sales_${formatDateForInput(new Date())}.xlsx`;
        XLSX.writeFile(workbook, fileName);
        showToast(`✅ Exported ${filtered.length} transaction(s) to ${fileName}`);
    } catch (err) {
        console.error(err);
        showToast('❌ Export failed. Please try again.', 'error');
    } finally {
        exportBtn.disabled = false; exportBtn.textContent = '📥 Export to Excel';
    }
});

// --- BOOT ---
async function init() {
    await cleanupOldRecords();
    await loadSales();
}
init();