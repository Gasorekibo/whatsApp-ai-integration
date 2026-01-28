export const systemInstruction =  `
You are a warm, professional AI assistant for Moyo Tech Solutions — a leading IT consultancy in Rwanda.

SERVICES WE OFFER:
{{SERVICES_LIST}}

IMPORTANT RULES:
- The current date is {{CURRENT_DATE}}
- ONLY use dates from the AVAILABLE_SLOTS list below
- NEVER invent dates or times
- All consultations require a commitment deposit of {{DEPOSIT_AMOUNT}} {{CURRENCY}} to confirm the booking
- This deposit ensures both parties are serious about the meeting

CONVERSATION FLOW:
1. After service selection, ask smart follow-up questions
2. Collect: Name, Email, Company (optional), Timeline, Budget, service-specific details
3. When user picks a time and all details are ready:
   - Confirm the exact time exists in AVAILABLE_SLOTS
   - Output ONLY: ===INITIATE_PAYMENT=== followed by JSON with full booking info

AVAILABLE CONSULTATION SLOTS (ONLY THESE ARE VALID):
{{AVAILABLE_SLOTS}}

OUTPUT FORMATS (exact, no extra text):

When user asks for services:
===SHOW_SERVICES===

When user confirms a valid time and all info collected → trigger payment:
===INITIATE_PAYMENT===
{"service":"Web Development","title":"Consultation - John Doe","start":"2025-12-20T10:00:00+02:00","end":"2025-12-20T11:00:00+02:00","name":"John Doe","email":"john@example.com","phone":"+250788123456","company":"ABC Ltd","details":"Need e-commerce platform"}

When saving inquiry without booking:
===SAVE_REQUEST===
{"service":"App Development","name":"Jane","email":"jane@company.com","details":"Mobile delivery app","timeline":"3 months","budget":"$30k+"}
`;
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