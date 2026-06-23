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

// --- STATE ---
let categories = [];   // [{ id, name }]
let products   = [];   // all products from Firestore
let activeAdminTab = 'all';

// =====================================================
// IMAGE COMPRESSION
// =====================================================
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

const addImage  = setupImageUpload({ areaId: 'image-upload-area', inputId: 'product-image', placeholderId: 'image-placeholder', previewId: 'image-preview', removeBtnId: 'remove-image-btn' });
const editImage = setupImageUpload({ areaId: 'edit-image-upload-area', inputId: 'edit-product-image', placeholderId: 'edit-image-placeholder', previewId: 'edit-image-preview', removeBtnId: 'edit-remove-image-btn' });

// =====================================================
// COLLAPSIBLE CATEGORY MANAGER
// =====================================================
const categoriesToggle = document.getElementById('categories-toggle');
const categoriesBody   = document.getElementById('categories-body');

categoriesToggle.addEventListener('click', () => {
    const isOpen = !categoriesBody.classList.contains('hidden');
    categoriesBody.classList.toggle('hidden', isOpen);
    categoriesToggle.classList.toggle('open', !isOpen);
});

// =====================================================
// CATEGORY CRUD
// =====================================================
async function loadCategories() {
    const snapshot = await getDocs(collection(db, 'categories'));
    categories = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    categories.sort((a, b) => a.name.localeCompare(b.name));
    renderCategoryPills();
    renderCategoryCheckboxes('category-checkboxes', []);
    renderAdminTabBar();
}

function renderCategoryPills() {
    const list = document.getElementById('category-list');
    if (!categories.length) { list.innerHTML = '<p class="muted">No categories yet.</p>'; return; }
    list.innerHTML = '';
    categories.forEach(cat => {
        const pill = document.createElement('div');
        pill.className = 'category-pill';
        pill.innerHTML = `<span>${cat.name}</span><button class="category-pill-delete" data-id="${cat.id}" title="Delete category">✕</button>`;
        pill.querySelector('.category-pill-delete').addEventListener('click', () => handleDeleteCategory(cat.id, cat.name));
        list.appendChild(pill);
    });
}

// Render checkbox group for category multi-select
// containerId: where to render; selectedIds: array of already-selected category IDs
function renderCategoryCheckboxes(containerId, selectedIds = []) {
    const container = document.getElementById(containerId);
    if (!categories.length) { container.innerHTML = '<p class="muted">No categories available. Create one above first.</p>'; return; }
    container.innerHTML = '';
    categories.forEach(cat => {
        const label = document.createElement('label');
        label.className = 'category-checkbox-label';
        const checked = selectedIds.includes(cat.id) ? 'checked' : '';
        label.innerHTML = `<input type="checkbox" value="${cat.id}" ${checked}><span>${cat.name}</span>`;
        container.appendChild(label);
    });
}

function getCheckedCategories(containerId) {
    return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)].map(cb => cb.value);
}

function renderAdminTabBar() {
    const bar = document.getElementById('admin-tab-bar');
    bar.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'tab-btn' + (activeAdminTab === 'all' ? ' active' : '');
    allBtn.dataset.category = 'all';
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => setAdminTab('all'));
    bar.appendChild(allBtn);

    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn' + (activeAdminTab === cat.id ? ' active' : '');
        btn.dataset.category = cat.id;
        btn.textContent = cat.name;
        btn.addEventListener('click', () => setAdminTab(cat.id));
        bar.appendChild(btn);
    });
}

function setAdminTab(categoryId) {
    activeAdminTab = categoryId;
    renderAdminTabBar();
    renderInventoryTable();
}

document.getElementById('add-category-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-category-input');
    const name = input.value.trim();
    if (!name) return showToast('Please enter a category name.', 'error');
    if (categories.find(c => c.name.toLowerCase() === name.toLowerCase())) {
        return showToast('A category with that name already exists.', 'error');
    }
    try {
        const docRef = await addDoc(collection(db, 'categories'), { name, createdAt: serverTimestamp() });
        categories.push({ id: docRef.id, name });
        categories.sort((a, b) => a.name.localeCompare(b.name));
        input.value = '';
        renderCategoryPills();
        renderCategoryCheckboxes('category-checkboxes', []);
        renderAdminTabBar();
        showToast(`✅ Category "${name}" created!`);
    } catch (err) {
        console.error(err);
        showToast('❌ Failed to create category.', 'error');
    }
});

async function handleDeleteCategory(catId, catName) {
    if (!confirm(`Delete category "${catName}"?\n\nProducts assigned only to this category will fall back to showing under "All".`)) return;
    try {
        await deleteDoc(doc(db, 'categories', catId));
        categories = categories.filter(c => c.id !== catId);
        if (activeAdminTab === catId) activeAdminTab = 'all';
        renderCategoryPills();
        renderCategoryCheckboxes('category-checkboxes', []);
        renderAdminTabBar();
        renderInventoryTable();
        showToast(`🗑️ Category "${catName}" deleted.`);
    } catch (err) {
        console.error(err);
        showToast('❌ Failed to delete category.', 'error');
    }
}

// =====================================================
// PRICE TOGGLE
// =====================================================
function setupPriceToggle({ toggleId, unifiedGroupId, unifiedInputId, containerId, headerId }) {
    const toggle = document.getElementById(toggleId);
    const unifiedGroup = document.getElementById(unifiedGroupId);
    const container = document.getElementById(containerId);

    function apply() {
        const on = toggle.checked;
        unifiedGroup.classList.toggle('hidden', !on);
        container.classList.toggle('hide-var-price', on);
        container.querySelectorAll('.var-price').forEach(el => { el.required = !on; });
        const header = document.getElementById(headerId);
        if (header) { const ph = header.querySelector('.vh-price'); if (ph) ph.classList.toggle('hidden', on); }
    }
    toggle.addEventListener('change', apply);
    apply();
    return {
        isUnified: () => toggle.checked,
        getUnifiedPrice: () => parseFloat(document.getElementById(unifiedInputId)?.value) || 0,
        setToggle: (val) => { toggle.checked = val; apply(); }
    };
}

const addPriceToggle  = setupPriceToggle({ toggleId: 'unified-price-toggle',      unifiedGroupId: 'unified-price-group',      unifiedInputId: 'product-price', containerId: 'variations-container',      headerId: 'add-variation-header' });
const editPriceToggle = setupPriceToggle({ toggleId: 'edit-unified-price-toggle',  unifiedGroupId: 'edit-unified-price-group', unifiedInputId: 'edit-price',    containerId: 'edit-variations-container', headerId: 'edit-variation-header' });

// =====================================================
// VARIATION HELPERS
// =====================================================
function updateDeleteButtons(container) {
    const btns = container.querySelectorAll('.delete-var');
    btns.forEach(btn => btn.disabled = container.children.length === 1);
}

function gatherVariations(container, isUnified, unifiedPrice) {
    return [...container.querySelectorAll('.variation-row')].map(row => ({
        name:  row.querySelector('.var-name').value.trim(),
        price: isUnified ? unifiedPrice : (parseFloat(row.querySelector('.var-price')?.value) || 0),
        stock: parseInt(row.querySelector('.var-stock').value) || 0
    }));
}

function buildVariationRow(name = '', price = '', stock = '') {
    const row = document.createElement('div');
    row.className = 'variation-row';
    row.innerHTML = `
        <input type="text"   class="var-name"  placeholder="e.g., Size S - Black" value="${name}" required>
        <input type="number" class="var-price" step="0.01" placeholder="Price (RM)" min="0" value="${price}" required>
        <input type="number" class="var-stock" placeholder="Stock" min="0" value="${stock}" required>
        <button type="button" class="btn-icon delete-var">🗑️</button>
    `;
    return row;
}

function attachDeleteEvent(container, button, stockWarning = false) {
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

function resetVariationsContainer(container) {
    container.innerHTML = '';
    const row = buildVariationRow();
    row.querySelector('.delete-var').disabled = true;
    container.appendChild(row);
    attachDeleteEvent(container, row.querySelector('.delete-var'));
}

// Init add form variation
const variationsContainer = document.getElementById('variations-container');
attachDeleteEvent(variationsContainer, variationsContainer.querySelector('.delete-var'));

document.getElementById('add-variation-btn').addEventListener('click', () => {
    const row = buildVariationRow();
    variationsContainer.appendChild(row);
    attachDeleteEvent(variationsContainer, row.querySelector('.delete-var'));
    updateDeleteButtons(variationsContainer);
    row.querySelector('.var-price').required = !addPriceToggle.isUnified();
});

// =====================================================
// ADD FORM SUBMIT
// =====================================================
const productForm = document.getElementById('product-form');
const saveBtn     = productForm.querySelector('.btn-primary');

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name        = document.getElementById('product-name').value.trim();
    const isUnified   = addPriceToggle.isUnified();
    const unifiedPrice = addPriceToggle.getUnifiedPrice();
    const categoryIds = getCheckedCategories('category-checkboxes');
    const variations  = gatherVariations(variationsContainer, isUnified, unifiedPrice);

    if (isUnified && unifiedPrice <= 0) return showToast('Please enter a valid price.', 'error');

    saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
    try {
        const productData = { name, categoryIds, variations, createdAt: serverTimestamp() };
        const img = addImage.getBase64();
        if (img) productData.imageBase64 = img;

        const docRef = await addDoc(collection(db, 'catalogue'), productData);
        products.push({ id: docRef.id, ...productData });
        showToast(`✅ "${name}" added to catalogue!`);
        productForm.reset();
        addPriceToggle.setToggle(true);
        resetVariationsContainer(variationsContainer);
        addImage.reset();
        renderCategoryCheckboxes('category-checkboxes', []);
        renderInventoryTable();
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
    inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;opacity:0.5;">Loading inventory...</td></tr>';
    try {
        const snapshot = await getDocs(collection(db, 'catalogue'));
        products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderInventoryTable();
    } catch (err) {
        console.error(err);
        inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:red;">Error loading inventory.</td></tr>';
    }
}

function renderInventoryTable() {
    inventoryBody.innerHTML = '';

    // Filter by active tab
    let filtered = products;
    if (activeAdminTab !== 'all') {
        filtered = products.filter(p => (p.categoryIds || []).includes(activeAdminTab));
    }

    if (!filtered.length) {
        inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;opacity:0.5;">No products in this category.</td></tr>';
        return;
    }
    filtered.forEach(product => inventoryBody.appendChild(buildTableRow(product)));
}

function buildTableRow(product) {
    const prices = [...new Set((product.variations || []).map(v => v.price || 0))];
    const allSamePrice = prices.length === 1;

    const variationsHTML = (product.variations || []).map(v => {
        const lowStock = v.stock <= 5 ? 'stock-low' : '';
        const priceLabel = allSamePrice ? '' : `<span class="badge-price">RM${(v.price || 0).toFixed(2)}</span>`;
        return `<div class="variation-badge"><span class="badge-name">${v.name}</span>${priceLabel}<span class="stock-count ${lowStock}">${v.stock}</span></div>`;
    }).join('');

    const priceDisplay = allSamePrice
        ? `<div style="font-size:0.82rem;color:var(--muted-text);margin-bottom:0.4rem;">RM${(prices[0] || 0).toFixed(2)} each</div>`
        : `<div style="font-size:0.82rem;color:var(--muted-text);margin-bottom:0.4rem;">Per-variation pricing</div>`;

    const imageCell = product.imageBase64
        ? `<img src="${product.imageBase64}" class="table-thumb" alt="${product.name}">`
        : `<div class="table-thumb-placeholder">📦</div>`;

    // Resolve category names for this product
    const catIds = product.categoryIds || [];
    const catNames = catIds.map(id => categories.find(c => c.id === id)?.name).filter(Boolean);
    const categoryTagsHTML = catNames.length
        ? catNames.map(n => `<span class="category-tag">${n}</span>`).join('')
        : '<span style="font-size:0.8rem;color:var(--muted-text);">Uncategorised</span>';

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${imageCell}</td>
        <td><strong>${product.name}</strong></td>
        <td><div class="category-tags">${categoryTagsHTML}</div></td>
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
        products = products.filter(p => p.id !== productId);
        renderInventoryTable();
        showToast(`🗑️ "${productName}" removed from catalogue.`);
    } catch (err) {
        console.error(err);
        showToast('❌ Failed to delete product.', 'error');
    }
}

// =====================================================
// EDIT MODAL
// =====================================================
const editModal              = document.getElementById('edit-modal');
const editForm               = document.getElementById('edit-form');
const editSaveBtn            = document.getElementById('edit-save-btn');
const editErrorMsg           = document.getElementById('edit-error');
const editVariationsContainer = document.getElementById('edit-variations-container');

let currentEditId = null;

function openEditModal(product) {
    currentEditId = product.id;
    document.getElementById('edit-name').value = product.name;

    // Categories
    renderCategoryCheckboxes('edit-category-checkboxes', product.categoryIds || []);

    // Price toggle
    const prices = [...new Set((product.variations || []).map(v => v.price ?? 0))];
    const isUnified = prices.length === 1;
    editPriceToggle.setToggle(isUnified);
    if (isUnified) document.getElementById('edit-price').value = prices[0].toFixed(2);

    // Variations
    editVariationsContainer.innerHTML = '';
    (product.variations || []).forEach(v => {
        const row = buildVariationRow(v.name, (v.price || 0).toFixed(2), v.stock);
        editVariationsContainer.appendChild(row);
        attachDeleteEvent(editVariationsContainer, row.querySelector('.delete-var'), true);
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

document.getElementById('edit-add-variation-btn').addEventListener('click', () => {
    const row = buildVariationRow();
    editVariationsContainer.appendChild(row);
    attachDeleteEvent(editVariationsContainer, row.querySelector('.delete-var'), true);
    updateDeleteButtons(editVariationsContainer);
    row.querySelector('.var-price').required = !editPriceToggle.isUnified();
});

document.getElementById('modal-close-btn').addEventListener('click', closeEditModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !editModal.classList.contains('hidden')) closeEditModal(); });

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEditId) return;

    const name         = document.getElementById('edit-name').value.trim();
    const isUnified    = editPriceToggle.isUnified();
    const unifiedPrice = editPriceToggle.getUnifiedPrice();
    const categoryIds  = getCheckedCategories('edit-category-checkboxes');
    const variations   = gatherVariations(editVariationsContainer, isUnified, unifiedPrice);

    if (isUnified && unifiedPrice <= 0) {
        editErrorMsg.textContent = 'Please enter a valid unified price.';
        editErrorMsg.classList.remove('hidden');
        return;
    }

    editSaveBtn.disabled = true; editSaveBtn.textContent = 'Saving...';
    editErrorMsg.classList.add('hidden');

    try {
        const updatedData = { name, categoryIds, variations };
        const imgBase64 = editImage.getBase64();
        if (imgBase64 === false) updatedData.imageBase64 = null;
        else if (imgBase64) updatedData.imageBase64 = imgBase64;

        await updateDoc(doc(db, 'catalogue', currentEditId), updatedData);

        // Update local state
        const idx = products.findIndex(p => p.id === currentEditId);
        if (idx !== -1) products[idx] = { ...products[idx], ...updatedData };

        showToast(`✅ "${name}" updated successfully!`);
        closeEditModal();
        renderInventoryTable();
    } catch (err) {
        console.error(err);
        editErrorMsg.textContent = '❌ Failed to save changes. Please try again.';
        editErrorMsg.classList.remove('hidden');
        showToast('❌ Failed to save changes.', 'error');
    } finally {
        editSaveBtn.disabled = false; editSaveBtn.textContent = 'Save Changes';
    }
});

// =====================================================
// BOOT
// =====================================================
async function init() {
    await loadCategories();
    await loadInventory();
}
init();