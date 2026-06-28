// ============================================================
// DION DIAMOND MAKER ADMIN — Product Management
// ============================================================
import { db, storage, fbReady } from './firebase-init.js';
import { escapeHtml, slugify, formatCurrency, toast, confirmDialog, setButtonLoading, paginate, renderPaginationControls, debounce, initImageUploader, LOW_STOCK_THRESHOLD } from './utils.js';

let products = [];
let categories = [];
let currentPage = 1;
const PAGE_SIZE = 10;
let filters = { search: '', category: '', status: '' };
let containerEl = null;
let selectedIds = new Set();

export function init(container) {
  containerEl = container;
  container.innerHTML = `
    <div class="panel-toolbar">
      <input type="text" id="prodSearch" class="input" placeholder="Search products by name or SKU..." />
      <select id="prodCategoryFilter" class="input input-select"><option value="">All Categories</option></select>
      <select id="prodStatusFilter" class="input input-select">
        <option value="">All Status</option>
        <option value="active">Active</option>
        <option value="draft">Draft</option>
      </select>
      <button class="btn-primary" id="prodAddBtn">+ Add Product</button>
    </div>
    <div class="bulk-bar" id="prodBulkBar" style="display:none;">
      <span id="prodBulkCount">0 selected</span>
      <button class="btn-secondary btn-sm" id="prodBulkActive">Set Active</button>
      <button class="btn-secondary btn-sm" id="prodBulkDraft">Set Draft</button>
      <button class="btn-danger btn-sm" id="prodBulkDelete">Delete Selected</button>
      <button class="btn-secondary btn-sm" id="prodBulkClear">Clear Selection</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th><input type="checkbox" id="prodSelectAll"></th><th></th><th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="prodTableBody"><tr><td colspan="9" class="empty-state">Loading products...</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="prodPagination"></div>
  `;

  document.getElementById('prodAddBtn').addEventListener('click', () => openProductForm());
  document.getElementById('prodSearch').addEventListener('input', debounce((e) => {
    filters.search = e.target.value.trim().toLowerCase();
    currentPage = 1;
    renderList();
  }, 250));
  document.getElementById('prodCategoryFilter').addEventListener('change', (e) => {
    filters.category = e.target.value; currentPage = 1; renderList();
  });
  document.getElementById('prodStatusFilter').addEventListener('change', (e) => {
    filters.status = e.target.value; currentPage = 1; renderList();
  });
  document.getElementById('prodSelectAll').addEventListener('change', (e) => {
    const { pageItems } = paginate(filteredProducts(), currentPage, PAGE_SIZE);
    pageItems.forEach(p => e.target.checked ? selectedIds.add(p.id) : selectedIds.delete(p.id));
    renderList();
  });
  document.getElementById('prodBulkClear').addEventListener('click', () => { selectedIds.clear(); renderList(); });
  document.getElementById('prodBulkActive').addEventListener('click', () => bulkSetStatus('active'));
  document.getElementById('prodBulkDraft').addEventListener('click', () => bulkSetStatus('draft'));
  document.getElementById('prodBulkDelete').addEventListener('click', () => bulkDelete());

  if (!fbReady) {
    document.getElementById('prodTableBody').innerHTML = `<tr><td colspan="8" class="empty-state">Firebase isn't connected — check firebase-config.js</td></tr>`;
    return;
  }

  db.collection('categories').orderBy('name').onSnapshot((snap) => {
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const sel = document.getElementById('prodCategoryFilter');
    if (sel) {
      const current = sel.value;
      sel.innerHTML = '<option value="">All Categories</option>' + categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
      sel.value = current;
    }
  }, (e) => console.error('Categories load error:', e));

  db.collection('products').orderBy('createdAt', 'desc').onSnapshot((snap) => {
    products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
    window.dispatchEvent(new CustomEvent('admin:products-updated', { detail: { products } }));
  }, (e) => {
    console.error('Products load error:', e);
    document.getElementById('prodTableBody').innerHTML = `<tr><td colspan="8" class="empty-state">Failed to load products: ${escapeHtml(e.message)}</td></tr>`;
  });
}

export function getProducts() { return products; }

function filteredProducts() {
  return products.filter(p => {
    if (filters.search && !(`${p.name} ${p.sku}`.toLowerCase().includes(filters.search))) return false;
    if (filters.category && p.category !== filters.category) return false;
    if (filters.status && p.status !== filters.status) return false;
    return true;
  });
}

function renderList() {
  const tbody = document.getElementById('prodTableBody');
  if (!tbody) return;
  const list = filteredProducts();
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No products found. ${products.length === 0 ? 'Click "+ Add Product" to create your first one.' : 'Try clearing your filters.'}</td></tr>`;
    renderPaginationControls('prodPagination', 1, 1, () => {});
    return;
  }
  const { pageItems, page, totalPages } = paginate(list, currentPage, PAGE_SIZE);
  currentPage = page;
  tbody.innerHTML = pageItems.map(p => {
    const primaryImg = (p.images || []).find(im => im.isPrimary) || (p.images || [])[0];
    const totalStock = (p.variants && p.variants.length) ? p.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0) : (Number(p.stock) || 0);
    const lowStock = totalStock <= LOW_STOCK_THRESHOLD;
    return `
      <tr>
        <td><input type="checkbox" class="prod-row-check" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''}></td>
        <td><div class="row-thumb">${primaryImg ? `<img src="${primaryImg.url}" alt="">` : '<div class="row-thumb-empty">No image</div>'}</div></td>
        <td><div class="row-title">${escapeHtml(p.name)}</div>${p.variants?.length ? `<div class="row-sub">${p.variants.length} variant${p.variants.length > 1 ? 's' : ''}</div>` : ''}</td>
        <td>${escapeHtml(p.sku || '—')}</td>
        <td>${escapeHtml(p.category || '—')}</td>
        <td>${formatCurrency(p.price)}${p.comparePrice ? `<div class="row-sub strike">${formatCurrency(p.comparePrice)}</div>` : ''}</td>
        <td><span class="${lowStock ? 'stock-low' : ''}">${totalStock}</span></td>
        <td><span class="badge ${p.status === 'active' ? 'badge-delivered' : 'badge-pending'}">${p.status === 'active' ? 'Active' : 'Draft'}</span></td>
        <td class="row-actions">
          <button class="icon-btn" data-act="edit" data-id="${p.id}">Edit</button>
          <button class="icon-btn" data-act="duplicate" data-id="${p.id}">Duplicate</button>
          <button class="icon-btn danger" data-act="delete" data-id="${p.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openProductForm(products.find(p => p.id === b.dataset.id))));
  tbody.querySelectorAll('[data-act="duplicate"]').forEach(b => b.addEventListener('click', () => duplicateProduct(products.find(p => p.id === b.dataset.id))));
  tbody.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => deleteProduct(products.find(p => p.id === b.dataset.id))));
  tbody.querySelectorAll('.prod-row-check').forEach(cb => cb.addEventListener('change', () => {
    cb.checked ? selectedIds.add(cb.dataset.id) : selectedIds.delete(cb.dataset.id);
    updateBulkBar();
  }));

  renderPaginationControls('prodPagination', page, totalPages, (newPage) => { currentPage = newPage; renderList(); });
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('prodBulkBar');
  if (!bar) return;
  if (selectedIds.size === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  document.getElementById('prodBulkCount').textContent = `${selectedIds.size} selected`;
}

async function bulkSetStatus(status) {
  const ok = await confirmDialog(`Set ${selectedIds.size} product(s) to "${status}"?`, { title: 'Bulk update', danger: false, confirmLabel: 'Update' });
  if (!ok) return;
  try {
    await Promise.all([...selectedIds].map(id => db.collection('products').doc(id).update({ status })));
    toast(`${selectedIds.size} product(s) updated`, 'success');
    selectedIds.clear();
  } catch (e) { toast('Bulk update failed: ' + e.message, 'error'); }
}

async function bulkDelete() {
  const ok = await confirmDialog(`Delete ${selectedIds.size} product(s) and all their images? This cannot be undone.`, { title: 'Bulk delete', confirmLabel: 'Delete All' });
  if (!ok) return;
  try {
    const toDelete = products.filter(p => selectedIds.has(p.id));
    await Promise.all(toDelete.map(p => db.collection('products').doc(p.id).delete()));
    for (const p of toDelete) {
      for (const img of (p.images || [])) {
        if (img.path) { try { await storage.ref(img.path).delete(); } catch (e) { /* non-fatal */ } }
      }
    }
    toast(`${toDelete.length} product(s) deleted`, 'success');
    selectedIds.clear();
  } catch (e) { toast('Bulk delete failed: ' + e.message, 'error'); }
}

// ---------------- ADD / EDIT FORM ----------------
function openProductForm(product = null) {
  const isEdit = !!product;
  const p = product || { name: '', slug: '', sku: '', barcode: '', category: '', shortDescription: '', description: '', directions: '', warnings: '', price: 0, comparePrice: 0, offerPrice: 0, stock: 0, trackInventory: true, images: [], variants: [], ingredients: [], benefits: [], seo: { title: '', description: '', slug: '' }, status: 'draft', featured: false };

  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal-box modal-lg">
      <h3>${isEdit ? 'Edit Product' : 'Add Product'}</h3>
      <div class="form-grid">
        <div class="form-col-wide">
          <label>Image Gallery</label>
          <div class="img-dropzone" id="pfDropZone">
            <p>Drag & drop images here, or click to browse</p>
            <input type="file" id="pfFileInput" accept="image/*" multiple hidden>
          </div>
          <div class="img-thumb-list" id="pfImageList"></div>
        </div>

        <div>
          <label>Product Name *</label>
          <input type="text" id="pfName" class="input" value="${escapeHtml(p.name)}" maxlength="120">
        </div>
        <div>
          <label>SKU *</label>
          <input type="text" id="pfSku" class="input" value="${escapeHtml(p.sku)}" maxlength="40">
        </div>
        <div>
          <label>Barcode <span class="label-hint">(EAN/UPC, optional)</span></label>
          <input type="text" id="pfBarcode" class="input" value="${escapeHtml(p.barcode || '')}" maxlength="40">
        </div>

        <div>
          <label>Category</label>
          <div class="input-with-btn">
            <select id="pfCategory" class="input input-select">
              <option value="">— None —</option>
              ${categories.map(c => `<option value="${escapeHtml(c.name)}" ${p.category === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
            <button type="button" class="btn-secondary btn-sm" id="pfNewCategoryBtn">+ New</button>
          </div>
        </div>
        <div>
          <label>Status</label>
          <select id="pfStatus" class="input input-select">
            <option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft (hidden from site)</option>
            <option value="active" ${p.status === 'active' ? 'selected' : ''}>Active (visible on site)</option>
          </select>
        </div>

        <div>
          <label>MRP (₹) <span class="label-hint">(shown crossed out)</span></label>
          <input type="number" id="pfComparePrice" class="input" value="${p.comparePrice || ''}" min="0" step="1">
        </div>
        <div>
          <label>Sale Price (₹) *</label>
          <input type="number" id="pfPrice" class="input" value="${p.price || ''}" min="0" step="1">
        </div>
        <div class="form-col-wide">
          <label>Offer Price (₹) <span class="label-hint">(optional — limited-time price, overrides Sale Price on the site when set)</span></label>
          <input type="number" id="pfOfferPrice" class="input" value="${p.offerPrice || ''}" min="0" step="1" placeholder="Leave blank if no current offer">
        </div>

        <div>
          <label>Stock Quantity</label>
          <input type="number" id="pfStock" class="input" value="${p.stock || 0}" min="0" step="1" ${p.variants?.length ? 'disabled title="Managed per-variant below"' : ''}>
        </div>
        <div>
          <label class="checkbox-label"><input type="checkbox" id="pfTrackInventory" ${p.trackInventory !== false ? 'checked' : ''}> Track inventory for this product</label>
        </div>

        <div class="form-col-wide">
          <label>Variants <span class="label-hint">(e.g. different pack sizes, colors, sizes — leave empty if this product has none)</span></label>
          <div id="pfVariantsList"></div>
          <button type="button" class="btn-secondary btn-sm" id="pfAddVariantBtn">+ Add Variant</button>
        </div>

        <div class="form-col-wide">
          <label>Short Description <span class="label-hint">(shown on product card)</span></label>
          <textarea id="pfShortDesc" class="input" rows="2" maxlength="200">${escapeHtml(p.shortDescription)}</textarea>
        </div>
        <div class="form-col-wide">
          <label>Full Description</label>
          <textarea id="pfDesc" class="input" rows="4" maxlength="2000">${escapeHtml(p.description)}</textarea>
        </div>
        <div class="form-col-wide">
          <label>Directions to Use</label>
          <textarea id="pfDirections" class="input" rows="2" maxlength="500">${escapeHtml(p.directions || '')}</textarea>
        </div>
        <div class="form-col-wide">
          <label>Warnings <span class="label-hint">(e.g. allergy info, contraindications)</span></label>
          <textarea id="pfWarnings" class="input" rows="2" maxlength="500">${escapeHtml(p.warnings || '')}</textarea>
        </div>

        <div class="form-col-wide">
          <label>Ingredients <span class="label-hint">(press Enter after each one)</span></label>
          <div class="tag-input" id="pfIngredients" data-field="ingredients"></div>
        </div>
        <div class="form-col-wide">
          <label>Benefits <span class="label-hint">(press Enter after each one)</span></label>
          <div class="tag-input" id="pfBenefits" data-field="benefits"></div>
        </div>

        <div class="form-col-wide"><hr class="form-divider"><label class="section-label">SEO</label></div>
        <div class="form-col-wide">
          <label>SEO Title</label>
          <input type="text" id="pfSeoTitle" class="input" value="${escapeHtml(p.seo?.title)}" maxlength="70">
        </div>
        <div class="form-col-wide">
          <label>SEO Description</label>
          <textarea id="pfSeoDesc" class="input" rows="2" maxlength="160">${escapeHtml(p.seo?.description)}</textarea>
        </div>
        <div class="form-col-wide">
          <label>URL Slug</label>
          <input type="text" id="pfSeoSlug" class="input" value="${escapeHtml(p.seo?.slug || p.slug || slugify(p.name))}" maxlength="80">
        </div>

        <div class="form-col-wide">
          <label class="checkbox-label"><input type="checkbox" id="pfFeatured" ${p.featured ? 'checked' : ''}> Feature this product on the homepage</label>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn-primary" id="pfSaveBtn">${isEdit ? 'Save Changes' : 'Create Product'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('show'));

  // Image uploader
  let currentUploader = initImageUploader({
    dropZoneEl: bg.querySelector('#pfDropZone'),
    fileInputEl: bg.querySelector('#pfFileInput'),
    previewListEl: bg.querySelector('#pfImageList'),
    storage,
    storagePathPrefix: `products/${isEdit ? product.id : 'new_' + Date.now()}`,
    initialImages: p.images || [],
    onChange: () => {}
  });

  // Tag inputs (ingredients / benefits)
  setupTagInput(bg.querySelector('#pfIngredients'), p.ingredients || []);
  setupTagInput(bg.querySelector('#pfBenefits'), p.benefits || []);

  // Variants
  let variants = (p.variants || []).map(v => ({ ...v }));
  const variantsListEl = bg.querySelector('#pfVariantsList');
  function renderVariants() {
    variantsListEl.innerHTML = variants.map((v, i) => `
      <div class="variant-row" data-index="${i}">
        <input type="text" class="input" placeholder="Variant name (e.g. 60 Capsules)" value="${escapeHtml(v.name || '')}" data-vfield="name">
        <input type="text" class="input" placeholder="Color" value="${escapeHtml(v.color || '')}" data-vfield="color">
        <input type="text" class="input" placeholder="Size" value="${escapeHtml(v.size || '')}" data-vfield="size">
        <input type="text" class="input" placeholder="SKU" value="${escapeHtml(v.sku || '')}" data-vfield="sku">
        <input type="number" class="input" placeholder="Price" value="${v.price || ''}" min="0" data-vfield="price">
        <input type="number" class="input" placeholder="Stock" value="${v.stock || ''}" min="0" data-vfield="stock">
        <button type="button" class="icon-btn danger" data-vremove="${i}">✕</button>
      </div>
    `).join('');
    variantsListEl.querySelectorAll('[data-vremove]').forEach(btn => {
      btn.addEventListener('click', () => { variants.splice(Number(btn.dataset.vremove), 1); renderVariants(); toggleStockField(); });
    });
    variantsListEl.querySelectorAll('[data-vfield]').forEach(input => {
      input.addEventListener('input', () => {
        const row = input.closest('.variant-row');
        const idx = Number(row.dataset.index);
        variants[idx][input.dataset.vfield] = input.type === 'number' ? Number(input.value) : input.value;
      });
    });
  }
  function toggleStockField() {
    const stockInput = bg.querySelector('#pfStock');
    stockInput.disabled = variants.length > 0;
    stockInput.title = variants.length > 0 ? 'Managed per-variant above' : '';
  }
  renderVariants();
  bg.querySelector('#pfAddVariantBtn').addEventListener('click', () => {
    variants.push({ name: '', sku: '', price: Number(bg.querySelector('#pfPrice').value) || 0, stock: 0 });
    renderVariants(); toggleStockField();
  });

  // New category inline
  bg.querySelector('#pfNewCategoryBtn').addEventListener('click', async () => {
    const name = prompt('New category name:');
    if (!name || !name.trim()) return;
    try {
      await db.collection('categories').add({ name: name.trim(), slug: slugify(name), createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast('Category added', 'success');
    } catch (e) { toast('Failed to add category: ' + e.message, 'error'); }
  });

  // Auto-fill SEO slug from name if user hasn't customized it
  bg.querySelector('#pfName').addEventListener('input', (e) => {
    const seoSlugEl = bg.querySelector('#pfSeoSlug');
    if (!seoSlugEl.dataset.touched) seoSlugEl.value = slugify(e.target.value);
  });
  bg.querySelector('#pfSeoSlug').addEventListener('input', (e) => { e.target.dataset.touched = '1'; });

  function close() { bg.classList.remove('show'); setTimeout(() => bg.remove(), 200); }
  function closeWithoutSaving() {
    currentUploader?.rollback(); // deletes only this session's unsaved uploads — saved images are untouched
    close();
  }
  bg.querySelector('[data-action="cancel"]').addEventListener('click', closeWithoutSaving);
  bg.addEventListener('click', (e) => { if (e.target === bg) closeWithoutSaving(); });

  bg.querySelector('#pfSaveBtn').addEventListener('click', async () => {
    const saveBtn = bg.querySelector('#pfSaveBtn');
    const name = bg.querySelector('#pfName').value.trim();
    const sku = bg.querySelector('#pfSku').value.trim();
    const price = Number(bg.querySelector('#pfPrice').value);
    if (!name) { toast('Product name is required.', 'error'); return; }
    if (!sku) { toast('SKU is required.', 'error'); return; }
    if (!price || price <= 0) { toast('Please enter a valid price.', 'error'); return; }

    // SKU uniqueness check (against other products, case-insensitive)
    const dupSku = products.find(other => other.id !== (isEdit ? product.id : null) && (other.sku || '').toLowerCase() === sku.toLowerCase());
    if (dupSku) { toast(`SKU "${sku}" is already used by "${dupSku.name}".`, 'error'); return; }

    // Variant SKUs must be unique within this product too (empty/blank variant SKUs are allowed and ignored here)
    const variantSkus = variants.filter(v => v.name && v.sku).map(v => v.sku.toLowerCase());
    const dupVariantSku = variantSkus.find((s, i) => variantSkus.indexOf(s) !== i);
    if (dupVariantSku) { toast(`Two variants both use SKU "${dupVariantSku}" — each variant needs its own SKU.`, 'error'); return; }

    // Slug uniqueness (slug = name auto-converted to URL form, used by the homepage
    // auto-sync to match a product to its price/buy-button — a collision would make
    // the live site show whichever matching product Firestore happens to return last).
    const newSlug = slugify(name);
    const dupSlug = products.find(other => other.id !== (isEdit ? product.id : null) && other.slug === newSlug);
    if (dupSlug) { toast(`A product named "${dupSlug.name}" already maps to this same URL slug. Use a different name.`, 'error'); return; }

    setButtonLoading(saveBtn, true);
    try {
      const data = {
        name, sku, price,
        comparePrice: Number(bg.querySelector('#pfComparePrice').value) || 0,
        offerPrice: Number(bg.querySelector('#pfOfferPrice').value) || 0,
        barcode: bg.querySelector('#pfBarcode').value.trim(),
        directions: bg.querySelector('#pfDirections').value.trim(),
        warnings: bg.querySelector('#pfWarnings').value.trim(),
        stock: Math.max(0, Number(bg.querySelector('#pfStock').value) || 0),
        trackInventory: bg.querySelector('#pfTrackInventory').checked,
        category: bg.querySelector('#pfCategory').value,
        status: bg.querySelector('#pfStatus').value,
        featured: bg.querySelector('#pfFeatured').checked,
        shortDescription: bg.querySelector('#pfShortDesc').value.trim(),
        description: bg.querySelector('#pfDesc').value.trim(),
        ingredients: getTagInputValues(bg.querySelector('#pfIngredients')),
        benefits: getTagInputValues(bg.querySelector('#pfBenefits')),
        variants: variants.filter(v => v.name).map(v => ({ ...v, stock: Math.max(0, Number(v.stock) || 0) })),
        images: currentUploader.getImages(),
        slug: slugify(name),
        seo: {
          title: bg.querySelector('#pfSeoTitle').value.trim(),
          description: bg.querySelector('#pfSeoDesc').value.trim(),
          slug: bg.querySelector('#pfSeoSlug').value.trim() || slugify(name)
        },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (isEdit) {
        await db.collection('products').doc(product.id).update(data);
        toast('Product updated', 'success');
      } else {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('products').add(data);
        toast('Product created', 'success');
      }
      await currentUploader.commit(); // now safe to actually delete any replaced/removed old images
      close();
    } catch (e) {
      console.error(e);
      toast('Save failed: ' + e.message, 'error');
      setButtonLoading(saveBtn, false);
    }
  });
}

function setupTagInput(container, initialTags) {
  let tags = [...initialTags];
  container.dataset.tags = JSON.stringify(tags);
  function render() {
    container.innerHTML = tags.map((t, i) => `<span class="tag-chip">${escapeHtml(t)}<button type="button" data-remove="${i}">✕</button></span>`).join('') +
      `<input type="text" class="tag-input-field" placeholder="Type and press Enter...">`;
    container.dataset.tags = JSON.stringify(tags);
    container.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => { tags.splice(Number(btn.dataset.remove), 1); render(); }));
    const input = container.querySelector('.tag-input-field');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        tags.push(input.value.trim());
        render();
        container.querySelector('.tag-input-field').focus();
      } else if (e.key === 'Backspace' && !input.value && tags.length) {
        tags.pop(); render();
      }
    });
  }
  render();
}
function getTagInputValues(container) { return JSON.parse(container.dataset.tags || '[]'); }

async function duplicateProduct(product) {
  if (!product) return;
  try {
    const copy = { ...product };
    delete copy.id;
    copy.name = product.name + ' (Copy)';
    copy.sku = product.sku + '-COPY-' + Date.now().toString().slice(-4);
    copy.status = 'draft';
    copy.slug = slugify(copy.name);
    // Images are NOT copied — they'd point at the exact same Storage files as
    // the original, so deleting/replacing an image on either product would
    // silently break the other's gallery too. Duplicate starts image-less;
    // re-upload on the copy if needed.
    copy.images = [];
    copy.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    copy.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('products').add(copy);
    toast('Product duplicated as draft (re-add images on the copy)', 'success');
  } catch (e) { toast('Duplicate failed: ' + e.message, 'error'); }
}

async function deleteProduct(product) {
  if (!product) return;
  const ok = await confirmDialog(`Delete "${product.name}"? This also removes all its images. This cannot be undone.`, { title: 'Delete product', confirmLabel: 'Delete' });
  if (!ok) return;
  try {
    await db.collection('products').doc(product.id).delete();
    for (const img of (product.images || [])) {
      if (img.path) { try { await storage.ref(img.path).delete(); } catch (e) { /* non-fatal */ } }
    }
    toast('Product deleted', 'success');
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}
