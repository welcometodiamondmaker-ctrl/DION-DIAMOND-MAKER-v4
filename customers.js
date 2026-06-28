// ============================================================
// DION DIAMOND MAKER ADMIN — Customer Management
// ============================================================
// Customers are DERIVED from the orders collection (grouped by phone),
// so this list can never drift out of sync with real order history.
// Admin-added notes/tags live in a small separate `customerNotes`
// collection, keyed by phone number.
import { db, fbReady } from './firebase-init.js';
import { escapeHtml, formatCurrency, formatDate, toast, debounce, paginate, renderPaginationControls } from './utils.js';
import { getOrders } from './orders.js';

let customers = [];
let notesMap = {};
let currentPage = 1;
const PAGE_SIZE = 12;
let searchTerm = '';

export function init(container) {
  container.innerHTML = `
    <div class="panel-toolbar">
      <input type="text" id="custSearch" class="input" placeholder="Search by name or phone..." />
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Lifetime Value</th><th>Last Order</th><th></th></tr></thead>
        <tbody id="custTableBody"><tr><td colspan="6" class="empty-state">Loading customers...</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="custPagination"></div>
  `;
  document.getElementById('custSearch').addEventListener('input', debounce((e) => {
    searchTerm = e.target.value.trim().toLowerCase(); currentPage = 1; renderList();
  }, 250));

  window.addEventListener('admin:orders-updated', rebuild);
  if (fbReady) {
    db.collection('customerNotes').onSnapshot((snap) => {
      notesMap = {};
      snap.docs.forEach(d => { notesMap[d.id] = d.data(); });
      rebuild();
    }, (e) => console.error('Customer notes load error:', e));
  }
  rebuild();
}

function rebuild() {
  const orders = getOrders();
  const grouped = {};
  orders.forEach(o => {
    if (!o.phone) return;
    if (!grouped[o.phone]) grouped[o.phone] = { phone: o.phone, name: o.name, orders: [], totalSpent: 0, lastOrderAt: null };
    const g = grouped[o.phone];
    g.orders.push(o);
    g.name = o.name || g.name; // most recent order's name wins (orders are pre-sorted desc by createdAt)
    if (o.status !== 'Cancelled' && o.status !== 'Payment Failed') g.totalSpent += Number(o.amount) || 0;
    const ts = o.createdAt?.toDate ? o.createdAt.toDate() : null;
    if (ts && (!g.lastOrderAt || ts > g.lastOrderAt)) g.lastOrderAt = ts;
  });
  customers = Object.values(grouped).sort((a, b) => (b.lastOrderAt || 0) - (a.lastOrderAt || 0));
  renderList();
}

function filteredCustomers() {
  if (!searchTerm) return customers;
  return customers.filter(c => `${c.name} ${c.phone}`.toLowerCase().includes(searchTerm));
}

function renderList() {
  const tbody = document.getElementById('custTableBody');
  if (!tbody) return;
  const list = filteredCustomers();
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No customers yet — they'll show up here after the first order.</td></tr>`;
    renderPaginationControls('custPagination', 1, 1, () => {});
    return;
  }
  const { pageItems, page, totalPages } = paginate(list, currentPage, PAGE_SIZE);
  currentPage = page;
  tbody.innerHTML = pageItems.map(c => `
    <tr>
      <td><div class="row-title">${escapeHtml(c.name)}</div>${notesMap[c.phone]?.tag ? `<span class="badge badge-shipped">${escapeHtml(notesMap[c.phone].tag)}</span>` : ''}</td>
      <td>${escapeHtml(c.phone)}</td>
      <td>${c.orders.length}</td>
      <td>${formatCurrency(c.totalSpent)}</td>
      <td>${c.lastOrderAt ? c.lastOrderAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
      <td class="row-actions"><button class="icon-btn" data-act="view" data-phone="${escapeHtml(c.phone)}">View</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-act="view"]').forEach(b => b.addEventListener('click', () => openCustomerDetail(customers.find(c => c.phone === b.dataset.phone))));
  renderPaginationControls('custPagination', page, totalPages, (p) => { currentPage = p; renderList(); });
}

function openCustomerDetail(customer) {
  if (!customer) return;
  const note = notesMap[customer.phone] || { tag: '', note: '' };
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal-box">
      <h3>${escapeHtml(customer.name)}</h3>
      <p class="modal-msg">${escapeHtml(customer.phone)} · ${customer.orders.length} order${customer.orders.length > 1 ? 's' : ''} · ${formatCurrency(customer.totalSpent)} total spent</p>

      <label>Tag <span class="label-hint">(e.g. VIP, Wholesale)</span></label>
      <input type="text" id="cdTag" class="input" value="${escapeHtml(note.tag || '')}" maxlength="30">
      <label style="margin-top:10px;">Internal Note</label>
      <textarea id="cdNote" class="input" rows="3" maxlength="500">${escapeHtml(note.note || '')}</textarea>

      <h4 style="margin:18px 0 8px;">Saved Addresses</h4>
      <div class="order-history-list">
        ${[...new Map(customer.orders.map(o => [`${o.address}|${o.city}|${o.pincode}`, o])).values()].map(o => `
          <div class="order-history-row" style="grid-template-columns:1fr;">
            <span>${escapeHtml(o.address)}, ${escapeHtml(o.city)}, ${escapeHtml(o.state)} - ${escapeHtml(o.pincode)}</span>
          </div>
        `).join('')}
      </div>

      <h4 style="margin:18px 0 8px;">Order History</h4>
      <div class="order-history-list">
        ${customer.orders.map(o => `
          <div class="order-history-row">
            <span>${formatDate(o.createdAt)}</span>
            <span>${escapeHtml(o.product || '—')}</span>
            <span>${formatCurrency(o.amount)}</span>
            <span class="badge ${o.status === 'Delivered' ? 'badge-delivered' : o.status === 'Shipped' ? 'badge-shipped' : (o.status === 'Cancelled' || o.status === 'Payment Failed') ? 'badge-cancelled' : 'badge-pending'}">${escapeHtml(o.status || 'Pending')}</span>
          </div>
        `).join('')}
      </div>

      <div class="modal-actions">
        <button class="btn-secondary" data-action="close">Close</button>
        <button class="btn-primary" id="cdSaveBtn">Save Note</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('show'));
  function close() { bg.classList.remove('show'); setTimeout(() => bg.remove(), 200); }
  bg.querySelector('[data-action="close"]').addEventListener('click', close);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.querySelector('#cdSaveBtn').addEventListener('click', async () => {
    try {
      await db.collection('customerNotes').doc(customer.phone).set({
        tag: bg.querySelector('#cdTag').value.trim(),
        note: bg.querySelector('#cdNote').value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      toast('Note saved', 'success');
      close();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  });
}
