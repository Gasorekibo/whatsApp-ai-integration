import getCalendarData from '../utils/getCalendarData.js';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';

async function calendarDataHandler(req, res) {
  const { employeeName } = req.body;
  if (!employeeName) return res.status(400).json({ error: 'employeeName is required' });

  const isAdmin = req.user?.role === 'admin';
  const clientId = req.user?.clientId;

  // Clients can only fetch calendar data for their own employees.
  // Admins may pass an explicit clientId or fetch by name across all clients.
  const where = { name: employeeName };
  if (!isAdmin) {
    if (!clientId) return res.status(403).json({ error: 'Client identity required' });
    where.clientId = clientId;
  } else if (req.body.clientId) {
    where.clientId = req.body.clientId;
  }

  try {
    const employee = await dbConfig.db.Employee.findOne({ where });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const token = employee.getDecryptedToken();
    if (!token) return res.status(401).json({ error: 'Employee has no linked calendar token' });

    const data = await getCalendarData(employee.email, token);
    res.json(data);
  } catch (err) {
    logger.error('Calendar data fetch failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

export default calendarDataHandler;
