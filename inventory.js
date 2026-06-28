// ============================================================
// DION DIAMOND MAKER ADMIN — Inventory
// ============================================================
import { db, fbReady } from './firebase-init.js';
import { escapeHtml, toast, debounce, setButtonLoading, LOW_STOCK_THRESHOLD } from './utils.js';
import { getProducts } from './products.js';

let searchTerm = '';
let onlyLowStock = false;

export function init(container) {
  container.innerHTML = `
    <div class="panel-toolbar">
      <input type="text" id="invSearch" class="input" placeholder="Search by product or SKU..." />
      <label class="checkbox-label" style="white-space:nowrap;"><input type="checkbox" id="invLowStockToggle"> Show low/out of stock only</label>
      <button class="btn-secondary btn-sm" id="invHistoryToggle">View History</button>
    </div>
    <div class="table-wrap" id="invMainTableWrap">
      <table class="data-table">
        <thead><tr><th>Product / Variant</th><th>SKU</th><th>Stock</th><th>Status</th><th>Quick Update</th></tr></thead>
        <tbody id="invTableBody"><tr><td colspan="5" class="empty-state">Loading inventory...</td></tr></tbody>
      </table>
    </div>
    <div class="table-wrap" id="invHistoryTableWrap" style="display:none;">
      <table class="data-table">
        <thead><tr><th>Date</th><th>Product / Variant</th><th>SKU</th><th>Change</th><th>New Stock</th></tr></thead>
        <tbody id="invHistoryBody"><tr><td colspan="5" class="empty-state">Loading history...</td></tr></tbody>
      </table>
    </div>
  `;
  document.getElementById('invSearch').addEventListener('input', debounce((e) => { searchTerm = e.target.value.trim().toLowerCase(); render(); }, 250));
  document.getElementById('invLowStockToggle').addEventListener('change', (e) => { onlyLowStock = e.target.checked; render(); });
  document.getElementById('invHistoryToggle').addEventListener('click', toggleHistoryView);
  window.addEventListener('admin:products-updated', render);
  render();
  if (fbReady) loadHistory();
}

let showingHistory = false;
function toggleHistoryView() {
  showingHistory = !showingHistory;
  document.getElementById('invMainTableWrap').style.display = showingHistory ? 'none' : 'block';
  document.getElementById('invHistoryTableWrap').style.display = showingHistory ? 'block' : 'none';
  document.getElementById('invHistoryToggle').textContent = showingHistory ? 'Back to Stock List' : 'View History';
}

function loadHistory() {
  db.collection('inventoryHistory').orderBy('at', 'desc').limit(100).onSnapshot((snap) => {
    const tbody = document.getElementById('invHistoryBody');
    if (!tbody) return;
    if (snap.empty) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No stock changes logged yet.</td></tr>'; return; }
    tbody.innerHTML = snap.docs.map(d => {
      const h = d.data();
      const dateStr = h.at?.toDate ? h.at.toDate().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      const changeStr = h.change > 0 ? `+${h.change}` : String(h.change);
      return `<tr><td>${escapeHtml(dateStr)}</td><td>${escapeHtml(h.label)}</td><td>${escapeHtml(h.sku || '—')}</td><td class="${h.change < 0 ? 'stock-low' : ''}">${changeStr}</td><td>${h.newStock}</td></tr>`;
    }).join('');
  }, (e) => console.error('Inventory history load error:', e));
}

function flattenStockRows() {
  const rows = [];
  getProducts().forEach(p => {
    if (p.variants && p.variants.length) {
      p.variants.forEach((v, i) => rows.push({
        productId: p.id, variantIndex: i, label: `${p.name} — ${v.name}`, sku: v.sku || p.sku, stock: Number(v.stock) || 0, isVariant: true
      }));
    } else {
      rows.push({ productId: p.id, variantIndex: null, label: p.name, sku: p.sku, stock: Number(p.stock) || 0, isVariant: false });
    }
  });
  return rows;
}

function render() {
  const tbody = document.getElementById('invTableBody');
  if (!tbody) return;
  if (!fbReady) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Firebase isn't connected.</td></tr>`; return; }

  // Preserve an in-progress edit: if the admin is mid-typing in a stock input
  // when an unrelated product update triggers this re-render, don't wipe it out.
  const active = document.activeElement;
  const focusedId = (active && active.id && active.id.startsWith('invInput')) ? active.id : null;
  const focusedValue = focusedId ? active.value : null;
  const focusedSelectionStart = focusedId ? active.selectionStart : null;

  let rows = flattenStockRows();
  if (searchTerm) rows = rows.filter(r => `${r.label} ${r.sku}`.toLowerCase().includes(searchTerm));
  if (onlyLowStock) rows = rows.filter(r => r.stock <= LOW_STOCK_THRESHOLD);

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No matching items. ${getProducts().length === 0 ? 'Add products first.' : ''}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r, idx) => {
    const statusLabel = r.stock === 0 ? 'Out of Stock' : r.stock <= LOW_STOCK_THRESHOLD ? 'Low Stock' : 'In Stock';
    const statusClass = r.stock === 0 ? 'badge-cancelled' : r.stock <= LOW_STOCK_THRESHOLD ? 'badge-pending' : 'badge-delivered';
    const inputId = `invInput${idx}`;
    const valueToShow = (inputId === focusedId) ? focusedValue : r.stock;
    return `
      <tr>
        <td class="row-title">${escapeHtml(r.label)}</td>
        <td>${escapeHtml(r.sku || '—')}</td>
        <td><span class="${r.stock <= LOW_STOCK_THRESHOLD ? 'stock-low' : ''}">${r.stock}</span></td>
        <td><span class="badge ${statusClass}">${statusLabel}</span></td>
        <td class="row-actions">
          <input type="number" class="input" id="${inputId}" value="${valueToShow}" min="0" style="width:80px;">
          <button class="icon-btn" data-row="${idx}">Update</button>
        </td>
      </tr>
    `;
  }).join('');

  if (focusedId) {
    const el = document.getElementById(focusedId);
    if (el) { el.focus(); if (focusedSelectionStart !== null) el.setSelectionRange(focusedSelectionStart, focusedSelectionStart); }
  }

  rows.forEach((r, idx) => {
    tbody.querySelector(`[data-row="${idx}"]`)?.addEventListener('click', async (e) => {
      const newStock = Number(document.getElementById(`invInput${idx}`).value);
      if (isNaN(newStock) || newStock < 0) { toast('Please enter a valid stock number.', 'error'); return; }
      const oldStock = r.stock;
      setButtonLoading(e.target, true, '...');
      try {
        if (r.isVariant) {
          const product = getProducts().find(p => p.id === r.productId);
          const variants = [...(product.variants || [])];
          variants[r.variantIndex] = { ...variants[r.variantIndex], stock: newStock };
          await db.collection('products').doc(r.productId).update({ variants });
        } else {
          await db.collection('products').doc(r.productId).update({ stock: newStock });
        }
        // Audit trail — every manual stock change is logged so you can see who
        // changed what, when, in the History panel below.
        db.collection('inventoryHistory').add({
          productId: r.productId, label: r.label, sku: r.sku || '',
          oldStock, newStock, change: newStock - oldStock,
          at: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.warn('History log failed (non-fatal):', err));
        toast('Stock updated', 'success');
      } catch (err) {
        toast('Update failed: ' + err.message, 'error');
      } finally {
        setButtonLoading(e.target, false);
      }
    });
  });
}
