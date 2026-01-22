const { google } = require('googleapis');
const {db}  = require('../models/index.js');
const { OAuth2Client: GoogleOAuth2Client } = require('google-auth-library');
const dotenv = require('dotenv');
dotenv.config();
const bookMeetingHandler = async (req, res) => {
  const { 
    title: meetingTitle, 
    start:startTime, 
    end:endTime, 
    description,
    attendeeEmail
  } = req.body;
  
  const employeeEmail = process.env.EMPLOYEE_EMAIL;

  if (!meetingTitle || !startTime || !endTime) {
    return res.status(400).json({ 
      error: 'Missing required fields: meetingTitle, startTime, endTime' 
    });
  }

  try {
    const employee = await db.Employee.findOne({where: { email: employeeEmail }});
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found - run /auth first' });
    }

    const refreshToken = employee.getDecryptedToken();
    if (!refreshToken) {
      return res.status(401).json({ error: 'No valid token - re-authorize at /auth' });
    }

    
    const oauth2Client = new GoogleOAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    let allAttendees = [];
    if (attendeeEmail) {
      allAttendees.push({ email: attendeeEmail });
    }

    const employeeInAttendees = allAttendees.some(
      attendee => attendee.email.toLowerCase() === employeeEmail.toLowerCase()
    );
    
    if (!employeeInAttendees) {
      allAttendees.unshift({ 
        email: employeeEmail,
        organizer: true,
        responseStatus: 'accepted' 
      });
    }

    const event = {
      summary: meetingTitle,
      description: description || '',
      start: {
        dateTime: startTime,
        timeZone: 'Africa/Kigali',
      },
      end: {
        dateTime: endTime,
        timeZone: 'Africa/Kigali',
      },
      attendees: allAttendees, 
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 },
        ],
      },
    };

    // Create the event
    const response = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      sendUpdates: 'all', 
      resource: event,
    });

    res.json({
      success: true,
      message: 'Meeting booked successfully! Check your calendar.',
      event: {
        id: response.data.id,
        link: response.data.htmlLink,
        meetLink: response.data.hangoutLink || response.data.conferenceData?.entryPoints?.[0]?.uri,
        summary: response.data.summary,
        start: response.data.start.dateTime,
        end: response.data.end.dateTime,
        attendees: response.data.attendees,
      }
    });

  } catch (error) {
    console.error('❌ Error booking meeting:', error);
    
    if (error.code === 403 && error.message.includes('insufficient authentication scopes')) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: 'Re-authorize at /auth',
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to book meeting', 
      details: error.message 
    });
  }
};

module.exports = bookMeetingHandler;