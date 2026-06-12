const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── In-memory store ───────────────────────────────────────────────────────
let siteStatus = { online: true, toggledAt: new Date().toISOString() };

const PRODUCTS = [
  { id: 1, name: 'iPhone 15 Pro',        price: 134900, category: 'Flagship',   brand: 'Apple',   emoji: '📱', storage: '256GB', stock: 20 },
  { id: 2, name: 'Galaxy S24 Ultra',      price: 129999, category: 'Flagship',   brand: 'Samsung', emoji: '📲', storage: '512GB', stock: 15 },
  { id: 3, name: 'Pixel 8 Pro',           price: 106999, category: 'Flagship',   brand: 'Google',  emoji: '🔵', storage: '256GB', stock: 12 },
  { id: 4, name: 'OnePlus 12',            price: 64999,  category: 'Mid-Range',  brand: 'OnePlus', emoji: '⚡', storage: '256GB', stock: 30 },
  { id: 5, name: 'Redmi Note 13 Pro+',    price: 31999,  category: 'Budget',     brand: 'Xiaomi',  emoji: '🔴', storage: '256GB', stock: 50 },
  { id: 6, name: 'Galaxy A55',            price: 38999,  category: 'Mid-Range',  brand: 'Samsung', emoji: '💜', storage: '128GB', stock: 40 },
  { id: 7, name: 'Nothing Phone (2a)',     price: 23999,  category: 'Budget',     brand: 'Nothing', emoji: '⚪', storage: '128GB', stock: 35 },
  { id: 8, name: 'iPhone 15',             price: 79900,  category: 'Mid-Range',  brand: 'Apple',   emoji: '🍎', storage: '128GB', stock: 25 },
];

let orders = [];
let orderCounter = 1;

// ─── Helpers ───────────────────────────────────────────────────────────────
function now() { return new Date(); }
function minutesAgo(m) { return new Date(Date.now() - m * 60 * 1000); }
function generateOrderId() { return 'OM-' + String(orderCounter++).padStart(4, '0'); }

function ordersInWindow(minutesBack) {
  const cutoff = minutesAgo(minutesBack);
  return orders.filter(o => new Date(o.createdAt) >= cutoff && o.status !== 'cancelled');
}

function slotBreakdown(totalMinutes, slotMinutes) {
  const numSlots = totalMinutes / slotMinutes;
  return Array.from({ length: numSlots }, (_, i) => {
    const slotStart = minutesAgo(slotMinutes * (i + 1));
    const slotEnd   = minutesAgo(slotMinutes * i);
    const count = orders.filter(o => {
      const t = new Date(o.createdAt);
      return t >= slotStart && t < slotEnd && o.status !== 'cancelled';
    }).length;
    return {
      slot: i + 1,
      label: `T-${slotMinutes * (i + 1)}min to T-${slotMinutes * i}min`,
      from: slotStart.toISOString(),
      to:   slotEnd.toISOString(),
      count,
    };
  });
}

// ─── Middleware: site status guard ─────────────────────────────────────────
function requireSiteOnline(req, res, next) {
  if (!siteStatus.online) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'OnlyMobiles is currently offline for maintenance.',
      toggledAt: siteStatus.toggledAt,
    });
  }
  next();
}

// ─── Routes ────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: now().toISOString() });
});

// ── Site status ─────────────────────────────────────────────────────────────
app.get('/api/site/status', (req, res) => {
  res.json({ online: siteStatus.online, toggledAt: siteStatus.toggledAt, totalOrders: orders.length });
});

app.post('/api/site/toggle', (req, res) => {
  const { online } = req.body;
  if (typeof online !== 'boolean') {
    return res.status(400).json({ error: 'INVALID_BODY', message: '`online` must be a boolean.' });
  }
  siteStatus = { online, toggledAt: now().toISOString() };
  res.json({ message: `OnlyMobiles is now ${online ? 'online' : 'offline'}.`, ...siteStatus });
});

// ── Products ────────────────────────────────────────────────────────────────
app.get('/api/products', requireSiteOnline, (req, res) => {
  const { category, brand } = req.query;
  let list = PRODUCTS;
  if (category) list = list.filter(p => p.category.toLowerCase() === category.toLowerCase());
  if (brand)    list = list.filter(p => p.brand.toLowerCase() === brand.toLowerCase());
  res.json({ count: list.length, products: list });
});

app.get('/api/products/:id', requireSiteOnline, (req, res) => {
  const product = PRODUCTS.find(p => p.id === parseInt(req.params.id));
  if (!product) return res.status(404).json({ error: 'NOT_FOUND', message: 'Mobile not found.' });
  res.json(product);
});

// ── Orders ──────────────────────────────────────────────────────────────────
app.post('/api/orders', requireSiteOnline, (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'INVALID_BODY', message: '`items` array is required.' });
  }

  let total = 0;
  const lineItems = [];

  for (const item of items) {
    const product = PRODUCTS.find(p => p.id === item.productId);
    if (!product) {
      return res.status(400).json({ error: 'PRODUCT_NOT_FOUND', message: `Mobile ID ${item.productId} not found.` });
    }
    const qty = parseInt(item.quantity) || 1;
    total += product.price * qty;
    lineItems.push({
      productId: product.id,
      name: product.name,
      brand: product.brand,
      storage: product.storage,
      quantity: qty,
      unitPrice: product.price,
      subtotal: product.price * qty,
    });
  }

  const order = {
    id: generateOrderId(),
    items: lineItems,
    totalAmount: total,
    status: 'confirmed',
    createdAt: now().toISOString(),
    cancelledAt: null,
  };

  orders.push(order);
  res.status(201).json(order);
});

app.get('/api/orders', (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  let list = [...orders].reverse();
  if (status) list = list.filter(o => o.status === status);
  const paginated = list.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  res.json({ total: list.length, limit: parseInt(limit), offset: parseInt(offset), orders: paginated });
});

app.get('/api/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
  res.json(order);
});

// PATCH /api/orders/:id/cancel
app.patch('/api/orders/:id/cancel', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
  }
  if (order.status === 'cancelled') {
    return res.status(409).json({ error: 'ALREADY_CANCELLED', message: 'Order is already cancelled.' });
  }
  order.status = 'cancelled';
  order.cancelledAt = now().toISOString();
  res.json({ message: `Order ${order.id} has been cancelled.`, order });
});

// DELETE /api/orders — reset for testing
app.delete('/api/orders', (req, res) => {
  const count = orders.length;
  orders = [];
  orderCounter = 1;
  res.json({ message: `Deleted ${count} orders. Counter reset.` });
});

// ── Monitor ─────────────────────────────────────────────────────────────────
app.get('/api/monitor/summary', (req, res) => {
  const w1h  = ordersInWindow(60);
  const w6h  = ordersInWindow(360);
  const w12h = ordersInWindow(720);
  res.json({
    timestamp: now().toISOString(),
    windows: {
      '1hr':  { count: w1h.length,  fromMinutesAgo: 60,  orders: w1h.map(o => o.id) },
      '6hr':  { count: w6h.length,  fromMinutesAgo: 360, orders: w6h.map(o => o.id) },
      '12hr': { count: w12h.length, fromMinutesAgo: 720, orders: w12h.map(o => o.id) },
    },
  });
});

app.get('/api/monitor/1hr', (req, res) => {
  res.json({ window: '1hr', totalMinutes: 60, slotMinutes: 10, totalCount: ordersInWindow(60).length, slots: slotBreakdown(60, 10) });
});

app.get('/api/monitor/6hr', (req, res) => {
  res.json({ window: '6hr', totalMinutes: 360, slotMinutes: 30, totalCount: ordersInWindow(360).length, slots: slotBreakdown(360, 30) });
});

app.get('/api/monitor/12hr', (req, res) => {
  res.json({ window: '12hr', totalMinutes: 720, slotMinutes: 60, totalCount: ordersInWindow(720).length, slots: slotBreakdown(720, 60) });
});
// Home page route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  OnlyMobiles API running at http://localhost:${PORT}`);
  console.log(`   Health:  GET  http://localhost:${PORT}/health`);
  console.log(`   Status:  GET  http://localhost:${PORT}/api/site/status`);
  console.log(`   Toggle:  POST http://localhost:${PORT}/api/site/toggle`);
  console.log(`   Monitor: GET  http://localhost:${PORT}/api/monitor/summary`);
  console.log(`   Cancel:  PATCH http://localhost:${PORT}/api/orders/:id/cancel\n`);
});
