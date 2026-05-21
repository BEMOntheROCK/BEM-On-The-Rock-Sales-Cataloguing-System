import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, doc, deleteDoc, updateDoc, serverTimestamp
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

// ============================================================
// IMAGE COMPRESSION UTILITY (shared by add form and edit modal)
// ============================================================
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
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);

                // Binary search for the quality level that hits the target KB
                let lo = 0.1, hi = 0.95, result = '';
                for (let i = 0; i < 10; i++) {
                    const mid = (lo + hi) / 2;
                    result = canvas.toDataURL('image/jpeg', mid);
                    const sizeKB = (result.length * 0.75) / 1024;
                    if (sizeKB > targetKB) hi = mid;
                    else lo = mid;
                }
                resolve(result);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// Helper to wire up an image upload area
// Returns an object with getBase64() and reset() methods
function setupImageUpload({ areaId, inputId, placeholderId, previewId, removeBtnId }) {
    const area = document.getElementById(areaId);
    const input = document.getElementById(inputId);
    const placeholder = document.getElementById(placeholderId);
    const preview = document.getElementById(previewId);
    const removeBtn = document.getElementById(removeBtnId);

    let base64 = null; // null = no image; false = image was explicitly removed

    area.addEventListener('click', (e) => {
        if (e.target === removeBtn) return;
        input.click();
    });

    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        if (file.size > 6 * 1024 * 1024) {
            alert('Image is too large. Please choose an image under 6MB.');
            input.value = '';
            return;
        }
        base64 = await compressImage(file, 600);
        preview.src = base64;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
        removeBtn.classList.remove('hidden');
    });

    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        reset();
        base64 = false; // false signals "user explicitly removed the image"
    });

    function reset() {
        base64 = null;
        input.value = '';
        preview.src = '';
        preview.classList.add('hidden');
        placeholder.classList.remove('hidden');
        removeBtn.classList.add('hidden');
    }

    function loadExisting(existingBase64) {
        if (existingBase64) {
            base64 = existingBase64;
            preview.src = existingBase64;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
            removeBtn.classList.remove('hidden');
        } else {
            reset();
        }
    }

    return {
        getBase64: () => base64,
        reset,
        loadExisting
    };
}

// ============================================================
// ADD FORM — Image upload
// ============================================================
const addImage = setupImageUpload({
    areaId: 'image-upload-area',
    inputId: 'product-image',
    placeholderId: 'image-placeholder',
    previewId: 'image-preview',
    removeBtnId: 'remove-image-btn'
});

// ============================================================
// ADD FORM — Dynamic variations
// ============================================================
const variationsContainer = document.getElementById('variations-container');
const addVariationBtn = document.getElementById('add-variation-btn');

function makeDeleteHandler(container) {
    return function attachDeleteEvent(button) {
        button.addEventListener('click', (e) => {
            const row = e.target.closest('.variation-row');
            if (container.children.length > 1) row.remove();
            updateDeleteButtons(container);
        });
    };
}

function updateDeleteButtons(container) {
    const btns = container.querySelectorAll('.delete-var');
    if (container.children.length === 1) {
        btns[0].disabled = true;
    } else {
        btns.forEach(btn => btn.disabled = false);
    }
}

const attachAddFormDelete = makeDeleteHandler(variationsContainer);

addVariationBtn.addEventListener('click', () => {
    const newRow = document.createElement('div');
    newRow.className = 'variation-row';
    newRow.innerHTML = `
        <input type="text" class="var-name" placeholder="e.g., Size M - Black" required>
        <input type="number" class="var-stock" placeholder="Stock Qty" min="0" required>
        <button type="button" class="btn-icon delete-var">🗑️</button>
    `;
    variationsContainer.appendChild(newRow);
    attachAddFormDelete(newRow.querySelector('.delete-var'));
    updateDeleteButtons(variationsContainer);
});

attachAddFormDelete(document.querySelector('#variations-container .delete-var'));

// ============================================================
// ADD FORM — Submit
// ============================================================
const productForm = document.getElementById('product-form');
const saveBtn = productForm.querySelector('.btn-primary');

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('product-name').value.trim();
    const price = parseFloat(document.getElementById('product-price').value);
    const variations = gatherVariations(variationsContainer);

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const productData = { name, price, variations, createdAt: serverTimestamp() };
        const img = addImage.getBase64();
        if (img) productData.imageBase64 = img;

        await addDoc(collection(db, 'catalogue'), productData);
        alert(`✅ "${name}" has been saved to the catalogue!`);

        productForm.reset();
        resetVariationsContainer(variationsContainer, attachAddFormDelete);
        addImage.reset();
        loadInventory();

    } catch (err) {
        console.error("Failed to save product:", err);
        alert('❌ Failed to save product. Please try again.');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save to Catalogue';
    }
});

// ============================================================
// INVENTORY TABLE
// ============================================================
const inventoryBody = document.getElementById('inventory-body');

async function loadInventory() {
    inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;opacity:0.5;">Loading inventory...</td></tr>';
    try {
        const snapshot = await getDocs(collection(db, 'catalogue'));
        if (snapshot.empty) {
            inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;opacity:0.5;">No products yet. Add one above.</td></tr>';
            return;
        }
        inventoryBody.innerHTML = '';
        snapshot.forEach(docSnap => {
            const product = { id: docSnap.id, ...docSnap.data() };
            inventoryBody.appendChild(buildTableRow(product));
        });
    } catch (err) {
        console.error("Failed to load inventory:", err);
        inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:red;">Error loading inventory.</td></tr>';
    }
}

function buildTableRow(product) {
    const variationsHTML = product.variations.map(v => {
        const lowStockClass = v.stock <= 5 ? 'stock-low' : '';
        return `<div class="variation-badge"><span>${v.name}</span><span class="stock-count ${lowStockClass}">${v.stock}</span></div>`;
    }).join('');

    const imageCell = product.imageBase64
        ? `<img src="${product.imageBase64}" class="table-thumb" alt="${product.name}">`
        : `<div class="table-thumb-placeholder">📦</div>`;

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${imageCell}</td>
        <td><strong>${product.name}</strong></td>
        <td>RM${product.price.toFixed(2)}</td>
        <td>${variationsHTML}</td>
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
        alert(`"${productName}" has been removed from the catalogue.`);
        loadInventory();
    } catch (err) {
        console.error("Delete failed:", err);
        alert('Failed to delete the product. Please try again.');
    }
}

// ============================================================
// EDIT MODAL
// ============================================================
const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
const editSaveBtn = document.getElementById('edit-save-btn');
const editErrorMsg = document.getElementById('edit-error');
const editVariationsContainer = document.getElementById('edit-variations-container');
const editAddVariationBtn = document.getElementById('edit-add-variation-btn');

const attachEditDelete = makeDeleteHandler(editVariationsContainer);

// Edit modal image upload
const editImage = setupImageUpload({
    areaId: 'edit-image-upload-area',
    inputId: 'edit-product-image',
    placeholderId: 'edit-image-placeholder',
    previewId: 'edit-image-preview',
    removeBtnId: 'edit-remove-image-btn'
});

let currentEditId = null; // Firestore document ID of the product being edited

function openEditModal(product) {
    currentEditId = product.id;

    // Pre-fill basic fields
    document.getElementById('edit-name').value = product.name;
    document.getElementById('edit-price').value = product.price;

    // Pre-fill image
    editImage.loadExisting(product.imageBase64 || null);

    // Pre-fill variations
    editVariationsContainer.innerHTML = '';
    product.variations.forEach(v => {
        editVariationsContainer.appendChild(buildEditVariationRow(v.name, v.stock));
    });
    updateDeleteButtons(editVariationsContainer);

    // Clear any previous error
    editErrorMsg.textContent = '';
    editErrorMsg.classList.add('hidden');

    // Show modal
    editModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
}

function closeEditModal() {
    editModal.classList.add('hidden');
    document.body.style.overflow = '';
    currentEditId = null;
}

function buildEditVariationRow(name = '', stock = '') {
    const row = document.createElement('div');
    row.className = 'variation-row';
    row.innerHTML = `
        <input type="text" class="var-name" placeholder="e.g., Size S - Black" value="${name}" required>
        <input type="number" class="var-stock" placeholder="Stock Qty" min="0" value="${stock}" required>
        <button type="button" class="btn-icon delete-var">🗑️</button>
    `;

    const deleteBtn = row.querySelector('.delete-var');
    deleteBtn.addEventListener('click', () => {
        const stockVal = parseInt(row.querySelector('.var-stock').value) || 0;

        // Warn if this variation still has stock remaining
        if (stockVal > 0) {
            const confirmed = confirm(
                `This variation still has ${stockVal} unit(s) in stock.\n\nRemoving it will permanently discard those units. Are you sure?`
            );
            if (!confirmed) return;
        }

        if (editVariationsContainer.children.length > 1) row.remove();
        updateDeleteButtons(editVariationsContainer);
    });

    return row;
}

// "+ Add Another Variation" inside the modal
editAddVariationBtn.addEventListener('click', () => {
    editVariationsContainer.appendChild(buildEditVariationRow());
    updateDeleteButtons(editVariationsContainer);
});

// Close modal via X button or Cancel
document.getElementById('modal-close-btn').addEventListener('click', closeEditModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeEditModal);

// Close modal if user clicks the dark overlay (outside the modal box)
editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !editModal.classList.contains('hidden')) closeEditModal();
});

// Edit form submission
editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEditId) return;

    const name = document.getElementById('edit-name').value.trim();
    const price = parseFloat(document.getElementById('edit-price').value);
    const variations = gatherVariations(editVariationsContainer);

    editSaveBtn.disabled = true;
    editSaveBtn.textContent = 'Saving...';
    editErrorMsg.classList.add('hidden');

    try {
        const updatedData = { name, price, variations };

        const imgBase64 = editImage.getBase64();
        if (imgBase64 === false) {
            // User explicitly removed the image — delete the field
            updatedData.imageBase64 = null;
        } else if (imgBase64) {
            // User uploaded a new image
            updatedData.imageBase64 = imgBase64;
        }
        // If imgBase64 is null, the image was unchanged — don't touch the field

        await updateDoc(doc(db, 'catalogue', currentEditId), updatedData);

        closeEditModal();
        loadInventory();

    } catch (err) {
        console.error("Failed to update product:", err);
        editErrorMsg.textContent = '❌ Failed to save changes. Please try again.';
        editErrorMsg.classList.remove('hidden');
    } finally {
        editSaveBtn.disabled = false;
        editSaveBtn.textContent = 'Save Changes';
    }
});

// ============================================================
// SHARED HELPERS
// ============================================================
function gatherVariations(container) {
    const variations = [];
    container.querySelectorAll('.variation-row').forEach(row => {
        variations.push({
            name: row.querySelector('.var-name').value.trim(),
            stock: parseInt(row.querySelector('.var-stock').value) || 0
        });
    });
    return variations;
}

function resetVariationsContainer(container, attachDeleteFn) {
    container.innerHTML = `
        <div class="variation-row">
            <input type="text" class="var-name" placeholder="e.g., Size S - Black" required>
            <input type="number" class="var-stock" placeholder="Stock Qty" min="0" required>
            <button type="button" class="btn-icon delete-var" disabled>🗑️</button>
        </div>
    `;
    attachDeleteFn(container.querySelector('.delete-var'));
}

// ============================================================
// BOOT
// ============================================================
loadInventory();