import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, doc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- THEME TOGGLE LOGIC ---
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
themeToggleBtn.addEventListener('click', () => {
    isDarkMode = !isDarkMode;
    updateTheme();
});

// --- CHECKOUT FORM LOGIC ---
const checkoutForm = document.getElementById('checkout-form');
const productSelect = document.getElementById('product-select');
const quantityInput = document.getElementById('quantity');
const totalPriceDisplay = document.getElementById('total-price');
const submitBtn = checkoutForm.querySelector('.btn-primary');

// Local map of all selectable options, keyed by "productId_varIndex"
// Lets us look up price and stock instantly without re-querying Firestore
let catalogueMap = {};

// Fetch all products from Firestore and build the dropdown
async function loadCatalogue() {
    productSelect.innerHTML = '<option value="" disabled selected>Loading inventory...</option>';

    try {
        const snapshot = await getDocs(collection(db, 'catalogue'));

        if (snapshot.empty) {
            productSelect.innerHTML = '<option value="" disabled selected>-- No items in inventory --</option>';
            return;
        }

        productSelect.innerHTML = '<option value="" disabled selected>-- Choose an item from inventory --</option>';
        catalogueMap = {}; // Reset map on each load

        snapshot.forEach(docSnap => {
            const product = docSnap.data();
            const productId = docSnap.id;

            product.variations.forEach((variation, index) => {
                const key = `${productId}_${index}`;

                // Store everything we need for this option in the map
                catalogueMap[key] = {
                    productId,
                    varIndex: index,
                    productName: product.name,
                    varName: variation.name,
                    price: product.price,
                    stock: variation.stock
                };

                const option = document.createElement('option');
                option.value = key;

                if (variation.stock === 0) {
                    option.textContent = `${product.name} — ${variation.name} [Out of Stock]`;
                    option.disabled = true;
                } else {
                    option.textContent = `${product.name} — ${variation.name} (RM${product.price.toFixed(2)})`;
                }

                productSelect.appendChild(option);
            });
        });

    } catch (err) {
        console.error("Failed to load catalogue:", err);
        productSelect.innerHTML = '<option value="" disabled selected>-- Error loading inventory --</option>';
    }
}

// Calculate total dynamically when selection or quantity changes
function updateTotal() {
    const key = productSelect.value;
    const qty = parseInt(quantityInput.value) || 0;

    if (key && catalogueMap[key]) {
        totalPriceDisplay.innerText = (catalogueMap[key].price * qty).toFixed(2);
    } else {
        totalPriceDisplay.innerText = '0.00';
    }
}

productSelect.addEventListener('change', updateTotal);
quantityInput.addEventListener('input', updateTotal);

// Handle form submission
checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const key = productSelect.value;
    const qty = parseInt(quantityInput.value);
    const total = parseFloat(totalPriceDisplay.innerText);
    const paymentMethod = document.querySelector('input[name="payment"]:checked').value;
    const item = catalogueMap[key];

    // Guard: check stock before proceeding
    if (!item) return alert('Please select a valid item.');
    if (qty < 1) return alert('Quantity must be at least 1.');
    if (qty > item.stock) {
        return alert(`Not enough stock! Only ${item.stock} unit(s) of "${item.varName}" remaining.`);
    }

    // Disable button to prevent double-submission
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    try {
        // STEP 1: Write the sale record to the 'sales' collection
        await addDoc(collection(db, 'sales'), {
            productId: item.productId,
            productName: item.productName,
            variationName: item.varName,
            quantity: qty,
            unitPrice: item.price,
            totalPaid: total,
            paymentMethod: paymentMethod,
            timestamp: serverTimestamp()
        });

        // STEP 2: Deduct stock from the product's variation using a transaction.
        // A transaction ensures that if two sales happen at the same time,
        // the stock count stays accurate (no race condition).
        const productRef = doc(db, 'catalogue', item.productId);

        await runTransaction(db, async (transaction) => {
            const productDoc = await transaction.get(productRef);

            if (!productDoc.exists()) throw new Error("Product no longer exists.");

            const variations = [...productDoc.data().variations];
            const newStock = variations[item.varIndex].stock - qty;

            if (newStock < 0) throw new Error("Insufficient stock — sale aborted.");

            variations[item.varIndex].stock = newStock;
            transaction.update(productRef, { variations });
        });

        alert(`✅ Sale logged!\n\n${item.productName} — ${item.varName}\nQty: ${qty}\nTotal: RM${total.toFixed(2)} via ${paymentMethod}`);

        // Reset form and reload dropdown to reflect updated stock levels
        checkoutForm.reset();
        totalPriceDisplay.innerText = '0.00';
        await loadCatalogue();

    } catch (err) {
        console.error("Transaction failed:", err);
        alert(`❌ Error: ${err.message}\n\nThe sale was not recorded. Please try again.`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Complete Transaction';
    }
});

// Load catalogue on page start
loadCatalogue();