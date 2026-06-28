// ============================================================
// DION DIAMOND MAKER ADMIN — Coupons
// ============================================================
// Coupon doc ID = the code itself (uppercased) — lets the storefront
// look up a single coupon by code (db.collection('coupons').doc(code).get())
// without needing list/read access to the whole collection.
import { db, fbReady } from './firebase-init.js';
import { escapeHtml, formatCurrency, formatDate, toast, confirmDialog, setButtonLoading } from './utils.js';

let coupons = [];

export function init(container) {
  container.innerHTML = `
    <div class="panel-toolbar">
      <p class="toolbar-hint">Discount codes customers can apply at checkout.</p>
      <button class="btn-primary" id="couponAddBtn">+ Add Coupon</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Code</th><th>Discount</th><th>Min. Order</th><th>Usage</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody id="couponTableBody"><tr><td colspan="7" class="empty-state">Loading coupons...</td></tr></tbody>
      </table>
    </div>
  `;
  document.getElementById('couponAddBtn').addEventListener('click', () => openCouponForm());

  if (!fbReady) {
    document.getElementById('couponTableBody').innerHTML = `<tr><td colspan="7" class="empty-state">Firebase isn't connected.</td></tr>`;
    return;
  }
  db.collection('coupons').orderBy('createdAt', 'desc').onSnapshot((snap) => {
    coupons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, (e) => {
    console.error('Coupons load error:', e);
    document.getElementById('couponTableBody').innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load: ${escapeHtml(e.message)}</td></tr>`;
  });
}

function render() {
  const tbody = document.getElementById('couponTableBody');
  if (!tbody) return;
  if (coupons.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No coupons yet. Click "+ Add Coupon" to create one.</td></tr>`;
    return;
  }
  tbody.innerHTML = coupons.map(c => {
    const expired = c.expiresAt && c.expiresAt.toDate && c.expiresAt.toDate() < new Date();
    const usedUp = c.maxUses && (c.usedCount || 0) >= c.maxUses;
    const isLive = c.active && !expired && !usedUp;
    return `
      <tr>
        <td><code class="order-id">${escapeHtml(c.id)}</code></td>
        <td>${c.type === 'percent' ? c.value + '% off' : formatCurrency(c.value) + ' off'}</td>
        <td>${c.minOrderValue ? formatCurrency(c.minOrderValue) : '—'}</td>
        <td>${c.usedCount || 0}${c.maxUses ? ' / ' + c.maxUses : ''}</td>
        <td>${c.expiresAt ? formatDate(c.expiresAt).split(' · ')[0] : 'Never'}</td>
        <td><span class="badge ${isLive ? 'badge-delivered' : 'badge-cancelled'}">${isLive ? 'Active' : expired ? 'Expired' : usedUp ? 'Used up' : 'Disabled'}</span></td>
        <td class="row-actions">
          <button class="icon-btn" data-act="edit" data-id="${c.id}">Edit</button>
          <button class="icon-btn danger" data-act="delete" data-id="${c.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
  tbody.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openCouponForm(coupons.find(c => c.id === b.dataset.id))));
  tbody.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => deleteCoupon(coupons.find(c => c.id === b.dataset.id))));
}

function openCouponForm(coupon = null) {
  const isEdit = !!coupon;
  const c = coupon || { id: '', type: 'percent', value: 10, minOrderValue: 0, maxUses: '', expiresAt: '', active: true };
  const expiresDateStr = c.expiresAt?.toDate ? c.expiresAt.toDate().toISOString().slice(0, 10) : '';

  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal-box">
      <h3>${isEdit ? 'Edit Coupon' : 'Add Coupon'}</h3>
      <div class="form-grid">
        <div class="form-col-wide">
          <label>Coupon Code *</label>
          <input type="text" id="cpCode" class="input" value="${escapeHtml(c.id)}" maxlength="20" ${isEdit ? 'disabled' : ''} placeholder="e.g. WELCOME10" style="text-transform:uppercase;">
        </div>
        <div>
          <label>Discount Type</label>
          <select id="cpType" class="input input-select">
            <option value="percent" ${c.type === 'percent' ? 'selected' : ''}>Percentage (%)</option>
            <option value="flat" ${c.type === 'flat' ? 'selected' : ''}>Flat Amount (₹)</option>
          </select>
        </div>
        <div>
          <label>Discount Value *</label>
          <input type="number" id="cpValue" class="input" value="${c.value}" min="0">
        </div>
        <div>
          <label>Minimum Order Value (₹)</label>
          <input type="number" id="cpMinOrder" class="input" value="${c.minOrderValue || 0}" min="0">
        </div>
        <div>
          <label>Max Uses <span class="label-hint">(blank = unlimited)</span></label>
          <input type="number" id="cpMaxUses" class="input" value="${c.maxUses || ''}" min="1">
        </div>
        <div>
          <label>Per-Customer Limit</label>
          <select id="cpUsagePerCustomer" class="input input-select">
            <option value="unlimited" ${c.usagePerCustomer !== 'once' ? 'selected' : ''}>Unlimited (same customer can reuse)</option>
            <option value="once" ${c.usagePerCustomer === 'once' ? 'selected' : ''}>One time per customer (by phone number)</option>
          </select>
        </div>
        <div class="form-col-wide">
          <label>Expiry Date <span class="label-hint">(blank = never expires)</span></label>
          <input type="date" id="cpExpires" class="input" value="${expiresDateStr}">
        </div>
        <div class="form-col-wide">
          <label class="checkbox-label"><input type="checkbox" id="cpActive" ${c.active !== false ? 'checked' : ''}> Active</label>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn-primary" id="cpSaveBtn">${isEdit ? 'Save Changes' : 'Create Coupon'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('show'));
  function close() { bg.classList.remove('show'); setTimeout(() => bg.remove(), 200); }
  bg.querySelector('[data-action="cancel"]').addEventListener('click', close);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });

  bg.querySelector('#cpSaveBtn').addEventListener('click', async () => {
    const saveBtn = bg.querySelector('#cpSaveBtn');
    const code = bg.querySelector('#cpCode').value.trim().toUpperCase();
    const value = Number(bg.querySelector('#cpValue').value);
    const type = bg.querySelector('#cpType').value;
    if (!code) { toast('Coupon code is required.', 'error'); return; }
    if (!value || value <= 0) { toast('Please enter a valid discount value.', 'error'); return; }
    if (type === 'percent' && value > 100) { toast('Percentage discount can\'t exceed 100%.', 'error'); return; }
    if (!isEdit && coupons.some(existing => existing.id === code)) { toast(`Coupon "${code}" already exists.`, 'error'); return; }

    setButtonLoading(saveBtn, true);
    try {
      const expiresStr = bg.querySelector('#cpExpires').value;
      const data = {
        type, value,
        minOrderValue: Number(bg.querySelector('#cpMinOrder').value) || 0,
        maxUses: Number(bg.querySelector('#cpMaxUses').value) || null,
        usagePerCustomer: bg.querySelector('#cpUsagePerCustomer').value,
        expiresAt: expiresStr ? firebase.firestore.Timestamp.fromDate(new Date(expiresStr + 'T23:59:59')) : null,
        active: bg.querySelector('#cpActive').checked,
        usedCount: coupon?.usedCount || 0
      };
      if (isEdit) {
        await db.collection('coupons').doc(code).update(data);
        toast('Coupon updated', 'success');
      } else {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        // Transaction closes the race window where two admins create the same
        // code at the same instant — the earlier client-side check alone could
        // miss that and let the second write silently overwrite the first.
        const ref = db.collection('coupons').doc(code);
        await db.runTransaction(async (t) => {
          const existing = await t.get(ref);
          if (existing.exists) throw new Error(`Coupon "${code}" already exists.`);
          t.set(ref, data);
        });
        toast('Coupon created', 'success');
      }
      close();
    } catch (e) {
      toast('Save failed: ' + e.message, 'error');
      setButtonLoading(saveBtn, false);
    }
  });
}

async function deleteCoupon(coupon) {
  if (!coupon) return;
  const ok = await confirmDialog(`Delete coupon "${coupon.id}"? This cannot be undone.`, { title: 'Delete coupon', confirmLabel: 'Delete' });
  if (!ok) return;
  try {
    await db.collection('coupons').doc(coupon.id).delete();
    toast('Coupon deleted', 'success');
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}
