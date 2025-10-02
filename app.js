const API_BASE = 'https://telegram-course-bot-lasico4qya-lm.a.run.app';
const BOT = 'SDDSbecomingherCOURSE_bot';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const CTX = {
  uid: Number(qs.get('uid') || '0'),
  ts: Number(qs.get('ts') || '0'),
  state: qs.get('state') || ''
};

function show(el, flag = true){ el.classList[flag ? 'remove' : 'add']('hidden'); }
function openBotChat() {
  const web = `https://t.me/${BOT}`;
  const deep = `tg://resolve?domain=${BOT}`;
  location.href = deep; setTimeout(() => { location.href = web; }, 300);
}
function showExpired(newUrl) {
  const apple = $('applepay-container'); const pp = $('paypal');
  if (apple) apple.style.display = 'none';
  if (pp) pp.style.display = 'none';
  $('expired-link').href = newUrl; show($('expired'));
}
function currencySymbol(cur) {
  switch ((cur || '').toUpperCase()) {
    case 'EUR': return '€'; case 'USD': return '$'; case 'PLN': return 'zł';
    case 'GBP': return '£'; case 'CZK': return 'Kč'; case 'UAH': return '₴';
    default: return cur ? (cur + ' ') : '';
  }
}

async function fetchPayConfig() {
  const url = new URL(`${API_BASE}/paypal/page-config`);
  url.searchParams.set('uid', String(CTX.uid));
  url.searchParams.set('ts', String(CTX.ts));
  url.searchParams.set('state', CTX.state);

  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (res.status === 410) {
    const payload = await res.json().catch(() => ({}));
    const detail = payload.detail || payload || {};
    if (detail.new_url) showExpired(detail.new_url);
    throw new Error('payment_link_expired');
  }
  if (!res.ok) throw new Error('pay_config_failed_' + res.status);
  return res.json(); // { client_id, currency, amount, label }
}

async function createOrderOnBackend() {
  const res = await fetch(`${API_BASE}/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(CTX),
  });
  if (res.status === 410) {
    const payload = await res.json().catch(() => ({}));
    const detail = payload.detail || payload || {};
    if (detail.new_url) showExpired(detail.new_url);
    throw new Error('payment_link_expired');
  }
  if (!res.ok) {
    const t = await res.text().catch(()=> ''); console.error('create-order ERROR:', res.status, t);
    throw new Error(`create_order_failed_${res.status}`);
  }
  const data = await res.json(); return data.id;
}

async function captureOnBackend(orderID) {
  const res = await fetch(`${API_BASE}/paypal/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ ...CTX, order_id: orderID }),
  });
  if (res.status === 410) {
    const payload = await res.json().catch(() => ({}));
    const detail = payload.detail || payload || {};
    if (detail.new_url) showExpired(detail.new_url);
    throw new Error('payment_link_expired');
  }
  if (!res.ok) {
    const t = await res.text().catch(()=> ''); console.error('capture ERROR:', res.status, t);
    throw new Error(`capture_failed_${res.status}`);
  }
  return res.json();
}

function waitForPayPal(maxMs = 7000, step = 120) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function loop(){
      if (window.paypal && typeof window.paypal.Buttons === 'function') return resolve();
      if (Date.now() - t0 > maxMs) return reject(new Error('paypal_sdk_not_ready'));
      setTimeout(loop, step);
    })();
  });
}

function initPayPalButtons() {
  if (!window.paypal || typeof paypal.Buttons !== 'function') {
    console.warn('PayPal SDK ešte nie je pripravený'); return;
  }
  paypal.Buttons({
    style: { layout: 'vertical', shape: 'rect', color: 'gold', tagline: false },
    createOrder: async () => await createOrderOnBackend(),
    onApprove: async (data) => {
      await captureOnBackend(data.orderID);
      show($('ok-msg')); openBotChat();
    },
    onError: (err) => {
      console.error('PayPal onError:', err);
      alert('Chyba pri platbe. Skúste to znovu alebo kontaktujte podporu.');
    }
  }).render('#paypal');
}

async function initApplePay(currency, amount, label) {
  try {
    if (!window.ApplePaySession || !ApplePaySession.canMakePayments()) return;
    if (!window.paypal || !paypal.Applepay) return;

    const applepay = paypal.Applepay();
    const cfg = await applepay.config();
    if (!cfg.isEligible) return;

    const apContainer = $('applepay-container');
    apContainer.innerHTML = `<apple-pay-button id="ap-btn" class="ap-btn paybtn" buttonstyle="black" type="buy" locale="sk-SK"></apple-pay-button>`;

    $('ap-btn').addEventListener('click', async () => {
      try {
        const orderId = await createOrderOnBackend();
        const paymentRequest = {
          countryCode: cfg.countryCode || "SK",
          currencyCode: (currency || "EUR").toUpperCase(),
          merchantCapabilities: cfg.merchantCapabilities || ["supports3DS"],
          supportedNetworks: cfg.supportedNetworks || ["visa","masterCard","maestro","amex"],
          requiredBillingContactFields: ["name", "email", "postalAddress"],
          total: { label: label || "BecomingHer", amount: String(amount), type: "final" }
        };
        const session = new ApplePaySession(3, paymentRequest);

        session.onvalidatemerchant = (event) => {
          applepay.validateMerchant({ validationUrl: event.validationURL, displayName: label || "BecomingHer" })
            .then((res) => session.completeMerchantValidation(res.merchantSession))
            .catch((err) => { console.error("validateMerchant error:", err); session.abort(); });
        };
        session.onpaymentauthorized = (event) => {
          applepay.confirmOrder({ orderId, token: event.payment.token, billingContact: event.payment.billingContact })
            .then(() => captureOnBackend(orderId))
            .then(() => { session.completePayment(ApplePaySession.STATUS_SUCCESS); show($('ok-msg')); openBotChat(); })
            .catch((err) => { console.error("confirm/capture error:", err); session.completePayment(ApplePaySession.STATUS_FAILURE); alert('Chyba pri Apple Pay platbe. Skúste to znovu.'); });
        };
        session.oncancel = () => {};
        session.begin();
      } catch (e) {
        console.error("Apple Pay flow failed:", e);
        alert('Apple Pay momentálne nie je dostupné.');
      }
    });
  } catch (e) { console.warn("Apple Pay init failed", e); }
}

async function init() {
  if (!CTX.uid || !CTX.ts || !CTX.state) {
    show($('params-missing'));
    const apple = $('applepay-container'); const pp = $('paypal');
    if (apple) apple.style.display = 'none';
    if (pp) pp.style.display = 'none';
    return;
  }

  try {
    const cfg = await fetchPayConfig(); // { client_id, currency, amount, label }
    const label = cfg.label || 'BecomingHer';

    const sign = currencySymbol(cfg.currency);
    const price = $('price');
    if (price) price.textContent = sign ? `${sign}${cfg.amount} • jednorazovo` : `${cfg.amount} ${cfg.currency} • jednorazovo`;
    const lb = $('course-label'); if (lb) lb.textContent = label;
    const lr = $('course-label-right'); if (lr) lr.textContent = sign ? `${sign}${cfg.amount}` : `${cfg.amount} ${cfg.currency}`;
    document.title = `${label} — Platba`;

    await waitForPayPal(7000, 120);
    initPayPalButtons();
    await initApplePay(cfg.currency, cfg.amount, label);

  } catch (e) {
    console.error('Init failed:', e);
    if (!String(e.message || '').includes('payment_link_expired')) {
      alert('Stránka platby sa nepodarila inicializovať. Skúste to znova.');
    }
  }
}

window.addEventListener('load', init);
