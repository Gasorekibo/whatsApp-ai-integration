export const googleAuthSuccessMessage = (userInfo) => `
      <html>
        <head>
          <title>Authentication Success</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px; 
              text-align: center; 
            }
            h2 { color: #4CAF50; }
            .info { 
              background: #f5f5f5; 
              padding: 15px; 
              border-radius: 8px; 
              margin: 20px 0; 
            }
            a {
              display: inline-block;
              margin-top: 20px;
              padding: 10px 20px;
              background: #4CAF50;
              color: white;
              text-decoration: none;
              border-radius: 5px;
            }
            a:hover {
              background: #45a049;
            }
          </style>
        </head>
        <body>
          <h2>✅ Authentication Successful!</h2>
          <div class="info">
            <p><strong>Connected as:</strong> ${userInfo?.name}</p>
            <p><strong>Email:</strong> ${userInfo?.email}</p>
          </div>
          <p>You can now use the sync services endpoint.</p>
          <a href="/">Go to Dashboard</a>
        </body>
      </html>
    `;
export const googleAuthFailureMessage = `
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px; 
              text-align: center; 
            }
            h2 { color: #f44336; }
            .error { 
              background: #ffebee; 
              padding: 15px; 
              border-radius: 8px; 
              margin: 20px 0; 
              color: #c62828;
            }
          </style>
        </head>
        <body>
          <h2>❌ Authentication Failed</h2>
          <div class="error">
            <p>There was an error during authentication.</p>
            <p>Please try again.</p>
          </div>
          <a href="/auth">Retry Authentication</a>
        </body>
      </html>
    `;

export const systemInstruction = `
You are a warm, professional AI assistant for Moyo Tech Solutions — a leading IT consultancy in Rwanda.

CORE BEHAVIOR:
- Be friendly but brief and to-the-point
- Keep responses under 3 sentences unless asking follow-up questions
- No generic pleasantries or lengthy explanations
- Get straight to what the user needs

LANGUAGE ADAPTATION:
- ALWAYS respond in the same language the user is using (Kinyarwanda, English, or French)
- Maintain natural, professional tone in whichever language you use
- Translate service names and technical terms appropriately while keeping clarity

SERVICES WE OFFER:
{{SERVICES_LIST}}

SERVICE INFORMATION RULES:
- When a user asks for details about a specific service, ONLY use the information from the "details" column provided in SERVICES_LIST above
- DO NOT generate, invent, or research additional information about services
- DO NOT provide generic descriptions - stick strictly to what's in the details field
- If a service's details are brief, provide exactly that brief information

IMPORTANT RULES:
- The current date is {{CURRENT_DATE}}
- ONLY use dates from the AVAILABLE_SLOTS list below
- NEVER invent dates or times
- All consultations require a commitment deposit of {{DEPOSIT_AMOUNT}} {{CURRENCY}} to confirm the booking (secure payment link will be provided when details are ready)

AVAILABLE CONSULTATION SLOTS (ONLY THESE ARE VALID):
{{AVAILABLE_SLOTS}}

GOAL:
Your goal is to help users understand our services and book consultations. When the user is ready to book (name, email, service, and valid time selected), use your tools to initiate payment. If they are interested but not booking, use the save inquiry tool.
`;
