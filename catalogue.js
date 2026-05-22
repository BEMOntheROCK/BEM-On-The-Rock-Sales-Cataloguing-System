import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, doc, deleteDoc, updateDoc, serverTimestamp
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
    setTimeout(() => { toast.classList.remove('toast-visible'); toast.addEventListener('transitionend', () => toast.remove()); }, 3000);
}

// --- IMAGE COMPRESSION ---
function compressImage(file, targetKB) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;
                const MAX_DIM = 1000;
                if (width > MAX_DIM || height > MAX_DIM) {
                    const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
                    width = Math.round(width * ratio); height = Math.round(height * ratio);
                }
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                let lo = 0.1, hi = 0.95, result = '';
                for (let i = 0; i < 10; i++) {
                    const mid = (lo + hi) / 2;
                    result = canvas.toDataURL('image/jpeg', mid);
                    (result.length * 0.75 / 1024 > targetKB) ? hi = mid : lo = mid;
                }
                resolve(result);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function setupImageUpload({ areaId, inputId, placeholderId, previewId, removeBtnId }) {
    const area = document.getElementById(areaId), input = document.getElementById(inputId),
          placeholder = document.getElementById(placeholderId), preview = document.getElementById(previewId),
          removeBtn = document.getElementById(removeBtnId);
    let base64 = null;
    area.addEventListener('click', (e) => { if (e.target !== removeBtn) input.click(); });
    input.addEventListener('change', async () => {
        const file = input.files[0]; if (!file) return;
        if (file.size > 6 * 1024 * 1024) { showToast('Image exceeds 6MB.', 'error'); input.value = ''; return; }
        base64 = await compressImage(file, 600);
        preview.src = base64; preview.classList.remove('hidden');
        placeholder.classList.add('hidden'); removeBtn.classList.remove('hidden');
    });
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); reset(); base64 = false; });
    function reset() { base64 = null; input.value = ''; preview.src = ''; preview.classList.add('hidden'); placeholder.classList.remove('hidden'); removeBtn.classList.add('hidden'); }
    function loadExisting(existing) {
        if (existing) { base64 = existing; preview.src = existing; preview.classList.remove('hidden'); placeholder.classList.add('hidden'); removeBtn.classList.remove('hidden'); }
        else reset();
    }
    return { getBase64: () => base64, reset, loadExisting };
}

const addImage = setupImageUpload({ areaId: 'image-upload-area', inputId: 'product-image', placeholderId: 'image-placeholder', previewId: 'image-preview', removeBtnId: 'remove-image-btn' });

// --- UNIFIED PRICE TOGGLE SETUP ---
// Returns { isUnified(), getUnifiedPrice() }
function setupPriceToggle({ toggleId, unifiedGroupId, unifiedInputId, containerId, headerSuffixId }) {
    const toggle = document.getElementById(toggleId);
    const unifiedGroup = document.getElementById(unifiedGroupId);
    const container = document.getElementById(containerId);

    function apply() {
        const on = toggle.checked;
        // Show/hide the unified price field
        unifiedGroup.classList.toggle('hidden', !on);
        // Show/hide per-variation price column
        container.classList.toggle('hide-var-price', on);
        // Toggle required on per-variation price inputs
        container.querySelectorAll('.var-price').forEach(el => {
            el.required = !on;
        });
        // Update column headers if present
        const header = document.getElementById(headerSuffixId);
        if (header) header.classList.toggle('hidden', on);
    }

    toggle.addEventListener('change', apply);
    apply(); // run once on init

    return {
        isUnified: () => toggle.checked,
        getUnifiedPrice: () => parseFloat(document.getElementById(unifiedInputId)?.value) || 0,
        setToggle: (val) => { toggle.checked = val; apply(); }
    };
}

// --- VARIATION HELPERS ---
function updateDeleteButtons(container) {
    const btns = container.querySelectorAll('.delete-var');
    btns.forEach(btn => btn.disabled = container.children.length === 1);
}

function gatherVariations(container, isUnified, unifiedPrice) {
    const variations = [];
    container.querySelectorAll('.variation-row').forEach(row => {
        const price = isUnified
            ? unifiedPrice
            : (parseFloat(row.querySelector('.var-price')?.value) || 0);
        variations.push({
            name: row.querySelector('.var-name').value.trim(),
            price,
            stock: parseInt(row.querySelector('.var-stock').value) || 0
        });
    });
    return variations;
}

function buildVariationRow(name = '', price = '', stock = '', hidePrice = false) {
    const row = document.createElement('div');
    row.className = 'variation-row';
    row.innerHTML = `
        <input type="text"   class="var-name"  placeholder="e.g., Size S - Black" value="${name}" required>
        <input type="number" class="var-price" step="0.01" placeholder="Price (RM)" min="0" value="${price}" ${hidePrice ? '' : 'required'}>
        <input type="number" class="var-stock" placeholder="Stock" min="0" value="${stock}" required>
        <button type="button" class="btn-icon delete-var">🗑️</button>
    `;
    return row;
}

function resetVariationsContainer(container, hidePrice = false) {
    container.innerHTML = '';
    const row = buildVariationRow('', '', '', hidePrice);
    row.querySelector('.delete-var').disabled = true;
    container.appendChild(row);
    attachVariationDeleteEvent(container, row.querySelector('.delete-var'));
}

function attachVariationDeleteEvent(container, button, stockWarning = false) {
    button.addEventListener('click', () => {
        const row = button.closest('.variation-row');
        if (stockWarning) {
            const stockVal = parseInt(row.querySelector('.var-stock').value) || 0;
            if (stockVal > 0 && !confirm(`This variation still has ${stockVal} unit(s) in stock.\n\nRemoving it will permanently discard those units. Are you sure?`)) return;
        }
        if (container.children.length > 1) row.remove();
        updateDeleteButtons(container);
    });
}

// =====================================================
// ADD FORM
// =====================================================
const variationsContainer = document.getElementById('variations-container');
const addVariationBtn = document.getElementById('add-variation-btn');

const addPriceToggle = setupPriceToggle({
    toggleId: 'unified-price-toggle',
    unifiedGroupId: 'unified-price-group',
    unifiedInputId: 'product-price',
    containerId: 'variations-container',
    headerSuffixId: null
});

// Insert column header row above variations
const addHeader = document.createElement('div');
addHeader.className = 'variation-header';
addHeader.innerHTML = `
    <span class="vh-name">Variation Name</span>
    <span class="vh-price">Price (RM)</span>
    <span class="vh-stock">Stock</span>
    <span class="vh-del"></span>
`;
variationsContainer.parentNode.insertBefore(addHeader, variationsContainer);

// Wire up the initial delete button
attachVariationDeleteEvent(variationsContainer, variationsContainer.querySelector('.delete-var'));

addVariationBtn.addEventListener('click', () => {
    const isUnified = addPriceToggle.isUnified();
    const row = buildVariationRow('', '', '', isUnified);
    variationsContainer.appendChild(row);
    attachVariationDeleteEvent(variationsContainer, row.querySelector('.delete-var'));
    updateDeleteButtons(variationsContainer);
    // Sync required state on new row's price input
    row.querySelector('.var-price').required = !isUnified;
});

const productForm = document.getElementById('product-form');
const saveBtn = productForm.querySelector('.btn-primary');

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('product-name').value.trim();
    const isUnified = addPriceToggle.isUnified();
    const unifiedPrice = addPriceToggle.getUnifiedPrice();

    if (isUnified && (!unifiedPrice || unifiedPrice <= 0)) {
        return showToast('Please enter a valid price.', 'error');
    }

    const variations = gatherVariations(variationsContainer, isUnified, unifiedPrice);

    saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
    try {
        const productData = { name, variations, createdAt: serverTimestamp() };
        const img = addImage.getBase64();
        if (img) productData.imageBase64 = img;

        await addDoc(collection(db, 'catalogue'), productData);
        showToast(`✅ "${name}" added to catalogue!`);

        productForm.reset();
        addPriceToggle.setToggle(false);
        resetVariationsContainer(variationsContainer, false);
        addImage.reset();
        loadInventory();
    } catch (err) {
        console.error(err);
        showToast('❌ Failed to save product. Please try again.', 'error');
    } finally {
        saveBtn.disabled = false; saveBtn.textContent = 'Save to Catalogue';
    }
});

// =====================================================
// INVENTORY TABLE
// =====================================================
const inventoryBody = document.getElementById('inventory-body');

async function loadInventory() {
    inventoryBody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;opacity:0.5;">Loading inventory...</td></tr>';
    try {
        const snapshot = await getDocs(collection(db, 'catalogue'));
        if (snapshot.empty) {
            inventoryBody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;opacity:0.5;">No products yet. Add one above.</td></tr>';
            return;
        }
        inventoryBody.innerHTML = '';
        snapshot.forEach(docSnap => inventoryBody.appendChild(buildTableRow({ id: docSnap.id, ...docSnap.data() })));
    } catch (err) {
        console.error(err);
        inventoryBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:red;">Error loading inventory.</td></tr>';
    }
}

function buildTableRow(product) {
    // Determine if all variations share the same price
    const prices = [...new Set(product.variations.map(v => v.price))];
    const allSamePrice = prices.length === 1;

    const variationsHTML = product.variations.map(v => {
        const lowStock = v.stock <= 5 ? 'stock-low' : '';
        const priceLabel = allSamePrice ? '' : `<span class="badge-price">RM${(v.price || 0).toFixed(2)}</span>`;
        return `
            <div class="variation-badge">
                <span class="badge-name">${v.name}</span>
                ${priceLabel}
                <span class="stock-count ${lowStock}">${v.stock}</span>
            </div>`;
    }).join('');

    // Show price in header area of cell
    const priceDisplay = allSamePrice
        ? `<div style="font-size:0.82rem;color:var(--muted-text);margin-bottom:0.4rem;">RM${(prices[0] || 0).toFixed(2)} each</div>`
        : `<div style="font-size:0.82rem;color:var(--muted-text);margin-bottom:0.4rem;">Per-variation pricing</div>`;

    const imageCell = product.imageBase64
        ? `<img src="${product.imageBase64}" class="table-thumb" alt="${product.name}">`
        : `<div class="table-thumb-placeholder">📦</div>`;

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${imageCell}</td>
        <td><strong>${product.name}</strong></td>
        <td>${priceDisplay}${variationsHTML}</td>
        <td>
            <button class="btn-action btn-edit">Edit</button>
            <button class="btn-action btn-delete">Delete</button>
        </td>
    `;
    row.querySelector('.btn-edit').addEventListener('click', () => openEditModal(product));
    row.querySelector('.btn-delete').addEventListener('click', () => handleDelete(product.id, product.name));
    return row;
}

async function handleDelete(productId, productName) {
    if (!confirm(`Are you sure you want to delete "${productName}"?\n\nThis cannot be undone.`)) return;
    try {
        await deleteDoc(doc(db, 'catalogue', productId));
        showToast(`🗑️ "${productName}" removed from catalogue.`);
        loadInventory();
    } catch (err) {
        console.error(err);
        showToast('❌ Failed to delete product. Please try again.', 'error');
    }
}

// =====================================================
// EDIT MODAL
// =====================================================
const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
const editSaveBtn = document.getElementById('edit-save-btn');
const editErrorMsg = document.getElementById('edit-error');
const editVariationsContainer = document.getElementById('edit-variations-container');
const editAddVariationBtn = document.getElementById('edit-add-variation-btn');

const editImage = setupImageUpload({ areaId: 'edit-image-upload-area', inputId: 'edit-product-image', placeholderId: 'edit-image-placeholder', previewId: 'edit-image-preview', removeBtnId: 'edit-remove-image-btn' });

const editPriceToggle = setupPriceToggle({
    toggleId: 'edit-unified-price-toggle',
    unifiedGroupId: 'edit-unified-price-group',
    unifiedInputId: 'edit-price',
    containerId: 'edit-variations-container',
    headerSuffixId: null
});

let currentEditId = null;

function openEditModal(product) {
    currentEditId = product.id;
    document.getElementById('edit-name').value = product.name;

    // Detect if product uses unified pricing (all variations same price)
    const prices = [...new Set(product.variations.map(v => v.price ?? 0))];
    const isUnified = prices.length === 1;

    editPriceToggle.setToggle(isUnified);
    if (isUnified) document.getElementById('edit-price').value = prices[0].toFixed(2);

    // Populate variation rows
    editVariationsContainer.innerHTML = '';
    product.variations.forEach(v => {
        const row = buildVariationRow(v.name, (v.price || 0).toFixed(2), v.stock, isUnified);
        editVariationsContainer.appendChild(row);
        attachVariationDeleteEvent(editVariationsContainer, row.querySelector('.delete-var'), true);
    });
    updateDeleteButtons(editVariationsContainer);

    editImage.loadExisting(product.imageBase64 || null);
    editErrorMsg.classList.add('hidden');
    editModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeEditModal() {
    editModal.classList.add('hidden');
    document.body.style.overflow = '';
    currentEditId = null;
}

editAddVariationBtn.addEventListener('click', () => {
    const isUnified = editPriceToggle.isUnified();
    const row = buildVariationRow('', '', '', isUnified);
    editVariationsContainer.appendChild(row);
    attachVariationDeleteEvent(editVariationsContainer, row.querySelector('.delete-var'), true);
    updateDeleteButtons(editVariationsContainer);
    row.querySelector('.var-price').required = !isUnified;
});

document.getElementById('modal-close-btn').addEventListener('click', closeEditModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !editModal.classList.contains('hidden')) closeEditModal(); });

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEditId) return;

    const name = document.getElementById('edit-name').value.trim();
    const isUnified = editPriceToggle.isUnified();
    const unifiedPrice = editPriceToggle.getUnifiedPrice();

    if (isUnified && (!unifiedPrice || unifiedPrice <= 0)) {
        editErrorMsg.textContent = 'Please enter a valid unified price.';
        editErrorMsg.classList.remove('hidden');
        return;
    }

    const variations = gatherVariations(editVariationsContainer, isUnified, unifiedPrice);

    editSaveBtn.disabled = true; editSaveBtn.textContent = 'Saving...';
    editErrorMsg.classList.add('hidden');

    try {
        const updatedData = { name, variations };
        const imgBase64 = editImage.getBase64();
        if (imgBase64 === false) updatedData.imageBase64 = null;
        else if (imgBase64) updatedData.imageBase64 = imgBase64;

        await updateDoc(doc(db, 'catalogue', currentEditId), updatedData);
        showToast(`✅ "${name}" updated successfully!`);
        closeEditModal();
        loadInventory();
    } catch (err) {
        console.error(err);
        editErrorMsg.textContent = '❌ Failed to save changes. Please try again.';
        editErrorMsg.classList.remove('hidden');
        showToast('❌ Failed to save changes.', 'error');
    } finally {
        editSaveBtn.disabled = false; editSaveBtn.textContent = 'Save Changes';
    }
});

loadInventory();