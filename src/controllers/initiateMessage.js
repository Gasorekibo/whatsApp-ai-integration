import dotenv from 'dotenv';
dotenv.config();
async function initiateWhatsappMessage(to, templateName, params = []) {
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'header',
              parameters: params.map(text => ({ type: 'text', text }))
            }
          ]
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Template send failed:', data);
      throw new Error('Template failed');
    }
    return data;
  } catch (err) {
    console.error('Template error:', err.message);
  }
}

export default  initiateWhatsappMessage ;