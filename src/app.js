const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const permissionRoutes = require('./routes/permission.routes');
const transactionRoutes = require('./routes/transaction.routes');
const couponRoutes = require('./routes/coupon.routes');
const searchRoutes = require('./routes/search.routes');
const notificationRoutes = require('./routes/notification.routes');
const infoRoutes = require('./routes/info.routes');
const priceRoutes = require('./routes/price.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'ai-assistant-backend', time: new Date().toISOString() });
});

app.get('/api', (req, res) => {
  res.json({ ok: true, service: 'ai-assistant-backend', time: new Date().toISOString() });
});

// Desktop app facing routes
app.use('/api/auth', authRoutes);
app.use('/api/permission', permissionRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/search-history', searchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/app-info', infoRoutes);
app.use('/api/price', priceRoutes);

// Admin dashboard facing routes
app.use('/api/admin', adminRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler (e.g. multer file errors)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
