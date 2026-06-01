/* ============================================================
   LOADOUT — Packing List Engine
   Fetches Google Sheet data, renders the interactive table,
   handles context tips, counters, and Amazon cart generation.
   ============================================================ */

'use strict';

// ── Config ──────────────────────────────────────────────────
// Column header names as they appear in the Google Sheet
const COL = {
  ITEM:       'ITEM',
  QUANTITY:   'QUANTITY',
  MANDATORY:  'M/O',        // 'M' = mandatory, 'O' = optional
  RECOMMENDED:'Recommended', // quantity to pre-fill in cart
  LINK:       'LINK',
  ASIN:       'ASIN',       // explicit ASIN (preferred over extraction)
  CONTEXT:    'THOUGHTS',   // Field Intel tips
};

// ── State ────────────────────────────────────────────────────
let rows       = [];   // parsed sheet rows: [{...columnData}]
let headers    = [];   // column names from row 0
let checkedSet = new Set(); // indices of checked rows

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const sheetUrl = document.querySelector('meta[name="sheet-url"]')?.content;
  const pdfUrl   = document.querySelector('meta[name="pdf-url"]')?.content;

  if (!sheetUrl) {
    showError('No sheet URL configured for this course.');
    return;
  }

  if (pdfUrl) {
    const pdfLink = document.getElementById('pdf-link');
    if (pdfLink) pdfLink.href = pdfUrl;
  }

  loadPackingList(sheetUrl);
  initCartActions();
});

// ── Data Loading ─────────────────────────────────────────────
async function loadPackingList(sheetUrl) {
  // If opened directly as a file (not from a web server), the browser
  // will block external fetch requests. Catch this early and explain.
  if (window.location.protocol === 'file:') {
    showError(
      'This page needs to be served from a web server to load packing list data. ' +
      'Open it through your hosting provider or a local server — not directly from your file system.'
    );
    return;
  }

  showLoading(true);
  let loaded = false;
  try {
    const resp = await fetch(sheetUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const tsv = await resp.text();
    parseAndRender(tsv);
    loaded = true;
  } catch (err) {
    console.error('Failed to load packing list:', err);
    showError(
      'Could not load packing list data. ' +
      'Please check your internet connection and try refreshing the page.'
    );
  } finally {
    // Only hide the loading spinner on success — on error, showError()
    // manages the display state and we don't want to override it.
    if (loaded) showLoading(false);
  }
}

// ── Parsing ──────────────────────────────────────────────────
function parseAndRender(tsv) {
  const allRows = tsv.trim().split('\n').map(r => r.split('\t').map(c => c.trim()));
  if (allRows.length < 2) { showError('Packing list appears to be empty.'); return; }

  headers = allRows[0];
  rows    = allRows.slice(1).filter(r => r.some(c => c.length > 0));

  // Convert each row to an object keyed by header name
  rows = rows.map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] || ''; });
    return obj;
  });

  renderTable();
  updateCounters();
  // Reveal the cart panel now that we have data
  const cp = document.getElementById('cart-panel');
  if (cp) cp.classList.remove('hidden');
}

// ── Rendering ────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('packing-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  rows.forEach((row, idx) => {
    const rowType  = getRowType(row);
    const itemName = row[COL.ITEM]     || row[headers[0]] || '—';
    const qty      = row[COL.QUANTITY] || '';
    const recQty   = row[COL.RECOMMENDED] || '1';
    const link     = row[COL.LINK]     || '';
    const context  = row[COL.CONTEXT]  || '';
    const hasLink  = link.length > 0 && link.startsWith('http');
    const hasCtx   = context.length > 0;
    const asin     = row[COL.ASIN] || (hasLink ? extractASIN(link) : '');

    // ── Main row ──
    const tr = document.createElement('tr');
    tr.className = `row-${rowType}`;
    tr.dataset.idx = idx;
    if (checkedSet.has(idx)) tr.classList.add('row-checked');

    tr.innerHTML = `
      <td class="status-bar"><div class="status-bar-inner"></div></td>
      <td class="cell-item">
        <div class="item-name">
          ${hasLink
            ? `<a href="${link}" target="_blank" rel="noopener noreferrer">${itemName}</a>`
            : itemName}
          ${hasCtx ? `<button class="btn-context" onclick="toggleContext(${idx})" data-idx="${idx}">
              Field Intel
            </button>` : ''}
        </div>
      </td>
      <td class="cell-qty">${qty}</td>
      <td class="cell-adj">
        <input
          class="qty-input"
          type="number"
          min="1" max="99"
          value="${parseInt(recQty, 10) || 1}"
          data-idx="${idx}"
          data-asin="${asin}"
          onchange="updateCounters()"
          aria-label="Quantity for ${itemName}"
        >
      </td>
      <td class="cell-check">
        <input
          class="item-checkbox"
          type="checkbox"
          data-idx="${idx}"
          data-type="${rowType}"
          ${checkedSet.has(idx) ? 'checked' : ''}
          onchange="handleCheck(this, ${idx})"
          aria-label="Mark ${itemName} as acquired"
        >
      </td>
    `;

    tbody.appendChild(tr);

    // ── Context row (hidden by default) ──
    if (hasCtx) {
      const ctxTr = document.createElement('tr');
      ctxTr.className = 'context-row hidden';
      ctxTr.id = `ctx-row-${idx}`;
      ctxTr.innerHTML = `
        <td colspan="5">
          <div class="context-panel">
            <div class="context-icon">🎖</div>
            <div>
              <div class="context-label">Field Intel</div>
              <div class="context-text">${context}</div>
            </div>
          </div>
        </td>
      `;
      tbody.appendChild(ctxTr);
    }
  });
}

// ── Row Type ─────────────────────────────────────────────────
function getRowType(row) {
  const m = (row[COL.MANDATORY] || '').toUpperCase().trim();
  if (m === 'M') return 'mandatory';
  return 'optional';
}

// ── Context Toggle ───────────────────────────────────────────
function toggleContext(idx) {
  const ctxRow = document.getElementById(`ctx-row-${idx}`);
  const btn    = document.querySelector(`.btn-context[data-idx="${idx}"]`);
  if (!ctxRow) return;

  const isOpen = !ctxRow.classList.contains('hidden');
  ctxRow.classList.toggle('hidden', isOpen);
  if (btn) btn.classList.toggle('active', !isOpen);
}

// ── Check Handling ───────────────────────────────────────────
function handleCheck(checkbox, idx) {
  const tr = document.querySelector(`tr[data-idx="${idx}"]`);
  if (checkbox.checked) {
    checkedSet.add(idx);
    tr?.classList.add('row-checked');
  } else {
    checkedSet.delete(idx);
    tr?.classList.remove('row-checked');
  }
  updateCounters();
  updateCartButton();
}

// ── Counters ─────────────────────────────────────────────────
function updateCounters() {
  let mandatoryLeft = 0;
  let optionalLeft  = 0;

  rows.forEach((row, idx) => {
    if (!checkedSet.has(idx)) {
      const type = getRowType(row);
      if (type === 'mandatory') mandatoryLeft++;
      else optionalLeft++;
    }
  });

  setText('counter-mandatory', mandatoryLeft);
  setText('counter-optional',  optionalLeft);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Cart ─────────────────────────────────────────────────────
function initCartActions() {
  const btnAll      = document.getElementById('btn-cart-all');
  const btnSelected = document.getElementById('btn-cart-selected');
  const btnMandatory = document.getElementById('btn-cart-mandatory');

  if (btnAll)       btnAll.addEventListener('click',      () => buildCart('all'));
  if (btnSelected)  btnSelected.addEventListener('click', () => buildCart('selected'));
  if (btnMandatory) btnMandatory.addEventListener('click',() => buildCart('mandatory'));
}

function buildCart(mode) {
  const items = [];

  rows.forEach((row, idx) => {
    const qtyInput = document.querySelector(`.qty-input[data-idx="${idx}"]`);
    const checkbox = document.querySelector(`.item-checkbox[data-idx="${idx}"]`);
    const link     = row[COL.LINK] || '';
    const asin     = row[COL.ASIN] || extractASIN(link);
    if (!asin) return;

    const rowType = getRowType(row);
    const qty     = parseInt(qtyInput?.value || '1', 10) || 1;
    const checked = checkbox?.checked || false;

    const include =
      mode === 'all'       ? true :
      mode === 'selected'  ? checked :
      mode === 'mandatory' ? (rowType === 'mandatory') : false;

    if (include) items.push({ asin, qty });
  });

  if (items.length === 0) {
    alert(mode === 'selected'
      ? 'No items checked yet. Check the items you want to add to your cart first.'
      : 'No Amazon items found for this filter.');
    return;
  }

  const cartUrl = buildAmazonCartUrl(items);
  window.open(cartUrl, '_blank', 'noopener,noreferrer');
  updateCartButton();
}

function buildAmazonCartUrl(items) {
  const base   = 'https://www.amazon.com/gp/aws/cart/add.html?';
  const params = items.map(({ asin, qty }, i) =>
    `ASIN.${i + 1}=${encodeURIComponent(asin)}&Quantity.${i + 1}=${qty}`
  ).join('&');
  return base + params;
}

function updateCartButton() {
  const selectedCount = checkedSet.size;
  // Update both the toolbar badge and the cart panel count
  ['selected-count', 'selected-count-cart'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = selectedCount;
  });
}

// ── ASIN Extraction ──────────────────────────────────────────
function extractASIN(url) {
  if (!url) return '';
  try {
    const m = url.match(/\/dp\/([A-Z0-9]{10})/i)
           || url.match(/\/gp\/product\/([A-Z0-9]{10})/i)
           || url.match(/[?&]ASIN=([A-Z0-9]{10})/i)
           || url.match(/\/([A-Z0-9]{10})(?:\/|\?|$)/);
    return m ? m[1].toUpperCase() : '';
  } catch { return ''; }
}

// ── UI Helpers ───────────────────────────────────────────────
function showLoading(show) {
  const el = document.getElementById('loading-state');
  const tb = document.getElementById('table-wrap');
  if (el) el.classList.toggle('hidden', !show);
  if (tb) tb.classList.toggle('hidden',  show);
}

function showError(msg) {
  // Show the error in the loading-state area and hide the spinner
  const el = document.getElementById('loading-state');
  if (el) {
    el.innerHTML = `
      <div class="error-state">
        <h3>Something went sideways</h3>
        <p>${msg}</p>
      </div>`;
    el.classList.remove('hidden');
  }
  // Keep the table hidden — nothing to show
  const tb = document.getElementById('table-wrap');
  if (tb) tb.classList.add('hidden');
  // Also hide the cart panel since there's no data
  const cp = document.getElementById('cart-panel');
  if (cp) cp.classList.add('hidden');
}

// Expose to HTML onclick handlers
window.toggleContext = toggleContext;
window.handleCheck   = handleCheck;
window.buildCart     = buildCart;
window.updateCounters = updateCounters;
