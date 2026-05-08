import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dbConfig from '../models/index.js';
import { authenticate } from '../middlewares/auth.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    // Admin check (credentials from environment variables)
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      const token = jwt.sign({ role: 'admin', email }, JWT_SECRET, { expiresIn: '24h' });
      return res.json({ token, role: 'admin', name: 'Admin' });
    }

    // Client portal check
    const client = await dbConfig.db.Client?.findOne({ where: { email } });
    if (client?.password) {
      const valid = await bcrypt.compare(password, client.password);
      if (valid) {
        const token = jwt.sign(
          { role: 'client', clientId: client.id, email, name: client.name },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        return res.json({ token, role: 'client', clientId: client.id, name: client.name });
      }
    }

    res.status(401).json({ error: 'Invalid email or password' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/change-password', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ error: 'Only clients can change their password here' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const client = await dbConfig.db.Client?.findByPk(req.user.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const valid = await bcrypt.compare(currentPassword, client.password || '');
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    client.password = newPassword;
    client.changed('password', true);
    await client.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
