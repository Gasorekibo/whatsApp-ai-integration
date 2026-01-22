const Employee = require('../models/Employees');
const getCalendarData = require('../utils/getCalendarData');
const dotenv = require('dotenv');
dotenv.config();
const {db}  = require('../models/index.js');
async function calendarDataHandler (req, res) {
  const { employeeName } = req.body;
  if (!employeeName) return res.status(400).json({ error: 'no employee name' });

  const employee = await db.Employee.findOne({ where: { name: employeeName } });
  if (!employee) return res.status(404).json({ error: 'employee not found' });

  const token = employee.getDecryptedToken();
  if (!token) return res.status(401).json({ error: 'no token' });

  
  try {
    const data = await getCalendarData(employee.email, token);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
module.exports = { calendarDataHandler };