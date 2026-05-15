// ============================================================
// إدارة الوحدات - منطق التطبيق
// ============================================================

const STORAGE_KEY = 'units_manager_v1';

const DEFAULT_STATE = {
  settings: {
    rateTransferred: 0.85,   // معامل ما يخصم من الرصيد
    rateArrived: 0.8173,     // معامل ما يصل للزبون
    paymentStep: 5,          // وحدة الدفع
    commissionTiers: [
      { upTo: 100, fee: 1 },        // إذا كانت الوحدات المحولة < 100 → 1
      { upTo: 200, fee: 1.5 },      // 100 ≤ ... < 200 → 1.5
      { upTo: Infinity, fee: 2 }    // ≥ 200 → 2
    ]
  },
  topUps: [],        // [{ id, date, amount, note }]
  transactions: []   // [{ id, date, name, paid, transferred, arrived, commission, totalDeducted, profit, type, note, settledAt? }]
};

// ============================================================
// التخزين
// ============================================================

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    // ترميم الإعدادات الناقصة
    parsed.settings = { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) };
    if (!Array.isArray(parsed.settings.commissionTiers) || !parsed.settings.commissionTiers.length) {
      parsed.settings.commissionTiers = structuredClone(DEFAULT_STATE.settings.commissionTiers);
    } else {
      // إعادة Infinity من JSON
      parsed.settings.commissionTiers = parsed.settings.commissionTiers.map(t => ({
        upTo: t.upTo === null || t.upTo === undefined ? Infinity : t.upTo,
        fee: Number(t.fee)
      }));
    }
    parsed.topUps = parsed.topUps || [];
    parsed.transactions = parsed.transactions || [];
    return parsed;
  } catch (e) {
    console.error('فشل تحميل الحالة:', e);
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  const serializable = {
    ...state,
    settings: {
      ...state.settings,
      commissionTiers: state.settings.commissionTiers.map(t => ({
        upTo: t.upTo === Infinity ? null : t.upTo,
        fee: t.fee
      }))
    }
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

let state = loadState();

// ============================================================
// المنطق الحسابي
// ============================================================

function computeCommission(transferred) {
  const tiers = [...state.settings.commissionTiers].sort((a, b) => a.upTo - b.upTo);
  for (const tier of tiers) {
    if (transferred < tier.upTo) return tier.fee;
  }
  return tiers[tiers.length - 1].fee;
}

function computeForward(paid) {
  const r = state.settings;
  const transferred = round2(paid * r.rateTransferred);
  const arrived = round2(paid * r.rateArrived);
  const commission = computeCommission(transferred);
  const totalDeducted = round2(transferred + commission);
  const profit = round2(paid - totalDeducted); // التكلفة 1:1
  return { paid, transferred, arrived, commission, totalDeducted, profit };
}

function computeReverse(targetArrived) {
  const r = state.settings;
  if (!targetArrived || targetArrived <= 0) return null;
  const rawPaid = targetArrived / r.rateArrived;
  const paid = Math.ceil(rawPaid / r.paymentStep) * r.paymentStep;
  const fwd = computeForward(paid);
  return { ...fwd, target: targetArrived, excess: round2(fwd.arrived - targetArrived) };
}

function getTotals() {
  const totalTopups = state.topUps.reduce((s, t) => s + Number(t.amount), 0);
  let totalTransferred = 0, totalCommissions = 0, totalDeducted = 0;
  let totalCash = 0, totalDebt = 0;
  let profitRealized = 0, profitExpected = 0;
  let countAll = state.transactions.length;

  for (const tx of state.transactions) {
    totalTransferred += tx.transferred;
    totalCommissions += tx.commission;
    totalDeducted += tx.totalDeducted;
    profitExpected += tx.profit;

    if (tx.type === 'cash' || tx.settledAt) {
      totalCash += tx.paid;
      profitRealized += tx.profit;
    }
    if (tx.type === 'debt' && !tx.settledAt) {
      totalDebt += tx.paid;
    }
  }

  const balance = totalTopups - totalDeducted;

  return {
    totalTopups: round2(totalTopups),
    totalTransferred: round2(totalTransferred),
    totalCommissions: round2(totalCommissions),
    totalDeducted: round2(totalDeducted),
    totalCash: round2(totalCash),
    totalDebt: round2(totalDebt),
    profitRealized: round2(profitRealized),
    profitExpected: round2(profitExpected),
    balance: round2(balance),
    countAll
  };
}

// ============================================================
// مساعدات
// ============================================================

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function fmt(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

function nowIso() { return new Date().toISOString(); }

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ar-SY-u-nu-latn', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.className = 'toast show ' + type;
  el.textContent = msg;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = 'toast'; }, 2200);
}

// ============================================================
// التنقل بين التبويبات
// ============================================================

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    renderAll();
  });
});

// ============================================================
// لوحة التحكم
// ============================================================

function renderDashboard() {
  const t = getTotals();
  document.getElementById('m-balance').textContent = fmt(t.balance);
  document.getElementById('m-topups').textContent = fmt(t.totalTopups);
  document.getElementById('m-transferred').textContent = fmt(t.totalTransferred);
  document.getElementById('m-commissions').textContent = fmt(t.totalCommissions);
  document.getElementById('m-cash').textContent = fmt(t.totalCash);
  document.getElementById('m-debt').textContent = fmt(t.totalDebt);
  document.getElementById('m-profit-realized').textContent = fmt(t.profitRealized);
  document.getElementById('m-profit-expected').textContent = fmt(t.profitExpected);
  document.getElementById('m-count').textContent = fmt(t.countAll, 0);

  // شريط توزيع الرصيد
  const breakdown = document.getElementById('balance-breakdown');
  if (t.totalTopups <= 0) {
    breakdown.innerHTML = '<div class="seg remaining" style="width:100%">لا يوجد رصيد بعد</div>';
  } else {
    const tPct = (t.totalTransferred / t.totalTopups) * 100;
    const cPct = (t.totalCommissions / t.totalTopups) * 100;
    const rPct = Math.max(0, 100 - tPct - cPct);
    breakdown.innerHTML = `
      <div class="seg transferred" style="width:${tPct}%" title="محوَّل">${tPct >= 8 ? 'محوَّل ' + fmt(t.totalTransferred) : ''}</div>
      <div class="seg commission" style="width:${cPct}%" title="عمولة">${cPct >= 8 ? 'عمولة ' + fmt(t.totalCommissions) : ''}</div>
      <div class="seg remaining" style="width:${rPct}%" title="متبقي">${rPct >= 8 ? 'متبقي ' + fmt(t.balance) : ''}</div>
    `;
  }
}

// ============================================================
// عملية جديدة
// ============================================================

const txForm = document.getElementById('new-tx-form');
const txPaid = document.getElementById('tx-paid');
const txName = document.getElementById('tx-name');
const txNote = document.getElementById('tx-note');

txPaid.addEventListener('input', updateTxPreview);
txForm.querySelectorAll('input[name="tx-type"]').forEach(r => r.addEventListener('change', updateTxPreview));

document.querySelectorAll('.quick-amounts button').forEach(b => {
  b.addEventListener('click', () => {
    txPaid.value = b.dataset.amount;
    updateTxPreview();
  });
});

function updateTxPreview() {
  const paid = Number(txPaid.value);
  const step = state.settings.paymentStep;
  const warn = document.getElementById('p-warn');
  const noBal = document.getElementById('p-no-balance');

  if (!paid || paid <= 0) {
    document.getElementById('p-transferred').textContent = '0 وحدة';
    document.getElementById('p-arrived').textContent = '0 وحدة';
    document.getElementById('p-commission').textContent = '0 وحدة';
    document.getElementById('p-deducted').textContent = '0 وحدة';
    document.getElementById('p-profit').textContent = '0 ل.س';
    warn.classList.add('hidden');
    noBal.classList.add('hidden');
    return;
  }

  const f = computeForward(paid);
  document.getElementById('p-transferred').textContent = fmt(f.transferred) + ' وحدة';
  document.getElementById('p-arrived').textContent = fmt(f.arrived) + ' وحدة';
  document.getElementById('p-commission').textContent = fmt(f.commission) + ' وحدة';
  document.getElementById('p-deducted').textContent = fmt(f.totalDeducted) + ' وحدة';
  document.getElementById('p-profit').textContent = fmt(f.profit) + ' ل.س';

  if (paid % step !== 0) warn.classList.remove('hidden');
  else warn.classList.add('hidden');

  const t = getTotals();
  if (f.totalDeducted > t.balance) noBal.classList.remove('hidden');
  else noBal.classList.add('hidden');
}

txForm.addEventListener('submit', e => {
  e.preventDefault();
  const paid = Number(txPaid.value);
  const step = state.settings.paymentStep;

  if (!paid || paid <= 0) return showToast('أدخل مبلغاً صحيحاً', 'danger');
  if (paid % step !== 0) return showToast(`المبلغ يجب أن يكون من مضاعفات ${step}`, 'danger');

  const type = txForm.querySelector('input[name="tx-type"]:checked').value;
  const name = txName.value.trim();
  if (type === 'debt' && !name) return showToast('اسم الزبون مطلوب للدين', 'danger');

  const f = computeForward(paid);
  const t = getTotals();
  if (f.totalDeducted > t.balance) {
    if (!confirm(`الرصيد المتبقي (${fmt(t.balance)}) أقل من المخصوم (${fmt(f.totalDeducted)}). هل تريد المتابعة؟`)) return;
  }

  state.transactions.unshift({
    id: uid(),
    date: nowIso(),
    name: name || (type === 'cash' ? 'زبون نقدي' : ''),
    paid: f.paid,
    transferred: f.transferred,
    arrived: f.arrived,
    commission: f.commission,
    totalDeducted: f.totalDeducted,
    profit: f.profit,
    type,
    note: txNote.value.trim() || null,
    settledAt: null
  });
  saveState();
  txForm.reset();
  updateTxPreview();
  showToast('تم حفظ العملية بنجاح', 'success');
  renderAll();
});

// ============================================================
// الحاسبة العكسية
// ============================================================

const calcTarget = document.getElementById('calc-target');
calcTarget.addEventListener('input', updateCalcPreview);

function updateCalcPreview() {
  const target = Number(calcTarget.value);
  const set = (id, v) => document.getElementById(id).textContent = v;

  if (!target || target <= 0) {
    ['c-paid','c-transferred','c-arrived','c-excess','c-commission','c-deducted','c-profit']
      .forEach(id => set(id, '—'));
    return;
  }

  const r = computeReverse(target);
  if (!r) return;
  set('c-paid', fmt(r.paid) + ' ل.س');
  set('c-transferred', fmt(r.transferred) + ' وحدة');
  set('c-arrived', fmt(r.arrived) + ' وحدة');
  set('c-excess', fmt(r.excess) + ' وحدة');
  set('c-commission', fmt(r.commission) + ' وحدة');
  set('c-deducted', fmt(r.totalDeducted) + ' وحدة');
  set('c-profit', fmt(r.profit) + ' ل.س');
}

// ============================================================
// السجل
// ============================================================

const histFilter = document.getElementById('history-filter');
histFilter.addEventListener('change', renderHistory);

function renderHistory() {
  const tbody = document.getElementById('history-body');
  const filter = histFilter.value;

  let rows = state.transactions.filter(tx => {
    if (filter === 'all') return true;
    if (filter === 'cash') return tx.type === 'cash';
    if (filter === 'debt') return tx.type === 'debt' && !tx.settledAt;
    if (filter === 'settled') return tx.type === 'debt' && tx.settledAt;
    return true;
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">لا توجد عمليات</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(tx => {
    const badge = tx.settledAt
      ? '<span class="badge settled">مسدَّد</span>'
      : tx.type === 'cash' ? '<span class="badge cash">نقدي</span>' : '<span class="badge debt">دين</span>';
    return `
      <tr>
        <td>${fmtDate(tx.date)}</td>
        <td>${escapeHtml(tx.name || '—')}</td>
        <td>${fmt(tx.paid)} ل.س</td>
        <td>${fmt(tx.transferred)}</td>
        <td>${fmt(tx.arrived)}</td>
        <td>${fmt(tx.commission)}</td>
        <td>${fmt(tx.profit)} ل.س</td>
        <td>${badge}</td>
        <td>
          <button class="btn small danger" data-action="delete-tx" data-id="${tx.id}">حذف</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action="delete-tx"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('هل تريد حذف هذه العملية؟ سيتم استرجاع الرصيد المخصوم.')) return;
      state.transactions = state.transactions.filter(t => t.id !== btn.dataset.id);
      saveState();
      showToast('تم الحذف', 'success');
      renderAll();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ============================================================
// الديون
// ============================================================

function renderDebts() {
  const tbody = document.getElementById('debts-body');
  const debts = state.transactions.filter(t => t.type === 'debt' && !t.settledAt);

  if (!debts.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">لا توجد ديون معلَّقة</td></tr>';
    return;
  }

  tbody.innerHTML = debts.map(tx => `
    <tr>
      <td>${fmtDate(tx.date)}</td>
      <td>${escapeHtml(tx.name || '—')}</td>
      <td><strong>${fmt(tx.paid)} ل.س</strong></td>
      <td>${fmt(tx.arrived)}</td>
      <td>${escapeHtml(tx.note || '—')}</td>
      <td><button class="btn small success" data-action="settle" data-id="${tx.id}">تسديد</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-action="settle"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tx = state.transactions.find(t => t.id === btn.dataset.id);
      if (!tx) return;
      if (!confirm(`تأكيد تسديد دَين ${tx.name} بقيمة ${fmt(tx.paid)} ل.س؟`)) return;
      tx.settledAt = nowIso();
      saveState();
      showToast('تم تسديد الدين', 'success');
      renderAll();
    });
  });
}

// ============================================================
// الإعدادات: الشحن
// ============================================================

document.getElementById('topup-form').addEventListener('submit', e => {
  e.preventDefault();
  const amount = Number(document.getElementById('topup-amount').value);
  const note = document.getElementById('topup-note').value.trim();
  if (!amount || amount <= 0) return showToast('أدخل مبلغاً صحيحاً', 'danger');

  state.topUps.unshift({
    id: uid(),
    date: nowIso(),
    amount,
    note: note || null
  });
  saveState();
  e.target.reset();
  showToast('تمت إضافة الرصيد', 'success');
  renderAll();
});

function renderTopups() {
  const tbody = document.getElementById('topups-body');
  if (!state.topUps.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">لم يتم شحن رصيد بعد</td></tr>';
    return;
  }
  tbody.innerHTML = state.topUps.map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td><strong>${fmt(t.amount)}</strong></td>
      <td>${escapeHtml(t.note || '—')}</td>
      <td><button class="btn small danger" data-action="del-topup" data-id="${t.id}">حذف</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-action="del-topup"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('حذف عملية الشحن؟')) return;
      state.topUps = state.topUps.filter(t => t.id !== btn.dataset.id);
      saveState();
      showToast('تم الحذف', 'success');
      renderAll();
    });
  });
}

// ============================================================
// الإعدادات: الأسعار
// ============================================================

const ratesForm = document.getElementById('rates-form');
ratesForm.addEventListener('submit', e => {
  e.preventDefault();
  const rt = Number(document.getElementById('rate-transferred').value);
  const ra = Number(document.getElementById('rate-arrived').value);
  const ps = Number(document.getElementById('payment-step').value);
  if (!rt || rt <= 0 || !ra || ra <= 0 || !ps || ps <= 0) return showToast('قيم غير صحيحة', 'danger');
  state.settings.rateTransferred = rt;
  state.settings.rateArrived = ra;
  state.settings.paymentStep = ps;
  saveState();
  showToast('تم حفظ الأسعار', 'success');
  renderAll();
});

function fillRates() {
  document.getElementById('rate-transferred').value = state.settings.rateTransferred;
  document.getElementById('rate-arrived').value = state.settings.rateArrived;
  document.getElementById('payment-step').value = state.settings.paymentStep;
}

// ============================================================
// الإعدادات: شرائح العمولة
// ============================================================

function renderTiers() {
  const wrap = document.getElementById('tiers-list');
  wrap.innerHTML = state.settings.commissionTiers.map((t, i) => `
    <div class="tier-row">
      <span style="white-space:nowrap">حتى</span>
      <input type="text" data-i="${i}" data-field="upTo" value="${t.upTo === Infinity ? '∞' : t.upTo}" placeholder="∞ للسقف" />
      <span style="white-space:nowrap">عمولة</span>
      <input type="number" step="0.01" data-i="${i}" data-field="fee" value="${t.fee}" />
      <button class="remove" data-remove="${i}">حذف</button>
    </div>
  `).join('');

  wrap.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.i);
      const field = inp.dataset.field;
      let val = inp.value.trim();
      if (field === 'upTo') {
        if (val === '' || val === '∞' || val.toLowerCase() === 'inf' || val.toLowerCase() === 'infinity') {
          state.settings.commissionTiers[i].upTo = Infinity;
        } else {
          state.settings.commissionTiers[i].upTo = Number(val);
        }
      } else {
        state.settings.commissionTiers[i].fee = Number(val);
      }
    });
  });

  wrap.querySelectorAll('[data-remove]').forEach(b => {
    b.addEventListener('click', () => {
      state.settings.commissionTiers.splice(Number(b.dataset.remove), 1);
      renderTiers();
    });
  });
}

document.getElementById('add-tier').addEventListener('click', () => {
  state.settings.commissionTiers.push({ upTo: Infinity, fee: 0 });
  renderTiers();
});

document.getElementById('save-tiers').addEventListener('click', () => {
  state.settings.commissionTiers = state.settings.commissionTiers
    .filter(t => !isNaN(t.fee))
    .sort((a, b) => a.upTo - b.upTo);
  saveState();
  showToast('تم حفظ الشرائح', 'success');
  renderTiers();
});

// ============================================================
// الإعدادات: التصدير/الاستيراد/الحذف
// ============================================================

document.getElementById('export-btn').addEventListener('click', () => {
  const data = {
    ...state,
    settings: {
      ...state.settings,
      commissionTiers: state.settings.commissionTiers.map(t => ({
        upTo: t.upTo === Infinity ? null : t.upTo,
        fee: t.fee
      }))
    }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `units-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('تم تصدير البيانات', 'success');
});

document.getElementById('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.settings || !Array.isArray(data.transactions)) throw new Error('ملف غير صالح');
    if (!confirm('سيتم استبدال البيانات الحالية. هل تريد المتابعة؟')) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    state = loadState();
    showToast('تم استيراد البيانات', 'success');
    renderAll();
    fillRates();
    renderTiers();
  } catch (err) {
    showToast('فشل الاستيراد: ' + err.message, 'danger');
  }
  e.target.value = '';
});

document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('سيتم حذف جميع البيانات (الرصيد، العمليات، الديون). متأكد؟')) return;
  if (!confirm('تأكيد نهائي: حذف كل شيء؟')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  showToast('تم حذف كل البيانات', 'success');
  renderAll();
  fillRates();
  renderTiers();
});

// ============================================================
// التشغيل
// ============================================================

function renderAll() {
  renderDashboard();
  renderHistory();
  renderDebts();
  renderTopups();
}

fillRates();
renderTiers();
renderAll();
updateTxPreview();
updateCalcPreview();
