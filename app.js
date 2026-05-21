import { db } from './firebase.js';
import {
    collection, getDocs, addDoc, doc, runTransaction, serverTimestamp
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

// --- STATE ---
const checkoutForm = document.getElementById('checkout-form');
const productGrid = document.getElementById('product-grid');
const variantGroup = document.getElementById('variant-group');
const variantGrid = document.getElementById('variant-grid');
const quantityGroup = document.getElementById('quantity-group');
const quantityInput = document.getElementById('quantity');
const totalPriceDisplay = document.getElementById('total-price');
const submitBtn = checkoutForm.querySelector('.btn-primary');

let catalogue = [];        // All products from Firestore
let selectedProduct = null; // Currently selected product object
let selectedVarIndex = null; // Currently selected variation index

// --- LOAD CATALOGUE & BUILD CARD GRID ---
async function loadCatalogue() {
    productGrid.innerHTML = '<p class="grid-loading">Loading inventory...</p>';

    try {
        const snapshot = await getDocs(collection(db, 'catalogue'));
        catalogue = [];

        snapshot.forEach(docSnap => {
            catalogue.push({ id: docSnap.id, ...docSnap.data() });
        });

        if (catalogue.length === 0) {
            productGrid.innerHTML = '<p class="grid-loading">No items in inventory yet.</p>';
            return;
        }

        renderProductGrid();

    } catch (err) {
        console.error("Failed to load catalogue:", err);
        productGrid.innerHTML = '<p class="grid-loading" style="color:red;">Error loading inventory.</p>';
    }
}

function renderProductGrid() {
    productGrid.innerHTML = '';

    catalogue.forEach(product => {
        // Check if every variation is out of stock
        const totalStock = product.variations.reduce((sum, v) => sum + v.stock, 0);
        const isOOS = totalStock === 0;

        const card = document.createElement('div');
        card.className = 'product-card' + (isOOS ? ' out-of-stock' : '');
        card.dataset.productId = product.id;

        const imageHTML = product.imageBase64
            ? `<img src="${product.imageBase64}" class="product-card-img" alt="${product.name}">`
            : `<div class="product-card-img-placeholder">📦</div>`;

        card.innerHTML = `
            ${imageHTML}
            <div class="product-card-body">
                <div class="product-card-name">${product.name}</div>
                <div class="product-card-price">RM${product.price.toFixed(2)}</div>
                ${isOOS ? '<div class="product-card-oos">Out of Stock</div>' : ''}
            </div>
        `;

        if (!isOOS) {
            card.addEventListener('click', () => handleProductSelect(product));
        }

        productGrid.appendChild(card);
    });
}

// --- HANDLE PRODUCT SELECTION ---
function handleProductSelect(product) {
    selectedProduct = product;
    selectedVarIndex = null;

    // Highlight the selected card, unhighlight others
    document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.product-card[data-product-id="${product.id}"]`).classList.add('selected');

    // Hide quantity section until variant (if needed) is chosen
    quantityGroup.classList.add('hidden');
    totalPriceDisplay.innerText = '0.00';

    const hasMultipleVariants = product.variations.length > 1;

    if (hasMultipleVariants) {
        // Show variant selector
        renderVariantGrid(product);
        variantGroup.classList.remove('hidden');
    } else {
        // Single variation — skip variant step, go straight to quantity
        variantGroup.classList.add('hidden');
        selectedVarIndex = 0;
        showQuantitySection();
    }
}

// --- RENDER VARIANT BUTTONS ---
function renderVariantGrid(product) {
    variantGrid.innerHTML = '';

    product.variations.forEach((variation, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'variant-btn';
        btn.disabled = variation.stock === 0;
        btn.innerHTML = `
            ${variation.name}
            <span class="variant-stock-label">${variation.stock === 0 ? 'Out of stock' : `${variation.stock} left`}</span>
        `;

        btn.addEventListener('click', () => {
            document.querySelectorAll('.variant-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedVarIndex = index;
            showQuantitySection();
        });

        variantGrid.appendChild(btn);
    });
}

// --- SHOW QUANTITY + PAYMENT SECTION ---
function showQuantitySection() {
    quantityInput.value = 1;
    updateTotal();
    quantityGroup.classList.remove('hidden');
    // Scroll smoothly to the quantity section on mobile
    quantityGroup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- TOTAL CALCULATION ---
function updateTotal() {
    if (!selectedProduct || selectedVarIndex === null) {
        totalPriceDisplay.innerText = '0.00';
        return;
    }
    const qty = parseInt(quantityInput.value) || 0;
    totalPriceDisplay.innerText = (selectedProduct.price * qty).toFixed(2);
}

quantityInput.addEventListener('input', updateTotal);

// --- FORM SUBMISSION ---
checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!selectedProduct || selectedVarIndex === null) {
        return alert('Please select an item and variation.');
    }

    const variation = selectedProduct.variations[selectedVarIndex];
    const qty = parseInt(quantityInput.value);
    const total = parseFloat(totalPriceDisplay.innerText);
    const paymentMethod = document.querySelector('input[name="payment"]:checked').value;

    if (qty < 1) return alert('Quantity must be at least 1.');
    if (qty > variation.stock) {
        return alert(`Not enough stock! Only ${variation.stock} unit(s) of "${variation.name}" remaining.`);
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    try {
        // Write sale record
        await addDoc(collection(db, 'sales'), {
            productId: selectedProduct.id,
            productName: selectedProduct.name,
            variationName: variation.name,
            quantity: qty,
            unitPrice: selectedProduct.price,
            totalPaid: total,
            paymentMethod,
            timestamp: serverTimestamp()
        });

        // Deduct stock via transaction
        const productRef = doc(db, 'catalogue', selectedProduct.id);
        await runTransaction(db, async (transaction) => {
            const productDoc = await transaction.get(productRef);
            if (!productDoc.exists()) throw new Error("Product no longer exists.");

            const variations = [...productDoc.data().variations];
            const newStock = variations[selectedVarIndex].stock - qty;
            if (newStock < 0) throw new Error("Insufficient stock — sale aborted.");

            variations[selectedVarIndex].stock = newStock;
            transaction.update(productRef, { variations });
        });

        alert(`✅ Sale logged!\n\n${selectedProduct.name} — ${variation.name}\nQty: ${qty}\nTotal: RM${total.toFixed(2)} via ${paymentMethod}`);

        // Full reset
        selectedProduct = null;
        selectedVarIndex = null;
        variantGroup.classList.add('hidden');
        quantityGroup.classList.add('hidden');
        totalPriceDisplay.innerText = '0.00';
        await loadCatalogue(); // Refresh grid with updated stock

    } catch (err) {
        console.error("Transaction failed:", err);
        alert(`❌ Error: ${err.message}\n\nThe sale was not recorded. Please try again.`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Complete Transaction';
    }
});

// Boot
loadCatalogue();