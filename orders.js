// ============================================================
// DION DIAMOND MAKER ADMIN — Order Management
// ============================================================
import { db, fbReady } from './firebase-init.js';
import { escapeHtml, formatCurrency, formatDate, toast, confirmDialog, debounce, paginate, renderPaginationControls } from './utils.js';

let orders = [];
let currentPage = 1;
const PAGE_SIZE = 12;
let filters = { search: '', status: '' };

export function init(container) {
  container.innerHTML = `
    <div class="panel-toolbar">
      <input type="text" id="ordSearch" class="input" placeholder="Search by name, phone, or order ID..." />
      <select id="ordStatusFilter" class="input input-select">
        <option value="">All Status</option>
        <option value="Pending">Pending</option>
        <option value="Shipped">Shipped</option>
        <option value="Delivered">Delivered</option>
        <option value="Cancelled">Cancelled</option>
        <option value="Payment Failed">Payment Failed</option>
      </select>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Amount</th><th>Date</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="ordTableBody"><tr><td colspan="7" class="empty-state">Loading orders...</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="ordPagination"></div>
  `;

  document.getElementById('ordSearch').addEventListener('input', debounce((e) => {
    filters.search = e.target.value.trim().toLowerCase(); currentPage = 1; renderList();
  }, 250));
  document.getElementById('ordStatusFilter').addEventListener('change', (e) => {
    filters.status = e.target.value; currentPage = 1; renderList();
  });

  if (!fbReady) {
    document.getElementById('ordTableBody').innerHTML = `<tr><td colspan="7" class="empty-state">Firebase isn't connected.</td></tr>`;
    return;
  }

  db.collection('orders').orderBy('createdAt', 'desc').onSnapshot((snap) => {
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
    window.dispatchEvent(new CustomEvent('admin:orders-updated', { detail: { orders } }));
  }, (e) => {
    console.error('Orders load error:', e);
    document.getElementById('ordTableBody').innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load orders: ${escapeHtml(e.message)}</td></tr>`;
  });
}

export function getOrders() { return orders; }

function filteredOrders() {
  return orders.filter(o => {
    if (filters.status && (o.status || 'Pending') !== filters.status) return false;
    if (filters.search) {
      const hay = `${o.name} ${o.phone} ${o.id}`.toLowerCase();
      if (!hay.includes(filters.search)) return false;
    }
    return true;
  });
}

function statusBadgeClass(status) {
  if (status === 'Delivered') return 'badge-delivered';
  if (status === 'Shipped' || status === 'Packed' || status === 'Confirmed') return 'badge-shipped';
  if (status === 'Cancelled' || status === 'Payment Failed' || status === 'Return' || status === 'Refund') return 'badge-cancelled';
  return 'badge-pending';
}

function renderList() {
  const tbody = document.getElementById('ordTableBody');
  if (!tbody) return;
  const list = filteredOrders();
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No orders found.</td></tr>`;
    renderPaginationControls('ordPagination', 1, 1, () => {});
    return;
  }
  const { pageItems, page, totalPages } = paginate(list, currentPage, PAGE_SIZE);
  currentPage = page;
  tbody.innerHTML = pageItems.map(o => `
    <tr>
      <td><code class="order-id">#${escapeHtml(o.id.slice(-8))}</code></td>
      <td><div class="row-title">${escapeHtml(o.name)}</div><div class="row-sub">${escapeHtml(o.phone)}</div></td>
      <td>${escapeHtml(o.product || '—')}</td>
      <td>${formatCurrency(o.amount)}</td>
      <td>${formatDate(o.createdAt)}</td>
      <td><span class="badge ${statusBadgeClass(o.status)}">${escapeHtml(o.status || 'Pending')}</span></td>
      <td class="row-actions"><button class="icon-btn" data-act="view" data-id="${o.id}">View</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-act="view"]').forEach(b => b.addEventListener('click', () => openOrderDetail(orders.find(o => o.id === b.dataset.id))));
  renderPaginationControls('ordPagination', page, totalPages, (p) => { currentPage = p; renderList(); });
}

function openOrderDetail(order) {
  if (!order) return;
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal-box">
      <h3>Order #${escapeHtml(order.id.slice(-8))}</h3>
      <div class="detail-grid">
        <div><span class="detail-label">Customer</span><span>${escapeHtml(order.name)}</span></div>
        <div><span class="detail-label">Phone</span><span>${escapeHtml(order.phone)}</span></div>
        <div><span class="detail-label">Product</span><span>${escapeHtml(order.product || '—')}</span></div>
        <div><span class="detail-label">Amount</span><span>${formatCurrency(order.amount)}</span></div>
        <div><span class="detail-label">Payment ID</span><span>${escapeHtml(order.paymentId || '—')}</span></div>
        <div><span class="detail-label">Placed</span><span>${formatDate(order.createdAt)}</span></div>
        <div class="detail-full"><span class="detail-label">Delivery Address</span><span>${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} - ${escapeHtml(order.pincode)}</span></div>
        ${order.failureReason ? `<div class="detail-full"><span class="detail-label">Failure Reason</span><span>${escapeHtml(order.failureReason)}</span></div>` : ''}
      </div>

      <label style="margin-top:18px;">Update Status</label>
      <select id="odStatusSelect" class="input input-select">
        ${['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'Return', 'Refund'].map(s => `<option value="${s}" ${order.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>

      <h4 style="margin:18px 0 8px;">Order Notes / Timeline</h4>
      <div class="order-history-list" id="odNotesList">
        ${(order.notes || []).map(n => `<div class="order-history-row" style="grid-template-columns:1fr;"><span>${formatDate(n.at)} — ${escapeHtml(n.text)}</span></div>`).join('') || '<div class="empty-state" style="padding:14px !important;">No notes yet.</div>'}
      </div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input type="text" id="odNoteInput" class="input" placeholder="Add a note (e.g. 'Called customer, confirmed address')" style="flex:1;">
        <button class="btn-secondary btn-sm" id="odAddNoteBtn">Add</button>
      </div>

      <div class="modal-actions">
        <button class="btn-secondary" id="odPrintBtn">🖨 Print Invoice</button>
        <button class="btn-secondary" data-action="close">Close</button>
        <button class="btn-primary" id="odSaveBtn">Update Status</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('show'));
  function close() { bg.classList.remove('show'); setTimeout(() => bg.remove(), 200); }
  bg.querySelector('[data-action="close"]').addEventListener('click', close);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.querySelector('#odSaveBtn').addEventListener('click', async () => {
    const newStatus = bg.querySelector('#odStatusSelect').value;
    if (newStatus === order.status) { close(); return; }
    const ok = await confirmDialog(`Mark this order as "${newStatus}"?`, { title: 'Update order status', danger: false, confirmLabel: 'Update' });
    if (!ok) return;
    try {
      await db.collection('orders').doc(order.id).update({ status: newStatus });
      toast('Order status updated', 'success');
      close();
    } catch (e) { toast('Update failed: ' + e.message, 'error'); }
  });
  bg.querySelector('#odAddNoteBtn').addEventListener('click', async () => {
    const input = bg.querySelector('#odNoteInput');
    const text = input.value.trim();
    if (!text) return;
    try {
      const newNote = { text, at: new Date() };
      await db.collection('orders').doc(order.id).update({
        notes: firebase.firestore.FieldValue.arrayUnion(newNote)
      });
      input.value = '';
      toast('Note added', 'success');
      close(); // re-open with fresh data on next click — keeps this simple and always accurate
    } catch (e) { toast('Failed to add note: ' + e.message, 'error'); }
  });
  bg.querySelector('#odPrintBtn').addEventListener('click', () => printInvoice(order));
}

function printInvoice(order) {
  const win = window.open('', '_blank');
  if (!win) { toast('Please allow popups to print the invoice.', 'error'); return; }
  const itemsRows = (order.items && order.items.length)
    ? order.items.map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${i.qty}</td><td>${formatCurrency(i.price)}</td><td>${formatCurrency(i.price * i.qty)}</td></tr>`).join('')
    : `<tr><td>${escapeHtml(order.product || '—')}</td><td>1</td><td>${formatCurrency(order.amount)}</td><td>${formatCurrency(order.amount)}</td></tr>`;
  win.document.write(`
    <html><head><title>Invoice — Order #${escapeHtml(order.id.slice(-8))}</title>
    <style>
      body{font-family:Arial,sans-serif; padding:40px; color:#241712;}
      h1{font-size:1.4rem; margin-bottom:4px;} .sub{color:#888; margin-bottom:30px;}
      table{width:100%; border-collapse:collapse; margin-top:20px;}
      th,td{text-align:left; padding:10px; border-bottom:1px solid #ddd; font-size:0.9rem;}
      .grid{display:flex; justify-content:space-between; margin-bottom:20px;}
      .total{text-align:right; font-size:1.1rem; font-weight:bold; margin-top:16px;}
    </style></head><body>
      <h1>Dion Diamond Maker</h1>
      <div class="sub">Tax Invoice — Order #${escapeHtml(order.id.slice(-8))}</div>
      <div class="grid">
        <div><strong>Bill To:</strong><br>${escapeHtml(order.name)}<br>${escapeHtml(order.address)}<br>${escapeHtml(order.city)}, ${escapeHtml(order.state)} - ${escapeHtml(order.pincode)}<br>${escapeHtml(order.phone)}</div>
        <div><strong>Date:</strong> ${formatDate(order.createdAt)}<br><strong>Payment ID:</strong> ${escapeHtml(order.paymentId || '—')}<br><strong>Status:</strong> ${escapeHtml(order.status || 'Pending')}</div>
      </div>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${itemsRows}</tbody></table>
      <div class="total">Grand Total: ${formatCurrency(order.amount)}</div>
      <script>window.onload = () => window.print();</script>
    </body></html>
  `);
  win.document.close();
}
  });
}
