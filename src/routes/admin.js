
import express from 'express';
const router = express.Router();
import  initiateWhatsappMessage  from '../controllers/initiateMessage.js';
import  dbConfig from '../models/index.js'

router.post('/template', async (req, res) => {
  const contacts = await fetch('http://localhost:3000/api/zoho/contacts')
    .then(response => response.json())
    .then(data => data.contacts)
    .catch(error => {
      console.error('Error fetching contacts from ZOHO CRM:', error);
      return [];
    });

  const to = contacts.map(contact => contact.phone);
  const templateName = req.body.templateName
  if (!to?.length || !templateName) {
    return res.status(400).json({ error: "Missing 'to' or 'templateName'" });
  }
  try {

   await to.forEach(async (phoneNumber) => {
    const username = [contacts.find(contact => contact.phone === phoneNumber)?.fullName] || ['Customer'];
    const params = username;
      await initiateWhatsappMessage(phoneNumber, templateName, params);
    });
    res.json({ success: true, sent_to: to, template: templateName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await dbConfig.db.UserSession?.findAll();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

router.get('/appointments', async(req, res)=> {
  try {
    const appointments = await dbConfig.db.ServiceRequest?.findAll();
    res.json({ appointments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

router.get('/services', async(req, res)=> {
  try {
    const services = await dbConfig.db.Content?.findAll();
    res.json(services || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

export default router;

