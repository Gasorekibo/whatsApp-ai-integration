const dotenv = require('dotenv');
const { fetchZohoContacts } = require('../../utils/zohoApi');
dotenv.config();
async function zohoGetAllContactsHandler (req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 200;

    const contacts = await fetchZohoContacts(page, perPage);
    
    // Format contacts for your application
    const formattedContacts = contacts.map(contact => ({
      id: contact.id,
      firstName: contact.First_Name,
      lastName: contact.Last_Name,
      fullName: `${contact.First_Name || ''} ${contact.Last_Name || ''}`.trim(),
      phone: contact.Mobile || contact.Phone,
      mobile: contact.Mobile,
      email: contact.Email,
      source: 'zoho_crm'
    }));

    res.json({
      success: true,
      count: formattedContacts.length,
      page: page,
      contacts: formattedContacts
    });
  } catch (error) {
    console.error('❌ Error fetching Zoho contacts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = { zohoGetAllContactsHandler };