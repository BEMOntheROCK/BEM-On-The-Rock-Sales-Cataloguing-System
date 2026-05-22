import { db } from './firebase.js';
import {
    collection, getDocs, deleteDoc, doc, query, orderBy, where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- THEME TOGGLE ---
const themeToggleBtn = document.getElementById('theme-toggle');
const rootElement = document.documentElement;
let isDarkMode = localStorage.getItem('theme') === 'dark';

function updateTheme() {
    if (isDarkMode) {
        rootElement.setAttribute('data-theme', 'dark');
        themeToggleBtn.innerText = '☀️ Light Mode';
        localStorage.setItem('theme', 'dark');
    } else {
        rootElement.removeAttribute('data-theme');
        themeToggleBtn.innerText = '🌙 Dark Mode';
        localStorage.setItem('theme', 'light');
    }
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
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

// --- STATE ---
let allSales = []; // All sales fetched from Firestore (after cleanup)
let activePeriod = 'today';

// --- DATE HELPERS ---
function startOf(period) {
    const now = new Date();
    if (period === 'today') {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (period === 'week') {
        const day = now.getDay(); // 0=Sun
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
        return new Date(now.getFullYear(), now.getMonth(), diff);
    }
    if (period === 'month') {
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
}

function formatDateTime(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('en-MY', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    });
}

function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
}

// --- 90-DAY CLEANUP ---
async function cleanupOldRecords() {
    const cleanupBanner = document.getElementById('cleanup-banner');
    const cleanupMessage = document.getElementById('cleanup-message');

    cleanupBanner.classList.remove('hidden');
    cleanupMessage.textContent = '🔍 Checking for old records...';

    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffTimestamp = Timestamp.fromDate(cutoff);

        const oldQuery = query(
            collection(db, 'sales'),
            where('timestamp', '<', cutoffTimestamp)
        );
        const snapshot = await getDocs(oldQuery);

        if (snapshot.empty) {
            cleanupMessage.textContent = '✅ All records are up to date. No old data to remove.';
        } else {
            // Delete all records older than 90 days
            const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'sales', d.id)));
            await Promise.all(deletePromises);
            cleanupMessage.textContent = `🗑️ ${snapshot.size} record(s) older than 90 days were automatically removed.`;
        }

        // Fade out the banner after 5 seconds
        setTimeout(() => {
            cleanupBanner.style.transition = 'opacity 0.5s';
            cleanupBanner.style.opacity = '0';
            setTimeout(() => cleanupBanner.classList.add('hidden'), 500);
        }, 5000);

    } catch (err) {
        console.error('Cleanup failed:', err);
        cleanupMessage.textContent = '⚠️ Could not check for old records. Please try again later.';
    }
}

// --- FETCH ALL SALES ---
async function loadSales() {
    try {
        const q = query(collection(db, 'sales'), orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);
        allSales = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        updateSummary();
        applyFilters();
    } catch (err) {
        console.error('Failed to load sales:', err);
        document.getElementById('sales-body').innerHTML =
            '<tr><td colspan="6" class="table-empty">Error loading sales records.</td></tr>';
        showToast('❌ Failed to load sales data.', 'error');
    }
}

// --- SUMMARY CARDS ---
function updateSummary() {
    const start = startOf(activePeriod);
    const periodSales = allSales.filter(sale => {
        if (!sale.timestamp) return false;
        const d = sale.timestamp.toDate ? sale.timestamp.toDate() : new Date(sale.timestamp);
        return d >= start;
    });

    const revenue = periodSales.reduce((sum, s) => sum + (s.totalPaid || 0), 0);
    const units = periodSales.reduce((sum, s) => sum + (s.quantity || 0), 0);

    document.getElementById('stat-revenue').textContent = `RM ${revenue.toFixed(2)}`;
    document.getElementById('stat-transactions').textContent = periodSales.length;
    document.getElementById('stat-units').textContent = units;

    // Payment method breakdown
    const methodTotals = {};
    periodSales.forEach(s => {
        const m = s.paymentMethod || 'Unknown';
        methodTotals[m] = (methodTotals[m] || 0) + (s.totalPaid || 0);
    });

    // Top payment method
    const topMethod = Object.entries(methodTotals).sort((a, b) => b[1] - a[1])[0];
    document.getElementById('stat-top-payment').textContent = topMethod ? topMethod[0] : '—';

    // Payment breakdown pills
    const breakdown = document.getElementById('payment-breakdown');
    breakdown.innerHTML = '';
    Object.entries(methodTotals)
        .sort((a, b) => b[1] - a[1])
        .forEach(([method, total]) => {
            const pill = document.createElement('div');
            pill.className = 'payment-pill';
            pill.innerHTML = `
                <span class="payment-pill-label">${method}</span>
                <span class="payment-pill-value">RM ${total.toFixed(2)}</span>
            `;
            breakdown.appendChild(pill);
        });

    if (Object.keys(methodTotals).length === 0) {
        breakdown.innerHTML = '<span style="font-size:0.85rem;color:var(--muted-text);">No sales in this period.</span>';
    }
}

// --- PERIOD TOGGLE ---
document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activePeriod = btn.dataset.period;
        updateSummary();
    });
});

// --- FILTERS ---
const filterFrom = document.getElementById('filter-from');
const filterTo = document.getElementById('filter-to');
const filterPayment = document.getElementById('filter-payment');
const filterProduct = document.getElementById('filter-product');
const salesBody = document.getElementById('sales-body');
const resultsCount = document.getElementById('results-count');

// Set default filter range to last 30 days
const today = new Date();
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(today.getDate() - 30);
filterFrom.value = formatDateForInput(thirtyDaysAgo);
filterTo.value = formatDateForInput(today);

function applyFilters() {
    const fromDate = filterFrom.value ? new Date(filterFrom.value) : null;
    // Set to end of the "to" day so we include the full day
    const toDate = filterTo.value ? new Date(filterTo.value + 'T23:59:59') : null;
    const paymentFilter = filterPayment.value;
    const productFilter = filterProduct.value.toLowerCase().trim();

    const filtered = allSales.filter(sale => {
        const saleDate = sale.timestamp
            ? (sale.timestamp.toDate ? sale.timestamp.toDate() : new Date(sale.timestamp))
            : null;

        if (fromDate && saleDate && saleDate < fromDate) return false;
        if (toDate && saleDate && saleDate > toDate) return false;
        if (paymentFilter && sale.paymentMethod !== paymentFilter) return false;
        if (productFilter && !sale.productName?.toLowerCase().includes(productFilter)) return false;

        return true;
    });

    renderTable(filtered);
    resultsCount.textContent = `Showing ${filtered.length} of ${allSales.length} record(s)`;
}

function renderTable(sales) {
    if (sales.length === 0) {
        salesBody.innerHTML = '<tr><td colspan="6" class="table-empty">No records match your filters.</td></tr>';
        return;
    }

    salesBody.innerHTML = '';
    sales.forEach(sale => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDateTime(sale.timestamp)}</td>
            <td>${sale.productName || '—'}</td>
            <td>${sale.variationName || '—'}</td>
            <td>${sale.quantity || 0}</td>
            <td><span class="payment-badge">${sale.paymentMethod || '—'}</span></td>
            <td class="total-cell">RM ${(sale.totalPaid || 0).toFixed(2)}</td>
        `;
        salesBody.appendChild(row);
    });
}

// Attach filter listeners
filterFrom.addEventListener('change', applyFilters);
filterTo.addEventListener('change', applyFilters);
filterPayment.addEventListener('change', applyFilters);
filterProduct.addEventListener('input', applyFilters);

document.getElementById('clear-filters-btn').addEventListener('click', () => {
    filterFrom.value = formatDateForInput(thirtyDaysAgo);
    filterTo.value = formatDateForInput(today);
    filterPayment.value = '';
    filterProduct.value = '';
    applyFilters();
});

// --- EXPORT TO EXCEL ---
document.getElementById('export-btn').addEventListener('click', async () => {
    const exportBtn = document.getElementById('export-btn');

    // Get currently filtered rows
    const fromDate = filterFrom.value ? new Date(filterFrom.value) : null;
    const toDate = filterTo.value ? new Date(filterTo.value + 'T23:59:59') : null;
    const paymentFilter = filterPayment.value;
    const productFilter = filterProduct.value.toLowerCase().trim();

    const filtered = allSales.filter(sale => {
        const saleDate = sale.timestamp
            ? (sale.timestamp.toDate ? sale.timestamp.toDate() : new Date(sale.timestamp))
            : null;
        if (fromDate && saleDate && saleDate < fromDate) return false;
        if (toDate && saleDate && saleDate > toDate) return false;
        if (paymentFilter && sale.paymentMethod !== paymentFilter) return false;
        if (productFilter && !sale.productName?.toLowerCase().includes(productFilter)) return false;
        return true;
    });

    if (filtered.length === 0) {
        showToast('No records to export.', 'error');
        return;
    }

    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';

    try {
        // Dynamically load SheetJS from CDN
        const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs');

        const rows = filtered.map(sale => ({
            'Date & Time': formatDateTime(sale.timestamp),
            'Product': sale.productName || '—',
            'Variation': sale.variationName || '—',
            'Qty': sale.quantity || 0,
            'Payment Method': sale.paymentMethod || '—',
            'Total (RM)': (sale.totalPaid || 0).toFixed(2)
        }));

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sales');

        // Auto-size columns
        const colWidths = Object.keys(rows[0]).map(key => ({
            wch: Math.max(key.length, ...rows.map(r => String(r[key]).length)) + 2
        }));
        worksheet['!cols'] = colWidths;

        const fileName = `ROCS_Sales_${formatDateForInput(new Date())}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        showToast(`✅ Exported ${filtered.length} record(s) to ${fileName}`);
    } catch (err) {
        console.error('Export failed:', err);
        showToast('❌ Export failed. Please try again.', 'error');
    } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = '📥 Export to Excel';
    }
});

// --- BOOT ---
async function init() {
    await cleanupOldRecords(); // Clean first, then load what remains
    await loadSales();
}

init();