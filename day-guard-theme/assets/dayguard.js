/* ============================================================
   dayguard.js — combined JS for Day-Guard Shopify theme
   Covers: homepage (index) + PDP (product) behaviours
   Guards via getElementById/querySelector allow safe inclusion
   on both page types without errors.
   ============================================================ */

/* ── Suppress Rebuy Smart Cart (conflicts with DG custom cart drawer) ── */
/* Strategy: Rebuy JS calls element.style.setProperty('display','flex','important')
   which beats CSS !important from stylesheets.  We use a WeakSet to track the style
   objects of Rebuy DOM elements, then intercept CSSStyleDeclaration.prototype.setProperty
   synchronously so any call on a registered Rebuy style object is silently dropped
   (the element stays hidden). A MutationObserver re-registers elements if Rebuy
   recreates its DOM nodes.                                                            */
(function() {
  var _origSetProp = CSSStyleDeclaration.prototype.setProperty;

  /* WeakSet: holds the .style CSSStyleDeclaration objects of Rebuy elements */
  var rebuyStyles = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  /* ── Synchronous setProperty intercept ── */
  CSSStyleDeclaration.prototype.setProperty = function(prop, value, priority) {
    /* Block all style changes on registered Rebuy elements */
    if (rebuyStyles && rebuyStyles.has(this)) {
      return; /* Drop the call */
    }
    /* Also block hiding the body (Rebuy sets body display:none when opening its cart) */
    if (prop === 'display' && (value === 'none' || value === '') && document.body && this === document.body.style) {
      return;
    }
    if (prop === 'visibility' && value === 'hidden' && document.body && this === document.body.style) {
      return;
    }
    return _origSetProp.call(this, prop, value, priority);
  };

  /* ── Body-style MutationObserver — catches direct style.display='none' assignments ── */
  /* (Property assignments bypass setProperty intercept, so we need this as backup)     */
  function restoreBodyVisibility() {
    var b = document.body;
    if (!b) return;
    if (b.style.display === 'none') b.style.removeProperty('display');
    if (b.style.visibility === 'hidden') b.style.removeProperty('visibility');
    /* Also strip Rebuy scroll-lock classes (they trigger overflow:hidden via CSS rules) */
    ['rebuy-cart--open', 'smart-cart--open', 'rebuy-no-scroll', 'rebuy-cart-visible'].forEach(function(cls) {
      if (b.classList.contains(cls)) b.classList.remove(cls);
    });
  }
  /* Watch body style attribute for changes */
  var bodyStyleObs = new MutationObserver(restoreBodyVisibility);
  /* Start watching once DOM is ready */
  if (document.body) {
    bodyStyleObs.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      if (document.body) bodyStyleObs.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    });
  }

  var REBUY_SELECTORS = [
    '#rebuy-cart',
    '.rebuy-cart__flyout',
    '.rebuy-cart__overlay',
    '.rebuy-cart-bubble'
  ];

  /* Register a Rebuy element's style object and force-hide it immediately */
  function registerEl(el) {
    if (rebuyStyles && !rebuyStyles.has(el.style)) {
      rebuyStyles.add(el.style);
    }
    /* Use the original (un-intercepted) setProperty to actually hide it */
    _origSetProp.call(el.style, 'display',        'none',   'important');
    _origSetProp.call(el.style, 'visibility',     'hidden', 'important');
    _origSetProp.call(el.style, 'opacity',        '0',      'important');
    _origSetProp.call(el.style, 'pointer-events', 'none',   'important');
  }

  function registerAllRebuyEls() {
    REBUY_SELECTORS.forEach(function(sel) {
      document.querySelectorAll(sel).forEach(registerEl);
    });
    /* Release any body scroll-lock Rebuy may have applied */
    var dgCartOpen = document.getElementById('cart-drawer') &&
                     document.getElementById('cart-drawer').classList.contains('open');
    if (!dgCartOpen) {
      ['rebuy-cart--open','smart-cart--open','rebuy-no-scroll'].forEach(function(cls) {
        if (document.body.classList.contains(cls)) {
          document.body.classList.remove(cls);
          document.body.style.removeProperty('overflow');
        }
      });
    }
  }

  /* Disable any Rebuy <link> stylesheet so its CSS can't interfere either */
  function disableRebuyStylesheets() {
    document.querySelectorAll('link[id*="rebuy"], link[href*="rebuy"], style[id*="rebuy"]').forEach(function(el) {
      el.disabled = true;
    });
  }

  /* Initial run */
  registerAllRebuyEls();
  disableRebuyStylesheets();

  /* Watch for Rebuy adding/re-adding its elements or stylesheet links */
  var obs = new MutationObserver(function(mutations) {
    var needsRegister = false;
    var needsStylesheetDisable = false;
    mutations.forEach(function(m) {
      if (m.type === 'childList') {
        m.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          /* Check if the added node itself is a Rebuy element */
          var id = node.id || '';
          var cls = (node.className && node.className.toString) ? node.className.toString() : '';
          if (id.indexOf('rebuy') !== -1 || cls.indexOf('rebuy') !== -1) {
            registerEl(node);
          }
          /* Check descendants */
          if (node.querySelectorAll) {
            REBUY_SELECTORS.forEach(function(sel) {
              node.querySelectorAll(sel).forEach(registerEl);
            });
          }
          /* stylesheet link? */
          if (node.tagName === 'LINK' && node.href && node.href.indexOf('rebuy') !== -1) {
            node.disabled = true;
          }
        });
      } else if (m.type === 'attributes') {
        /* If Rebuy tries to add a class or style that re-shows itself */
        var t = m.target;
        var tid = t.id || '';
        var tcls = (t.className && t.className.toString) ? t.className.toString() : '';
        if (tid.indexOf('rebuy') !== -1 || tcls.indexOf('rebuy') !== -1) {
          registerEl(t);
        }
      }
    });
  });

  obs.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });
})();

/* ── Shopify Ajax Cart API helpers (shared) ── */
(function() {

  /* ── Money formatter ── */
  function formatMoney(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  /* ── Fetch cart from Shopify ── */
  function fetchCart() {
    return fetch('/cart.js', { headers: { 'Content-Type': 'application/json' } }).then(r => r.json());
  }

  /* ── Add item to cart ── */
  function addToCart(variantId, qty, sellingPlan) {
    const body = { id: variantId, quantity: qty };
    if (sellingPlan) body.selling_plan = sellingPlan;
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => {
      if (!r.ok) return r.json().then(e => Promise.reject(e));
      return r.json();
    });
  }

  /* ── Change item quantity by line item key ── */
  function changeCartItem(key, quantity) {
    return fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, quantity: quantity })
    }).then(r => r.json());
  }

  /* ── Render cart drawer from cart object ── */
  function renderCart(cart) {
    const itemsWrap = document.getElementById('cart-items-wrap');
    const emptyEl   = document.getElementById('cart-empty');
    const footerEl  = document.getElementById('cart-footer');
    const countEl   = document.getElementById('cart-count');
    const subtotalEl = document.getElementById('cart-subtotal');

    if (!itemsWrap) return;

    if (cart.item_count > 0) {
      if (emptyEl)   emptyEl.style.display  = 'none';
      if (footerEl)  footerEl.style.display = 'block';
      if (itemsWrap) itemsWrap.style.display = 'block';

      itemsWrap.innerHTML = cart.items.map(item => {
        const imgSrc = (item.featured_image && item.featured_image.url) || item.image || '';
        const planName = (item.selling_plan_allocation && item.selling_plan_allocation.selling_plan)
          ? item.selling_plan_allocation.selling_plan.name
          : 'one-time';
        return `<div class="cart-item" data-key="${item.key}">
          <img src="${imgSrc}" class="cart-item-img" alt="${item.title}">
          <div class="cart-item-info">
            <div class="cart-item-name-row">
              <div class="cart-item-name">${item.product_title}</div>
              <button class="cart-item-remove" data-key="${item.key}" aria-label="Remove item">×</button>
            </div>
            <div class="cart-item-sub">${planName}</div>
            <div class="cart-item-qty-row">
              <div class="cart-item-qty">
                <button data-key="${item.key}" data-delta="-1" class="cart-qty-btn">−</button>
                <span>${item.quantity}</span>
                <button data-key="${item.key}" data-delta="1" class="cart-qty-btn">+</button>
              </div>
              <div class="cart-item-price">${formatMoney(item.line_price)}</div>
            </div>
          </div>
        </div>`;
      }).join('');
    } else {
      if (emptyEl)   emptyEl.style.display  = '';
      if (footerEl)  footerEl.style.display = 'none';
      if (itemsWrap) itemsWrap.style.display = 'none';
    }

    if (countEl) {
      countEl.textContent = cart.item_count;
      countEl.style.display = cart.item_count > 0 ? '' : 'none';
    }

    if (subtotalEl) subtotalEl.textContent = formatMoney(cart.total_price);
  }

  /* ── Fetch, render, and return cart promise ── */
  function fetchAndRenderCart() {
    return fetchCart().then(cart => { renderCart(cart); return cart; });
  }

  /* ── Delegate qty button clicks inside cart drawer ── */
  document.addEventListener('click', function(e) {
    /* Qty +/− buttons */
    const btn = e.target.closest('.cart-qty-btn');
    if (btn) {
      const key   = btn.dataset.key;
      const delta = parseInt(btn.dataset.delta, 10);
      const qtyEl = btn.parentElement.querySelector('span');
      const currentQty = parseInt(qtyEl ? qtyEl.textContent : 1, 10);
      const newQty = Math.max(0, currentQty + delta);
      changeCartItem(key, newQty).then(cart => renderCart(cart));
      return;
    }
    /* Remove × button */
    const removeBtn = e.target.closest('.cart-item-remove');
    if (removeBtn) {
      changeCartItem(removeBtn.dataset.key, 0).then(cart => renderCart(cart));
    }
  });

  /* ── Cart drawer open/close ── */
  const cartDrawer  = document.getElementById('cart-drawer');
  const cartOverlay = document.getElementById('cart-overlay');
  const cartClose   = document.getElementById('cart-close');
  const cartTrigger = document.getElementById('cart-trigger');
  if (!cartDrawer) return;
  let cartOpen = false;
  function openCart()  { cartDrawer.classList.add('open'); cartOverlay.classList.add('open'); document.body.style.overflow = 'hidden'; cartOpen = true; }
  function closeCart() { cartDrawer.classList.remove('open'); cartOverlay.classList.remove('open'); document.body.style.overflow = ''; cartOpen = false; }
  cartTrigger && cartTrigger.addEventListener('click', () => cartOpen ? closeCart() : openCart());
  cartOverlay && cartOverlay.addEventListener('click', closeCart);
  cartClose   && cartClose.addEventListener('click', closeCart);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && cartOpen) closeCart(); });

  /* ── Expose globally ── */
  window.DG = window.DG || {};
  window.DG.openCart          = openCart;
  window.DG.closeCart         = closeCart;
  window.DG.addToCart         = addToCart;
  window.DG.fetchAndRenderCart = fetchAndRenderCart;
  window.DG.formatMoney       = formatMoney;

  /* ── Initialize cart on page load ── */
  fetchAndRenderCart();
})();

/* ── Nav dropdowns — close on outside click (shared) ── */
document.addEventListener('click', e => {
  document.querySelectorAll('.nav-item.has-dropdown').forEach(item => {
    if (!item.contains(e.target)) item.classList.remove('open');
  });
});

/* ── Scroll fade-in (shared) ── */
(function() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -36px 0px' });
  document.querySelectorAll('.fade-up').forEach(el => io.observe(el));
})();

/* ── Pillar modal (shared — identical data on both pages) ── */
(function() {
  const pillars = {
    liver: {
      label: 'Liver Support',
      title: 'LIVER SUPPORT',
      bg: 'https://www.figma.com/api/mcp/asset/1cd7ec1d-3c88-4f86-9392-1a0afbb9881f',
      desc: 'As the liver breaks down alcohol, it produces acetaldehyde, a toxic compound responsible for fatigue and discomfort.\n\nday\u2013guard\'s liver support complex combines Hovenia Dulcis, Turmeric Extract, Milk Thistle, and L-Cysteine to expedite acetaldehyde breakdown, reduce oxidative stress, and support natural detoxification.',
      ingredients: [
        { name: 'Hovenia Dulcis (Oriental Raisin Tree) Fruit Concentrate', img: 'https://www.figma.com/api/mcp/asset/bd958b09-16e5-488f-931a-903c2cfd9dca' },
        { name: 'Turmeric (Rhizome) Extract', img: 'https://www.figma.com/api/mcp/asset/1804923b-efb3-443b-bd32-5ead34707968' },
        { name: 'Milk Thistle (Seed) Extract', img: 'https://www.figma.com/api/mcp/asset/7256a0c3-f231-4e94-820f-4d5dd289752b' },
        { name: 'L-Cysteine', img: 'https://www.figma.com/api/mcp/asset/cf7db0ef-80a9-4294-952a-c5cc2b1e6706' },
        { name: 'Black Pepper (Fruit) Extract', img: 'https://www.figma.com/api/mcp/asset/51bba8ff-72c4-4b2c-8e46-dba1fa9c0544' }
      ]
    },
    gut: {
      label: 'Gut Support',
      title: 'GUT SUPPORT',
      bg: 'https://www.figma.com/api/mcp/asset/5f3a9f21-aa80-44ca-abf1-9b7ca8a6665a',
      desc: 'Alcohol can disrupt gut function and slow digestion.\n\nPear Juice Concentrate, Fructo-oligosaccharides (prebiotics), and Ginger Extract help maintain microbial balance, soothe the stomach, and support healthy digestion, so your body stays comfortable during recovery.',
      ingredients: [
        { name: 'Ginger', img: 'https://www.figma.com/api/mcp/asset/47e35e9a-1d2d-474e-adfa-b3520b8a5b8f' },
        { name: 'Korean Pear', img: 'https://www.figma.com/api/mcp/asset/398dce93-6627-46e7-b694-81274c2af271' },
        { name: 'Fructo-oligosaccharides', img: 'https://www.figma.com/api/mcp/asset/b3ac866b-104a-4086-a098-cbb23cdc7122' },
        { name: 'Xylitol', img: 'https://www.figma.com/api/mcp/asset/797f2d11-4de1-407e-8193-a64941d0e621' },
        { name: 'Black Pepper (Fruit) Extract', img: 'https://www.figma.com/api/mcp/asset/51bba8ff-72c4-4b2c-8e46-dba1fa9c0544' }
      ]
    },
    vitamins: {
      label: 'Vitamin Replenishment',
      title: 'VITAMIN REPLENISHMENT',
      bg: 'https://www.figma.com/api/mcp/asset/92a90509-0988-45d1-8e92-3e59dee17aae',
      desc: 'Your body needs vitamins for energy and recovery, and alcohol robs your body of these essential vitamins.\n\nday\u2013guard\u00ae replenishes them with Thiamine (B1), Riboflavin (B2), Niacin (B3), and Vitamin B6, supporting metabolism, energy production, and overall cellular repair.',
      ingredients: [
        { name: 'Thiamine (Vitamin B1)', img: 'https://www.figma.com/api/mcp/asset/c0d0f886-393c-4d0d-869f-824ac24940ef' },
        { name: 'Riboflavin (Vitamin B2)', img: 'https://www.figma.com/api/mcp/asset/6f2e5c93-c754-42b2-9508-696014b74d16' },
        { name: 'Niacin (Vitamin B3)', img: 'https://www.figma.com/api/mcp/asset/432cfd6b-2e17-406b-bae6-c2c584108675' },
        { name: 'Vitamin B6', img: 'https://www.figma.com/api/mcp/asset/648b7ca8-e754-447a-bf2b-df716e3b4e34' },
        { name: 'Black Pepper (Fruit) Extract', img: 'https://www.figma.com/api/mcp/asset/51bba8ff-72c4-4b2c-8e46-dba1fa9c0544' }
      ]
    },
    hydration: {
      label: 'Hydration',
      title: 'HYDRATION',
      bg: 'https://www.figma.com/api/mcp/asset/32d04d91-8432-4044-bec7-8f22b76052a9',
      desc: 'Alcohol acts as a diuretic, leading to dehydration and electrolyte loss.\n\nMagnesium Gluconate and Sodium Citrate help restore fluid balance and muscle function, while natural fruit concentrates aid hydration and nutrient absorption.',
      ingredients: [
        { name: 'Magnesium', img: 'https://www.figma.com/api/mcp/asset/615c6622-3985-44ac-adef-ae27eb423859' },
        { name: 'Sodium', img: 'https://www.figma.com/api/mcp/asset/c12dbae5-8722-4516-b0e6-ad56a45abc06' },
        { name: 'Korean Pear', img: 'https://www.figma.com/api/mcp/asset/6ff94394-102c-4258-9056-d5c96652540d' },
        { name: 'Black Pepper (Fruit) Extract', img: 'https://www.figma.com/api/mcp/asset/51bba8ff-72c4-4b2c-8e46-dba1fa9c0544' }
      ]
    }
  };

  const overlay    = document.getElementById('pillarModal');
  if (!overlay) return;
  const modalBg    = document.getElementById('pillarModalBg');
  const modalLabel = document.getElementById('pillarModalLabel');
  const modalTitle = document.getElementById('pillarModalTitle');
  const modalDesc  = document.getElementById('pillarModalDesc');
  const modalList  = document.getElementById('pillarModalIngList');
  const closeBtn   = document.getElementById('pillarModalClose');

  function openModal(key) {
    const d = pillars[key]; if (!d) return;
    modalBg.src             = d.bg;
    modalLabel.textContent  = d.label;
    modalTitle.textContent  = d.title;
    modalDesc.innerHTML     = d.desc.replace(/\n\n/g, '<br><br>');
    modalList.innerHTML     = d.ingredients.map(ing =>
      `<li class="pillar-modal-ing-item">
        <img class="pillar-modal-ing-img" src="${ing.img}" alt="${ing.name}">
        <span class="pillar-modal-ing-name">${ing.name}</span>
      </li>`
    ).join('');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.pillar-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.pillar));
  });
  closeBtn && closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
})();

/* ── Reviews: infinite carousel, translateX centering, 10s auto-advance (shared) ── */
(function() {
  const track   = document.getElementById('reviews-track');
  const prevBtn = document.getElementById('rev-prev');
  const nextBtn = document.getElementById('rev-next');
  if (!track) return;

  const origSlides = Array.from(track.querySelectorAll('.rev-slide'));
  const origCount  = origSlides.length;

  /* Prepend clones of last origCount slides */
  [...origSlides].reverse().forEach(s => track.insertBefore(s.cloneNode(true), track.firstChild));
  /* Append clones of first origCount slides */
  origSlides.forEach(s => track.appendChild(s.cloneNode(true)));

  const allSlides = Array.from(track.querySelectorAll('.rev-slide'));
  let activeIdx = origCount + 4;
  let autoTimer;
  let transitioning = false;

  function calcOffset(idx) {
    const viewport = track.parentElement;
    const viewW    = viewport.clientWidth;
    const gap      = 12;
    let dist = 0;
    for (let i = 0; i < idx; i++) dist += allSlides[i].offsetWidth + gap;
    dist += allSlides[idx].offsetWidth / 2;
    return viewW / 2 - dist;
  }

  function render(animate) {
    allSlides.forEach((s, i) => s.classList.toggle('rev-active', i === activeIdx));
    if (!animate) {
      track.style.transition = 'none';
      track.style.transform  = `translateX(${calcOffset(activeIdx)}px)`;
      void track.offsetWidth;
      track.style.transition = '';
    } else {
      track.style.transform  = `translateX(${calcOffset(activeIdx)}px)`;
    }
  }

  function navigate(dir) {
    if (transitioning) return;
    activeIdx += dir;
    render(true);
    transitioning = true;
    setTimeout(() => {
      if (activeIdx >= origCount * 2) { activeIdx -= origCount; render(false); }
      else if (activeIdx < origCount) { activeIdx += origCount; render(false); }
      transitioning = false;
    }, 570);
  }

  function startAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(() => navigate(1), 10000);
  }

  prevBtn && prevBtn.addEventListener('click', () => { navigate(-1); startAuto(); });
  nextBtn && nextBtn.addEventListener('click', () => { navigate(1);  startAuto(); });

  /* Expose _revNav so clicking non-active slides navigates to them */
  window._revNav = function(el) {
    const idx = allSlides.indexOf(el);
    if (idx < 0) return;
    navigate(idx - activeIdx);
    startAuto();
  };

  requestAnimationFrame(() => requestAnimationFrame(() => render(false)));
  startAuto();
})();

/* ── Reviews: click non-active slide to navigate (shared) ── */
document.addEventListener('click', function(e) {
  const slide = e.target.closest('.rev-slide');
  if (slide && !slide.classList.contains('rev-active') && window._revNav) {
    window._revNav(slide);
  }
});

/* ── Mobile hamburger menu (shared) ── */
(function() {
  const hamburger = document.getElementById('nav-hamburger');
  const overlay   = document.getElementById('mobile-menu-overlay');
  const menu      = document.getElementById('mobile-menu');
  const closeBtn  = document.getElementById('mobile-menu-close');
  if (!hamburger || !menu) return;

  function openMenu() {
    menu.classList.add('open');
    if (overlay) overlay.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    menu.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', openMenu);
  closeBtn && closeBtn.addEventListener('click', closeMenu);
  overlay && overlay.addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
})();


/* ── Footer email/SMS toggle + Klaviyo subscribe ── */
(function() {
  const ftEmail  = document.getElementById('ft-email');
  const ftSms    = document.getElementById('ft-sms');
  const ftInput  = document.getElementById('ft-input');
  const ftSubmit = document.getElementById('ft-submit');
  const ftMsg    = document.getElementById('ft-msg');
  if (!ftEmail || !ftSms || !ftInput) return;

  let mode = 'email';

  ftEmail.addEventListener('click', () => {
    mode = 'email';
    ftEmail.classList.add('active'); ftSms.classList.remove('active');
    ftInput.type = 'email'; ftInput.placeholder = 'enter your email.';
    ftInput.value = '';
    if (ftMsg) { ftMsg.textContent = ''; ftMsg.className = 'ft-msg'; }
  });

  ftSms.addEventListener('click', () => {
    mode = 'sms';
    ftSms.classList.add('active'); ftEmail.classList.remove('active');
    ftInput.type = 'tel'; ftInput.placeholder = 'enter your phone number.';
    ftInput.value = '';
    if (ftMsg) { ftMsg.textContent = ''; ftMsg.className = 'ft-msg'; }
  });

  function toE164(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits[0] === '1') return '+' + digits;
    return null;
  }

  function showMsg(text, ok) {
    if (!ftMsg) return;
    ftMsg.textContent = text;
    ftMsg.className = 'ft-msg ' + (ok ? 'ft-msg--ok' : 'ft-msg--err');
  }

  async function subscribe() {
    const val = ftInput.value.trim();
    if (!val) {
      showMsg('please enter your ' + (mode === 'email' ? 'email' : 'phone number') + '.', false);
      return;
    }

    let profileAttrs, listId;
    if (mode === 'email') {
      profileAttrs = { email: val };
      listId = 'RQwRv9';
    } else {
      const phone = toE164(val);
      if (!phone) { showMsg('please enter a valid US phone number.', false); return; }
      profileAttrs = { phone_number: phone };
      listId = 'UmQsU4';
    }

    if (ftSubmit) { ftSubmit.disabled = true; ftSubmit.textContent = '...'; }

    try {
      const res = await fetch('https://a.klaviyo.com/client/subscriptions/?company_id=WVrNPv', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'revision': '2024-10-15' },
        body: JSON.stringify({
          data: {
            type: 'subscription',
            attributes: {
              profile: { data: { type: 'profile', attributes: profileAttrs } }
            },
            relationships: { list: { data: { type: 'list', id: listId } } }
          }
        })
      });
      if (res.status === 202) {
        showMsg("you're in! check your " + (mode === 'email' ? 'inbox' : 'texts') + '.', true);
        ftInput.value = '';
      } else {
        showMsg('something went wrong. please try again.', false);
      }
    } catch(e) {
      showMsg('something went wrong. please try again.', false);
    } finally {
      if (ftSubmit) { ftSubmit.disabled = false; ftSubmit.textContent = '→'; }
    }
  }

  if (ftSubmit) ftSubmit.addEventListener('click', subscribe);
  ftInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') subscribe(); });
})();

/* ══════════════════════════════════════════════════
   HOMEPAGE-ONLY BEHAVIOURS
   (guarded — only run if the relevant elements exist)
   ══════════════════════════════════════════════════ */

/* ── Homepage: sticky nav + logo swap ── */
(function() {
  const nav        = document.getElementById('site-nav');
  const navLogoImg = document.getElementById('nav-logo-img');
  if (!nav || nav.classList.contains('nav--solid')) return; /* skip on PDP */
  const LOGO_WHITE = 'https://www.figma.com/api/mcp/asset/937b4ef5-969f-4feb-a1fc-ed0bec4e1ea4';
  const LOGO_BLACK = 'https://www.figma.com/api/mcp/asset/bf338aff-a962-423b-8ebb-6042ee6ff20b';

  window.addEventListener('scroll', () => {
    const scrolled = window.scrollY > 60;
    nav.classList.toggle('scrolled', scrolled);
    if (navLogoImg) navLogoImg.src = scrolled ? LOGO_BLACK : LOGO_WHITE;
  }, { passive: true });
})();

/* ── Homepage: stats count-up (easeOutQuart) ── */
(function() {
  const statsEl = document.getElementById('features-stats');
  if (!statsEl) return;
  let fired = false;

  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

  function animateCount(el, target) {
    const duration = 1600;
    const start    = performance.now();
    const suffix   = el.dataset.suffix || '+';
    function tick(now) {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased    = easeOutQuart(progress);
      const value    = Math.round(eased * target);
      if (target >= 1000) {
        el.textContent = Math.round(eased * (target / 1000)) + suffix;
      } else {
        el.textContent = value + suffix;
      }
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  const statsObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting && !fired) {
        fired = true;
        statsEl.querySelectorAll('.fstat-count').forEach(el => {
          animateCount(el, parseInt(el.dataset.target));
        });
        statsObserver.disconnect();
      }
    });
  }, { threshold: 0.3 });

  statsObserver.observe(statsEl);
})();

/* ── Homepage: sticky CTA — show after science section, hide at reviews + footer ── */
(function() {
  const stickyCta = document.getElementById('sticky-cta');
  if (!stickyCta) return;
  const scienceEl = document.getElementById('ingredients');
  const reviewsEl = document.getElementById('reviews');
  const footerEl  = document.getElementById('footer');

  let scienceReached = false;
  let reviewsVisible = false;
  let footerVisible  = false;

  function syncCta() {
    stickyCta.classList.toggle('visible', scienceReached && !reviewsVisible && !footerVisible);
  }

  if (scienceEl) {
    new IntersectionObserver(entries => {
      const e = entries[0];
      if (e.isIntersecting) { scienceReached = true; }
      else if (e.boundingClientRect.top > 0) { scienceReached = false; }
      syncCta();
    }, { threshold: 0 }).observe(scienceEl);
  }
  if (reviewsEl) {
    new IntersectionObserver(entries => {
      reviewsVisible = entries[0].isIntersecting;
      syncCta();
    }, { threshold: 0.05 }).observe(reviewsEl);
  }
  if (footerEl) {
    new IntersectionObserver(entries => {
      footerVisible = entries[0].isIntersecting;
      syncCta();
    }, { threshold: 0.01 }).observe(footerEl);
  }
})();

/* ── Homepage: press logo switcher ── */
(function() {
  const pressQuoteEl = document.getElementById('press-quote');
  const logoBtns     = document.querySelectorAll('.press-logo-btn');
  if (!pressQuoteEl || !logoBtns.length) return;

  logoBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pressQuoteEl.classList.add('switching');
      setTimeout(() => {
        pressQuoteEl.innerHTML = btn.dataset.quote;
        pressQuoteEl.classList.remove('switching');
      }, 220);
      logoBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
})();

/* ── Homepage: smooth scroll ── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const t = document.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

/* ── Homepage: how-to hover videos ── */
document.querySelectorAll('.howto-card').forEach(function(card) {
  var video = card.querySelector('.howto-card-video');
  if (!video) return;
  card.addEventListener('mouseenter', function() { video.play(); });
  card.addEventListener('mouseleave', function() { video.pause(); video.currentTime = 0; });
});

/* ══════════════════════════════════════════════════
   PDP-ONLY BEHAVIOURS
   (guarded — only run if the relevant elements exist)
   ══════════════════════════════════════════════════ */

/* ── PDP: nav scroll (always solid, adds shadow only) ── */
(function() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  });
})();

/* ── PDP: subscribe / buy-once toggle + price update ── */
(function() {
  const togSub       = document.getElementById('tog-sub');
  const togOnce      = document.getElementById('tog-once');
  const toggleEl     = document.getElementById('purchase-toggle');
  const purchasePanel = document.querySelector('.purchase-panel');
  const priceMain    = document.getElementById('price-main');
  const priceOriginalEl = document.getElementById('price-original');
  const cadenceSelect   = document.getElementById('cadence-select');
  const ctaBtn          = document.getElementById('cta-btn');
  const sellingPlanInput = document.getElementById('selling-plan-input');

  if (!togSub && !togOnce) return;

  /* Prices: { boxes: [subscribe_price, onetime_price] } */
  const PRICES = { 1: [29.00, 36.00], 2: [55.00, 69.00], 3: [75.00, 99.00] };
  const SAVE_PCT = { 1: 19, 2: 20, 3: 24 };

window.DG = window.DG || {};
  window.DG.currentMode = 'sub';

  function updatePrice() {
    const boxes    = parseInt(document.querySelector('.qty-box.active')?.dataset.qty || 3);
    const isSub    = window.DG.currentMode === 'sub';
    const subPrice = PRICES[boxes]?.[0] || 75;
    const oncePrice = PRICES[boxes]?.[1] || 99;
    const total    = isSub ? subPrice : oncePrice;

    const moSuffix = isSub ? '<span class="price-mo">/mo</span>' : '';
    if (priceMain) priceMain.innerHTML = '$' + total.toFixed(2) + moSuffix;

    if (priceOriginalEl) {
      if (isSub) {
        priceOriginalEl.textContent = '$' + oncePrice.toFixed(2);
        priceOriginalEl.classList.add('visible');
      } else {
        priceOriginalEl.classList.remove('visible');
      }
    }

    if (cadenceSelect) cadenceSelect.classList.toggle('hidden', !isSub);
    const saveBadge = document.getElementById('toggle-save-badge');
    if (saveBadge) saveBadge.textContent = 'save ' + (SAVE_PCT[boxes] || 19) + '%';

    const stickyLabel = document.getElementById('sticky-price-label');
    if (stickyLabel) stickyLabel.textContent = '$' + total.toFixed(2) + (isSub ? ' \u00b7 subscribe & save' : ' \u00b7 one-time');

    /* Sync variant ID to match selected box count */
    const variantIdInput = document.getElementById('variant-id');
    if (variantIdInput) {
      const variants = (window.DG_PRODUCT && window.DG_PRODUCT.variants) || [];
      const boxVariant = variants.find(v => (v.title || '').toUpperCase() === (boxes + ' BOX'));
      if (boxVariant) {
        variantIdInput.value = boxVariant.id;
        window.DG_VARIANT = boxVariant;
      }
    }

    /* Update hidden selling_plan input from DG_SELLING_PLANS */
    if (sellingPlanInput) {
      if (isSub) {
        const cadenceWeeks = parseInt(document.getElementById('cadence-dropdown')?.value || 4, 10);
        /* Plan names are: "{N}-week subscription - {M} BOX" — match by name only (no billing_policy available) */
        const boxToken  = (boxes + ' BOX').toUpperCase();       /* e.g. "3 BOX" */
        const weekToken = (cadenceWeeks + '-WEEK');             /* e.g. "4-WEEK" */
        let planId = '';
        const groups = window.DG_SELLING_PLANS;
        if (groups && groups.length) {
          /* Primary: plan name contains BOTH box count and week count */
          planSearch: for (let gi = 0; gi < groups.length; gi++) {
            const plans = groups[gi].selling_plans || [];
            for (let pi = 0; pi < plans.length; pi++) {
              const nameUp = (plans[pi].name || '').toUpperCase();
              if (nameUp.includes(boxToken) && nameUp.includes(weekToken)) {
                planId = plans[pi].id; break planSearch;
              }
            }
          }
          /* Fallback: box count only (pick first matching cadence) */
          if (!planId) {
            boxSearch: for (let gi = 0; gi < groups.length; gi++) {
              const plans = groups[gi].selling_plans || [];
              for (let pi = 0; pi < plans.length; pi++) {
                if ((plans[pi].name || '').toUpperCase().includes(boxToken)) {
                  planId = plans[pi].id; break boxSearch;
                }
              }
            }
          }
        }
        sellingPlanInput.value    = planId;
        sellingPlanInput.disabled = !planId;
      } else {
        sellingPlanInput.value    = '';
        sellingPlanInput.disabled = true;
      }
    }

  }

  window.DG.updatePrice = updatePrice;

  function setToggle(mode) {
    window.DG.currentMode = mode;
    togSub  && togSub.classList.toggle('active', mode === 'sub');
    togOnce && togOnce.classList.toggle('active', mode === 'once');
    toggleEl     && toggleEl.classList.toggle('once-active', mode === 'once');
    purchasePanel && purchasePanel.classList.toggle('buy-once', mode === 'once');
    if (ctaBtn) ctaBtn.textContent = mode === 'once' ? 'buy now' : 'start now';
    updatePrice();
  }

  togSub  && togSub.addEventListener('click',  () => setToggle('sub'));
  togOnce && togOnce.addEventListener('click', () => setToggle('once'));

  updatePrice(); /* init */
})();

/* ── PDP: quantity box selector ── */
function selectQty(el) {
  document.querySelectorAll('.qty-box').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  if (typeof window.DG?.updatePrice === 'function') window.DG.updatePrice();
}

/* ── PDP: qty counter (stick count) ── */
var stickCount = 1;
function changeCount(delta) {
  stickCount = Math.max(1, Math.min(10, stickCount + delta));
  const el = document.getElementById('stick-count');
  if (el) el.textContent = stickCount;
}

/* ── PDP: custom cadence dropdown ── */
function toggleCadence() {
  document.getElementById('cadence-custom')?.classList.toggle('open');
}
function selectCadence(el, val) {
  document.querySelectorAll('.cadence-option').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  const labelEl = document.getElementById('cadence-label');
  const dropEl  = document.getElementById('cadence-dropdown');
  if (labelEl) labelEl.textContent = el.textContent.trim();
  if (dropEl)  dropEl.value = val;
  document.getElementById('cadence-custom')?.classList.remove('open');
  if (typeof window.DG?.updatePrice === 'function') window.DG.updatePrice();
}
document.addEventListener('click', function(e) {
  const c = document.getElementById('cadence-custom');
  if (c && !c.contains(e.target)) c.classList.remove('open');
});

/* ── PDP: panel accordions ── */
function toggleAccord(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

/* ── PDP: ingredient rows ── */
function toggleIngr(row) {
  const wasOpen = row.classList.contains('expanded');
  document.querySelectorAll('.ingr-row').forEach(r => r.classList.remove('expanded'));
  if (!wasOpen) row.classList.add('expanded');
}

/* ── PDP: FAQ accordion ── */
function toggleFaq(btn) {
  const item   = btn.closest('.faq-item');
  const wasOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
}

/* ── PDP: add to cart via Shopify Ajax Cart API ── */
(function() {
  let isAdding = false; /* guard against double-fire (e.g. Recharge.js) */

  function doAddToCart(e) {
    if (e && e.stopImmediatePropagation) e.stopImmediatePropagation(); /* prevent Recharge interception */
    if (isAdding) return;
    isAdding = true;

    const variantId   = (window.DG_VARIANT && window.DG_VARIANT.id)
                        || parseInt(document.getElementById('variant-id')?.value, 10);
    const qty         = parseInt(document.getElementById('stick-count')?.textContent || 1, 10);
    const planInput   = document.getElementById('selling-plan-input');
    const sellingPlan = (planInput && !planInput.disabled && planInput.value) ? parseInt(planInput.value, 10) : null;

    if (!variantId) { isAdding = false; return; }

    const ctaBtn     = document.getElementById('cta-btn');
    const stickyBtn  = document.querySelector('.sticky-atc .sticky-cta-pdp');

    function setLoading(loading) {
      if (ctaBtn) { ctaBtn.disabled = loading; ctaBtn.textContent = loading ? 'adding...' : (window.DG?.currentMode === 'once' ? 'buy now' : 'start now'); }
      if (stickyBtn) { stickyBtn.disabled = loading; stickyBtn.style.opacity = loading ? '0.6' : ''; }
    }

    setLoading(true);

    window.DG.addToCart(variantId, qty, sellingPlan)
      .then(() => window.DG.fetchAndRenderCart())
      .then(() => {
        setLoading(false);
        isAdding = false;
        if (typeof window.DG?.openCart === 'function') window.DG.openCart();
      })
      .catch(err => {
        setLoading(false);
        isAdding = false;
        const msg = (err && err.description) ? err.description : 'Could not add to cart. Please try again.';
        alert(msg);
      });
  }

  /* Hook main CTA button — capture phase so we run before Recharge listeners */
  const ctaBtn = document.getElementById('cta-btn');
  if (ctaBtn) ctaBtn.addEventListener('click', doAddToCart, true);

  /* Hook sticky ATC button — also capture phase */
  const stickyCtaBtn = document.querySelector('.sticky-atc .sticky-cta-pdp');
  if (stickyCtaBtn) {
    stickyCtaBtn.addEventListener('click', function(e) { e.preventDefault(); doAddToCart(e); }, true);
  }
})();

/* ── PDP: lifestyle slideshow — cycles 1 → 2 → 3 every 2800ms ── */
(function() {
  const wrap = document.getElementById('lifestyle-wrap');
  if (!wrap) return;
  const slides = wrap.querySelectorAll('img');
  const dots   = wrap.querySelectorAll('.lifestyle-dot');
  let cur = 0;

  function goTo(next) {
    const prev = cur;
    cur = next;
    slides[prev].classList.remove('active');
    slides[prev].classList.add('exit');
    dots[prev] && dots[prev].classList.remove('active');
    slides[next].classList.add('active');
    dots[next] && dots[next].classList.add('active');
    setTimeout(() => {
      slides[prev].style.transition = 'none';
      slides[prev].classList.remove('exit');
      void slides[prev].offsetWidth;
      slides[prev].style.transition = '';
    }, 580);
  }

  setInterval(() => { goTo((cur + 1) % slides.length); }, 2800);
})();

/* ── PDP: stats count-up (easeOutExpo) ── */
(function() {
  const statsBar = document.getElementById('stats-bar');
  if (!statsBar) return;

  function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  function formatNum(n, fmt) {
    if (fmt === 'comma') return Math.round(n).toLocaleString('en-US');
    return Math.round(n).toString();
  }

  function animateCount(el) {
    const target = +el.dataset.target;
    const fmt    = el.dataset.format || 'plain';
    const dur    = target >= 1000 ? 1800 : 1200;
    const start  = performance.now();
    function step(now) {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / dur, 1);
      const eased    = easeOutExpo(progress);
      el.textContent = formatNum(eased * target, fmt);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = formatNum(target, fmt);
    }
    requestAnimationFrame(step);
  }

  const statsCells = document.querySelectorAll('.stat-cell');
  const statsObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      statsCells.forEach(cell => cell.classList.add('stat-visible'));
      document.querySelectorAll('.count-num').forEach(el => animateCount(el));
      statsObserver.disconnect();
    });
  }, { threshold: 0.25 });

  statsObserver.observe(statsBar);
})();

/* ── PDP: sticky ATC bar ── */
(function() {
  const stickyAtc    = document.getElementById('sticky-atc');
  const startNowBtn  = document.querySelector('.start-now-btn');
  const footerElAtc  = document.querySelector('.footer');
  if (!stickyAtc) return;

  let atcShouldShow = false;

  if (startNowBtn) {
    new IntersectionObserver(([entry]) => {
      atcShouldShow = !entry.isIntersecting;
      stickyAtc.classList.toggle('visible', atcShouldShow);
    }, { threshold: 0 }).observe(startNowBtn);
  }

  if (footerElAtc) {
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) stickyAtc.classList.remove('visible');
      else if (atcShouldShow) stickyAtc.classList.add('visible');
    }, { threshold: 0.05 }).observe(footerElAtc);
  }
})();

/* ── PDP: mobile gallery carousel ── */
(function() {
  const track      = document.getElementById('mgc-track');
  const dotEls     = document.querySelectorAll('#mgc-dots .mgc-dot');
  const stepsSlide = document.getElementById('mgc-steps-slide');
  if (!track) return;

  let currentSlide = 0, stepsTimer = null, stepIdx = 0;

  function updateDots(idx) {
    dotEls.forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  function startSteps() {
    if (stepsTimer) return;
    const steps = stepsSlide.querySelectorAll('.mgc-step');
    const sDots = stepsSlide.querySelectorAll('.mgc-step-dot');
    stepsTimer = setInterval(() => {
      steps[stepIdx].classList.remove('active');
      sDots[stepIdx].classList.remove('active');
      stepIdx = (stepIdx + 1) % steps.length;
      steps[stepIdx].classList.add('active');
      sDots[stepIdx].classList.add('active');
    }, 1600);
  }

  function stopSteps() {
    if (stepsTimer) { clearInterval(stepsTimer); stepsTimer = null; }
    if (!stepsSlide) return;
    const steps = stepsSlide.querySelectorAll('.mgc-step');
    const sDots = stepsSlide.querySelectorAll('.mgc-step-dot');
    stepIdx = 0;
    steps.forEach((s, i) => s.classList.toggle('active', i === 0));
    sDots.forEach((d, i) => d.classList.toggle('active', i === 0));
  }

  /* IntersectionObserver — fires reliably on iOS snap scroll */
  const slides = Array.from(track.querySelectorAll('.mgc-slide'));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        const idx = slides.indexOf(entry.target);
        if (idx !== -1 && idx !== currentSlide) {
          currentSlide = idx;
          updateDots(idx);
          if (idx === 2) startSteps();
          else stopSteps();
        }
      }
    });
  }, { root: track, threshold: 0.5 });

  slides.forEach(slide => observer.observe(slide));
})();
