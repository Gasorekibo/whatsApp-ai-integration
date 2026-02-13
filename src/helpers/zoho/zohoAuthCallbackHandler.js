import dotenv from 'dotenv';
import logger from '../../logger/logger.js';
dotenv.config();

async function zohoAuthCallbackHandler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('No authorization code received');
  }

  try {
    const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Zoho Authorization Success</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 900px; 
              margin: 50px auto; 
              padding: 30px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 15px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            }
            h1 { color: #48bb78; margin-bottom: 20px; }
            .token-box {
              background: #f7fafc;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
              border-left: 4px solid #667eea;
            }
            .token-label {
              font-weight: bold;
              color: #667eea;
              margin-bottom: 10px;
              font-size: 14px;
              text-transform: uppercase;
            }
            .token-value {
              background: #2d3748;
              color: #48bb78;
              padding: 15px;
              border-radius: 5px;
              font-family: 'Courier New', monospace;
              word-break: break-all;
              font-size: 13px;
              margin-top: 10px;
            }
            .copy-btn {
              background: #667eea;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              cursor: pointer;
              margin-top: 15px;
              font-weight: 600;
              transition: all 0.3s ease;
            }
            .copy-btn:hover {
              background: #5568d3;
              transform: translateY(-2px);
            }
            .success-icon {
              font-size: 48px;
              text-align: center;
              margin-bottom: 20px;
            }
            .env-example {
              background: #2d3748;
              color: #68d391;
              padding: 20px;
              border-radius: 8px;
              font-family: 'Courier New', monospace;
              margin-top: 20px;
              white-space: pre-wrap;
            }
            .instructions {
              background: #fef5e7;
              border-left: 4px solid #f39c12;
              padding: 15px;
              border-radius: 5px;
              margin-top: 20px;
            }
            .instructions h3 {
              color: #f39c12;
              margin-top: 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Zoho CRM Authorization Successful!</h1>
            
            <div class="token-box">
              <div class="token-label">🔑 Your Refresh Token:</div>
              <div class="token-value" id="refreshToken">${data.refresh_token}</div>
              <button class="copy-btn" onclick="copyToken('refreshToken')">
                📋 Copy Refresh Token
              </button>
            </div>

            <div class="instructions">
              <h3>📝 Next Steps:</h3>
              <ol>
                <li>Copy the <strong>Refresh Token</strong> above</li>
                <li>Open your <code>.env</code> file</li>
                <li>Add or update: <code>ZOHO_REFRESH_TOKEN=${data.refresh_token}</code></li>
                <li>Restart your server</li>
                <li>Test with: <code>GET /api/zoho/contacts</code></li>
              </ol>
            </div>

            <h3 style="margin-top: 30px;">Add to your .env file:</h3>
            <div class="env-example" id="envConfig">ZOHO_REFRESH_TOKEN=${data.refresh_token}</div>
            <button class="copy-btn" onclick="copyToken('envConfig')">
              📋 Copy Token
            </button>

            <p style="margin-top: 30px; color: #718096; text-align: center;">
              You can close this window and restart your server.
            </p>
          </div>

          <script>
            function copyToken(elementId) {
              const element = document.getElementById(elementId);
              const text = element.textContent;
              
              navigator.clipboard.writeText(text).then(() => {
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                btn.style.background = '#48bb78';
                
                setTimeout(() => {
                  btn.textContent = originalText;
                  btn.style.background = '#667eea';
                }, 2000);
              }).catch(err => {
                alert('Failed to copy. Please select and copy manually.');
              });
            }
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    logger.error('Zoho OAuth error', { error: error.message });
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial; padding: 50px; text-align: center;">
          <h1 style="color: #e53e3e;">❌ Authorization Failed</h1>
          <p style="color: #718096;">Error: ${error.message}</p>
          <p style="margin-top: 30px;">
            <a href="/auth/zoho" 
               style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              🔄 Try Again
            </a>
          </p>
        </body>
      </html>
    `);
  }
}
export { zohoAuthCallbackHandler };